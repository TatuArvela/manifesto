// A webhook receiver for Manifesto, in one file with no dependencies.
//
// Run it where your server can reach it, then add its address under
// Settings > Webhooks and put the secret shown there in WEBHOOK_SECRET:
//
//   WEBHOOK_SECRET=whsec_... node receiver.mjs
//
// It checks every delivery's signature, drops what it has already seen, and
// hands the rest to the recipes listed at the bottom, one delivery at a time
// in the order they came. Each recipe is a function of the delivery; one that
// throws is logged and does not stop the others. See
// docs/specification/features/webhooks.md for what is sent.

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.WEBHOOK_SECRET ?? "";
/** How far a delivery's timestamp may be from this machine's clock. */
const MAX_SKEW_SECONDS = 5 * 60;
/** Bodies larger than this are refused before they are read in full. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// --- Verifying a delivery ---

/**
 * Whether `signature` is the HMAC-SHA256 of `<timestamp>.<body>` under the
 * secret, and the timestamp is recent. The body must be the raw bytes as they
 * arrived: parsing and re-serializing the JSON changes them.
 */
export function isAuthentic(
  secret,
  timestamp,
  body,
  signature,
  now = Date.now(),
) {
  if (!secret || !timestamp || !signature) return false;
  const age = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SECONDS) return false;
  const expected = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Delivery ids already handled. A delivery that got no answer in time is sent
 * again with the same id, so a recipe that is not idempotent needs this. Held
 * in memory: a restart forgets it, which the recipes below can live with.
 */
const seen = new Set();
function firstTime(deliveryId) {
  if (seen.has(deliveryId)) return false;
  seen.add(deliveryId);
  if (seen.size > 5000) seen.delete(seen.values().next().value);
  return true;
}

// --- Recipes ---

/**
 * Notes this process knows to have an issue. GitHub's search learns of a new
 * issue some seconds after it is made, and a note being typed in is delivered
 * again sooner than that, so the search alone would open a second one. The
 * search is still what answers after a restart, when this is empty.
 */
const notesWithIssue = new Set();
/** GitHub refuses an issue title longer than this. */
const MAX_ISSUE_TITLE = 256;

/**
 * A `todo` tag opens an issue. The note's id goes in the issue body, and an
 * issue that already names it is left alone, so tagging, editing and
 * re-tagging a note makes one issue and not three.
 *
 *   GITHUB_REPO=owner/name GITHUB_TOKEN=github_pat_...
 *
 * The token needs "Issues: read and write" on that one repository.
 */
export async function todoTagOpensIssue(delivery, env = process.env) {
  const { GITHUB_REPO: repo, GITHUB_TOKEN: token } = env;
  if (!repo || !token) return;
  if (delivery.event === "note.deleted") return;
  const { note } = delivery;
  if (!note.tags.includes("todo") || note.trashed) return;
  if (notesWithIssue.has(note.id)) return;

  const marker = `manifesto-note:${note.id}`;
  const github = (path, init) =>
    fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "manifesto-webhook-recipe",
        ...init?.headers,
      },
    });

  const query = encodeURIComponent(`repo:${repo} is:issue in:body "${marker}"`);
  const found = await github(`/search/issues?q=${query}`);
  if (!found.ok) throw new Error(`GitHub search answered ${found.status}`);
  if ((await found.json()).total_count > 0) {
    notesWithIssue.add(note.id);
    return;
  }

  const created = await github(`/repos/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: (
        note.title ||
        note.content.split("\n")[0] ||
        "Untitled note"
      ).slice(0, MAX_ISSUE_TITLE),
      body: `${note.content}\n\n<!-- ${marker} -->`,
    }),
  });
  if (!created.ok) throw new Error(`GitHub answered ${created.status}`);
  notesWithIssue.add(note.id);
}

/**
 * A push notification when a note tagged `notify` is created or changes,
 * through ntfy (https://ntfy.sh or your own). Only the title is sent: a
 * public ntfy topic is readable by anyone who guesses its name.
 *
 *   NTFY_URL=https://ntfy.sh/some-long-random-topic
 */
export async function notifyTagPushes(delivery, env = process.env) {
  const url = env.NTFY_URL;
  if (!url || delivery.event === "note.deleted") return;
  const { note } = delivery;
  if (!note.tags.includes("notify") || note.trashed) return;
  const res = await fetch(url, {
    method: "POST",
    headers: { Title: "Manifesto", Tags: "memo" },
    body: note.title || "A note changed",
  });
  if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
}

/**
 * Every note as a Markdown file in a folder, written on each change and
 * removed when the note is deleted: a plain-text mirror to back up or put
 * under version control. The file is named by the note's id, which never
 * changes, where a title does.
 *
 *   MIRROR_DIR=/var/backups/notes
 */
export async function mirrorToFolder(delivery, env = process.env) {
  const dir = env.MIRROR_DIR;
  if (!dir) return;
  // An id is a ULID; anything else is not written as a file name.
  const id =
    delivery.event === "note.deleted" ? delivery.noteId : delivery.note.id;
  if (!/^[0-9A-Za-z]{1,64}$/.test(id)) return;
  const file = join(dir, `${id}.md`);
  if (delivery.event === "note.deleted") {
    await rm(file, { force: true });
    return;
  }
  const { note } = delivery;
  const front = [
    "---",
    `title: ${JSON.stringify(note.title)}`,
    `tags: ${JSON.stringify(note.tags)}`,
    `updated: ${note.updatedAt}`,
    ...(note.archived ? ["archived: true"] : []),
    ...(note.trashed ? ["trashed: true"] : []),
    "---",
    "",
  ].join("\n");
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${front}${note.content}\n`);
}

/** What runs for each delivery. Add your own; remove what you do not use. */
const RECIPES = [todoTagOpensIssue, notifyTagPushes, mirrorToFolder];

// --- The server ---

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createReceiver({ secret = SECRET, recipes = RECIPES } = {}) {
  /**
   * The tail of the work. Deliveries are answered as they arrive and worked
   * through here one at a time, so a note's events reach the recipes in the
   * order they happened even when a recipe is slower than the next delivery.
   */
  let queue = Promise.resolve();

  async function run(delivery) {
    for (const recipe of recipes) {
      try {
        await recipe(delivery);
      } catch (err) {
        console.error(`${recipe.name} failed for ${delivery.deliveryId}:`, err);
      }
    }
  }

  return createServer(async (req, res) => {
    const answer = (status) => {
      res.writeHead(status).end();
    };
    if (req.method !== "POST") return answer(405);
    let body;
    try {
      body = await readBody(req);
    } catch {
      // The sender hung up partway through; there is no one left to answer.
      return;
    }
    if (body === null) return answer(413);
    const authentic = isAuthentic(
      secret,
      req.headers["x-manifesto-timestamp"],
      body,
      req.headers["x-manifesto-signature"],
    );
    if (!authentic) return answer(401);

    // Answer first: the sender waits ten seconds and then counts a failure,
    // and a recipe that calls another service can take longer than that.
    answer(204);

    // "Send a test" in Settings posts a `ping`, which is only a hello.
    if (req.headers["x-manifesto-event"] === "ping") return;
    let delivery;
    try {
      delivery = JSON.parse(body);
    } catch {
      return;
    }
    if (!delivery || !firstTime(delivery.deliveryId)) return;
    queue = queue.then(() => run(delivery));
  });
}

// Started only when run directly, so the recipes can be imported elsewhere.
const script = process.argv[1];
if (script && import.meta.url === pathToFileURL(script).href) {
  if (!SECRET) {
    console.error(
      "Set WEBHOOK_SECRET to the secret shown when the webhook was added.",
    );
    process.exit(1);
  }
  createReceiver().listen(PORT, () => {
    console.error(`Listening for Manifesto webhooks on :${PORT}`);
  });
}
