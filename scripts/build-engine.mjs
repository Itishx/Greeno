// Bundles the ported emotional engine (TypeScript, Deno-style .ts imports) into
// one CommonJS file the Electron main process can require directly.
//
// The sources stay as they are in the Braino repo so a fix there ports across as
// a straight copy. Nothing in app/lib/emotional-engine/ is edited by hand.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "app", "lib", "engine.cjs");
mkdirSync(dirname(out), { recursive: true });

await build({
  entryPoints: [join(root, "app", "lib", "engine-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: out,
  logLevel: "info",
});
