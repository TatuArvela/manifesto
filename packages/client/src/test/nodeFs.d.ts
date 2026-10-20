// The client has types without Node, which only its tests in the node project
// can reach. This is the one call that they make. It reads a stylesheet that
// Vitest would otherwise give them blank (see styles/styles.test.ts).
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
}
