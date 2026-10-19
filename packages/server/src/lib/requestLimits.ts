/**
 * The maximum content of a request body on `/api/v1/*`, other than attachments.
 * Nothing else carries bulk data (the images and preview images of a note are
 * references). Thus, this limits what one request can make the server keep in
 * memory. `/api/v1/capabilities` tells it, and `app.ts` enforces it, both from
 * here.
 */
export const MAX_REQUEST_BYTES = 1024 * 1024;
