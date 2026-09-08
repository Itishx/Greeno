// Compiles the double-Option helper if it is missing or out of date.
//
// It is a build artifact, not a checked-in binary, because Accessibility grants
// are keyed to the binary and a stale one silently loses its permission.
// Skips quietly when swiftc is absent: the Alt+Space fallback still works, and
// a missing hotkey should never stop the app from starting.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "app", "native", "GreenoHotkey.swift");
const out = join(root, "app", "native", "greeno-hotkey");

if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) {
  process.exit(0);
}

try {
  execFileSync("swiftc", ["-O", "-o", out, src], { stdio: "inherit" });
  console.log("built greeno-hotkey");
} catch (err) {
  console.warn("skipping the hotkey helper:", err.message.split("\n")[0]);
  console.warn("double-Option will not work. Alt+Space still will.");
}
