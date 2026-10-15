// The client is typed without Node, which only its tests in the node project
// can reach. This is the one call they make, reading a stylesheet that Vitest
// would otherwise hand them blank (see styles/styles.test.ts).
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
}
