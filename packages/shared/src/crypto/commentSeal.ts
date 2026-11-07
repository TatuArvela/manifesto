import { MAX_COMMENT_LENGTH } from "#/api/comments.ts";
import { utf8 } from "./bytes.ts";
import { type NoteSealKey, sharedData } from "./noteKey.ts";
import { NoteLimitError } from "./noteSeal.ts";
import { seal, unsealText } from "./seal.ts";

/**
 * The text of a comment, sealed under the note key and bound to the own id of
 * the comment. Throws `NoteLimitError` for a comment that is empty or too long,
 * because the server cannot check this now.
 */
export async function sealComment(
  key: NoteSealKey,
  commentId: string,
  body: string,
): Promise<{ body: string; keyVersion: number }> {
  const text = body.trim();
  if (text.length === 0 || text.length > MAX_COMMENT_LENGTH) {
    throw new NoteLimitError("comment");
  }
  return {
    keyVersion: key.version,
    body: await seal(
      key.fields,
      utf8(text),
      sharedData(key, commentId, "comment"),
    ),
  };
}

/**
 * The text of a comment. Null when it is under a different key, or does not
 * open.
 */
export async function openComment(
  key: NoteSealKey,
  comment: { id: string; keyVersion: number; body: string },
): Promise<string | null> {
  if (comment.keyVersion !== key.version) return null;
  const text = await unsealText(
    key.fields,
    comment.body,
    sharedData(key, comment.id, "comment"),
  );
  return text !== null && text.length <= MAX_COMMENT_LENGTH ? text : null;
}
