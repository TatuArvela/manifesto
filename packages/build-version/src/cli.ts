// Prints the resolved build version, for the server build and for workflows
// that must compute it before a Docker build context drops `.git`.
import { fileURLToPath } from "node:url";
import { resolveBuildVersion } from "./index.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
process.stdout.write(`${resolveBuildVersion({ root })}\n`);
