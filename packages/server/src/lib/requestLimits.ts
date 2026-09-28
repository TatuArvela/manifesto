/**
 * The most a request body may hold on `/api/*`, attachments aside. Nothing
 * else carries bulk (a note's images and preview images are references), so
 * this bounds what one request can make the server hold in memory. Said in
 * `/api/capabilities` as well as enforced in `app.ts`, from here.
 */
export const MAX_REQUEST_BYTES = 1024 * 1024;
