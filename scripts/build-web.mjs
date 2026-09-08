// Assemble the deployable site.
//
//   dist-web/            the marketing site (site/), which owns the root
//   dist-web/app/        the React app, behind "Get started"
//
// Two things live at one domain: the page that sells him, and the thing itself.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-web");
const site = join(root, "site");

if (!existsSync(join(out, "app"))) {
  console.error("dist-web/app is missing — run the vite build first");
  process.exit(1);
}

// Copy the marketing site to the root of the output, skipping anything that is
// Vercel's own bookkeeping or a nested project link.
mkdirSync(out, { recursive: true });
for (const name of readdirSync(site)) {
  if (name === ".vercel" || name === "vercel.json" || name === ".gitignore") continue;
  cpSync(join(site, name), join(out, name), { recursive: true });
}

// The CTA the user asked for: "Get early access" becomes "Get started", and it
// goes to the app rather than to an anchor on the same page.
const indexPath = join(out, "index.html");
let html = readFileSync(indexPath, "utf8");
const before = html;
html = html
  .replace(/href="#access"/g, 'href="/app/"')
  .replace(/Get early access/g, "Get started");
writeFileSync(indexPath, html);

console.log(
  before === html
    ? "site copied (no CTA to rewrite)"
    : "site copied, CTA rewritten to Get started -> /app/",
);
