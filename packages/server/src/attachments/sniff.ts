// What kind of image a file's leading bytes say it is. The check moved to
// `@manifesto/shared` with sealing: the client that opens an image makes it,
// since the server stores bytes it cannot read.
export { sniffImageType } from "@manifesto/shared";
