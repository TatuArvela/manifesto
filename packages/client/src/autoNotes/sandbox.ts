import type { ApproxLabels } from "./stdlib.js";
import { buildStdlibPrelude } from "./stdlib.js";
import type { AutoNoteResult, PluginContextInput } from "./types.js";

// Sandbox architecture notes:
//
// The sandbox lives in a same-origin static HTML file (public/autonotes-sandbox.html)
// that we load via `iframe.src`. It *cannot* be a `srcdoc` iframe — srcdoc
// iframes inherit the parent's CSP, and our main app pins `script-src 'self'`.
// An iframe loaded from a real URL gets its own CSP (from its own meta tag),
// so the sandbox can use `unsafe-inline` + `unsafe-eval` without relaxing the
// host page's policy.
//
// The sandbox attribute is `allow-scripts` (no `allow-same-origin`), giving
// the iframe an opaque origin — no access to host storage, cookies, or DOM.
//
// Flow:
//   1. Host creates iframe, awaits `load` event.
//   2. Iframe posts `sandbox-booted` to parent.
//   3. Host posts `init` with the stdlib prelude string.
//   4. Iframe evaluates the prelude, posts `init-ok`.
//   5. Host's `ready` promise resolves.
//   6. Per plugin invocation: host posts `run`, iframe posts `run-ok|run-err`.

interface RunRequest {
  type: "run";
  id: number;
  pluginSrc: string;
  today: string;
  locale: string;
  approxLabels: ApproxLabels;
}

interface RunOkResponse {
  type: "run-ok";
  id: number;
  notes: AutoNoteResult[];
}

interface RunErrResponse {
  type: "run-err";
  id: number;
  error: string;
}

type RunResponse = RunOkResponse | RunErrResponse;

function sandboxUrl(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}autonotes-sandbox.html`;
}

interface SandboxHandle {
  iframe: HTMLIFrameElement;
  ready: Promise<void>;
  pending: Map<number, (r: RunResponse) => void>;
}

let currentSandbox: SandboxHandle | null = null;
let nextId = 1;

function createSandbox(): SandboxHandle {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");

  const pending = new Map<number, (r: RunResponse) => void>();

  const ready = new Promise<void>((resolve, reject) => {
    const initId = -1;
    const messageListener = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "sandbox-booted") {
        const prelude = buildStdlibPrelude();
        iframe.contentWindow?.postMessage(
          { type: "init", id: initId, prelude },
          "*",
        );
        return;
      }
      if (data.type === "init-ok" && data.id === initId) {
        resolve();
        return;
      }
      if (data.type === "init-err" && data.id === initId) {
        reject(new Error(String(data.error ?? "sandbox init failed")));
        return;
      }

      if (typeof data.id !== "number") return;
      const cb = pending.get(data.id);
      if (cb) {
        pending.delete(data.id);
        cb(data as RunResponse);
      }
    };
    window.addEventListener("message", messageListener);
    (iframe as unknown as { __cleanup?: () => void }).__cleanup = () => {
      window.removeEventListener("message", messageListener);
    };
  });

  iframe.src = sandboxUrl();
  document.body.appendChild(iframe);
  return { iframe, ready, pending };
}

function destroySandbox(handle: SandboxHandle) {
  const cleanup = (handle.iframe as unknown as { __cleanup?: () => void })
    .__cleanup;
  if (cleanup) cleanup();
  handle.iframe.remove();
  for (const [, cb] of handle.pending) {
    cb({ type: "run-err", id: -1, error: "sandbox destroyed" });
  }
  handle.pending.clear();
}

function getSandbox(): SandboxHandle {
  if (!currentSandbox) currentSandbox = createSandbox();
  return currentSandbox;
}

/** Run a plugin source string inside the sandbox and return its notes. */
export async function runPlugin(
  pluginSrc: string,
  ctx: PluginContextInput,
  timeoutMs = 2000,
): Promise<AutoNoteResult[]> {
  const handle = getSandbox();
  await handle.ready;
  const id = nextId++;
  const req: RunRequest = {
    type: "run",
    id,
    pluginSrc,
    today: ctx.today,
    locale: ctx.locale,
    approxLabels: ctx.approxLabels,
  };
  const win = handle.iframe.contentWindow;
  if (!win) throw new Error("sandbox iframe has no contentWindow");
  return await new Promise<AutoNoteResult[]>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    handle.pending.set(id, (res) => {
      if (timer) clearTimeout(timer);
      if (res.type === "run-err") reject(new Error(res.error));
      else resolve(res.notes ?? []);
    });
    timer = setTimeout(() => {
      if (!handle.pending.has(id)) return;
      handle.pending.delete(id);
      // Timeout → assume the sandbox is compromised; rebuild.
      if (currentSandbox === handle) {
        destroySandbox(handle);
        currentSandbox = null;
      }
      reject(new Error(`plugin timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    win.postMessage(req, "*");
  });
}

/** Tear down the current sandbox, e.g. for tests or HMR cleanup. */
export function resetSandbox() {
  if (currentSandbox) {
    destroySandbox(currentSandbox);
    currentSandbox = null;
  }
}
