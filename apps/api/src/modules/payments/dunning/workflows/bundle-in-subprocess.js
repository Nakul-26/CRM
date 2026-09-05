// Deliberately plain JS, never `require()`'d in-process — this file is
// spawned as a standalone `node` process by TemporalWorkerService. Kept as
// plain JS (not `.ts`) specifically so it never needs `ts-node`/`ts-jest` to
// run it: those transpile hooks patch Node's own module-loading pipeline for
// every `require()` in the process, and since this script's whole job is to
// run webpack (thousands of its own internal `require()` calls), spawning it
// under `ts-node/register` measured ~3x slower in practice than a plain
// `node` invocation of an already-JS file — not worth it for a script with
// no TypeScript-specific syntax to begin with. `nest-cli.json`'s
// `compilerOptions.assets` copies this file into `dist/` verbatim on build,
// same as any other non-TS build asset.
//
// See TemporalWorkerService.bundleWorkflowCode for *why* this bundling
// happens in a separate process at all (not `Worker.create({
// workflowsPath })`, which bundles in-process): running webpack's own
// dynamic `require()` calls (loader loading, `HarmonyImportGuard`'s
// memoized circular require) *inside Jest's own CommonJS module registry*
// is fragile — confirmed empirically: the exact same `bundleWorkflowCode`
// call fails with different, timing-dependent `TypeError`s from webpack's
// own internals when run inside a Jest e2e spec's `beforeAll`, but completes
// cleanly every time in a plain Node process. See
// docs/decisions/0016-temporal-dunning-phase16-scope.md's addendum.
//
// usage: node bundle-in-subprocess.js <workflowsPath> <outFile>
const { bundleWorkflowCode } = require("@temporalio/worker");
const { writeFileSync } = require("node:fs");

async function main() {
  const [workflowsPath, outFile] = process.argv.slice(2);
  if (!workflowsPath || !outFile) {
    throw new Error("usage: node bundle-in-subprocess.js <workflowsPath> <outFile>");
  }
  const { code } = await bundleWorkflowCode({ workflowsPath });
  writeFileSync(outFile, code, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
