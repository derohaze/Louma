/**
 * Coverage guard for per-page loading skeletons.
 *
 * Fails (non-zero exit) if any dashboard route (`WalletPage`) or any navigation href resolves
 * to the generic fallback instead of a page-specific skeleton. Run with:
 *
 *   bun run check:skeletons   (or: node scripts/check-skeletons.mjs)
 *
 * Add it to CI so a new page without a registered skeleton can never ship silently.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

const skeletonFile = readFileSync(join(src, "components", "page-skeletons.tsx"), "utf8");

const pickBlock = (name) => {
  const m = skeletonFile.match(new RegExp(`${name}\\s*[:=][^=]*?\\{([\\s\\S]*?)\\n\\};`));
  return m ? m[1] : "";
};

const quotedPaths = (block) => [...block.matchAll(/"(\/[^"]*)"\s*:/g)].map((m) => m[1]);
const quotedPrefixes = (block) => [...block.matchAll(/prefix:\s*"([^"]*)"/g)].map((m) => m[1]);

const exactPaths = new Set(quotedPaths(pickBlock("skeletonsByPath")));
const prefixes = quotedPrefixes(pickBlock("skeletonPrefixes"));

const normalize = (p) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p || "/");

/** Mirror of skeletonForPath(): exact → longest prefix. Title fallback is NOT counted as cover. */
const resolves = (routePath) => {
  const concrete = normalize(routePath.replace(/\$[^/]+/g, "__param__"));
  if (exactPaths.has(concrete)) return true;
  // Dynamic segment: needs a prefix rule (e.g. "/history/$transferId" → "/history/").
  const prefixForm = normalize(routePath.replace(/\$[^/]+/g, "") || "/");
  const probe = prefixForm.endsWith("/") ? prefixForm : `${prefixForm}/`;
  return prefixes.some((prefix) => probe.startsWith(prefix) || concrete.startsWith(prefix));
};

const failures = [];

// 1. Every route that renders inside WalletPage must resolve to a specific skeleton.
const routeFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".tsx")) routeFiles.push(full);
  }
};
walk(join(src, "routes"));

for (const file of routeFiles) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("WalletPage")) continue;
  const m = text.match(/createFileRoute\("([^"]+)"\)/);
  if (!m) {
    failures.push(`${file}: uses WalletPage but has no createFileRoute path`);
    continue;
  }
  if (!resolves(m[1])) {
    failures.push(
      `${file}: route "${m[1]}" has no skeleton (add it to skeletonsByPath in page-skeletons.tsx)`,
    );
  }
}

// 2. Every href in the navigation catalogs must resolve too (a nav entry with only the generic
//    skeleton means the shell jumps layout on first visit).
const navSources = [
  join(src, "lib", "wallet-nav.ts"),
  join(src, "lib", "security-catalog.ts"),
  join(src, "lib", "settings-pages.ts"),
];
const hrefs = new Set();
for (const file of navSources) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/"(\/(?:security|settings|profile|history|wallet|transfer|mining|custom-address)[^"]*)"/g)) {
    hrefs.add(m[1]);
  }
  for (const m of text.matchAll(/href:\s*"([^"]+)"/g)) hrefs.add(m[1]);
}
for (const href of [...hrefs].sort()) {
  if (!resolves(href)) {
    failures.push(`nav href "${href}" has no skeleton (add it to skeletonsByPath)`);
  }
}

if (failures.length > 0) {
  console.error(`check:skeletons FAILED — ${failures.length} uncovered page(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `check:skeletons OK — ${routeFiles.filter((f) => readFileSync(f, "utf8").includes("WalletPage")).length} WalletPage routes, ${hrefs.size} nav hrefs, all covered by page-specific skeletons.`,
);
