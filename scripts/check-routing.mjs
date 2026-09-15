/**
 * Crawl each assembled site through a router that implements vercel.json, and
 * fail if any page's links or assets 404. `python -m http.server` cannot catch
 * these: it redirects /x to /x/, the opposite of Vercel's default.
 *
 * Run: node scripts/check-routing.mjs [hex|goomba]
 *
 * There are TWO sites now, one per game, each rooted at `/` on its own domain
 * (scripts/assemble.mjs). That deleted most of what this file used to be: the
 * vanity-domain redirects, the host rules that made them meaningful, and the
 * "a vanity root must land in its game's subdirectory, never the dist root"
 * expectation. A site whose app is at `/` has nowhere else to land. What is
 * left is still worth running — a wrong Vite `base` breaks every asset
 * reference at once, and that is exactly what this catches.
 */
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import { pickSites } from "./sites.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(join(repoRoot, "vercel.json"), "utf8"));

const exists = async (p) => access(p).then(() => true, () => false);

/** Resolve a request the way Vercel does: trailing-slash normalisation, then
 * the filesystem. No redirects or rewrites left to model — if either comes
 * back, this is where it gets implemented. */
function route(pathname) {
  if (!extname(pathname)) {
    const want = config.trailingSlash === true;
    const has = pathname.endsWith("/") && pathname !== "/";
    if (want && !has && pathname !== "/")
      return { status: 308, location: pathname + "/" };
    if (!want && has) return { status: 308, location: pathname.slice(0, -1) };
  }
  return { file: pathname };
}

/** Follow redirects to a final file on disk, inside one site's tree. */
async function fetchPath(dist, pathname) {
  for (let hop = 0; hop < 6; hop++) {
    const res = route(pathname);
    if (res.location) {
      pathname = res.location;
      continue;
    }
    for (const cand of [join(dist, res.file), join(dist, res.file, "index.html")]) {
      if ((await exists(cand)) && extname(cand)) {
        return { status: 200, file: cand, pathname };
      }
    }
    return { status: 404, pathname };
  }
  return { status: 508, pathname };
}

/** Every reference a page makes, resolved against the URL it is served at —
 * markup href/src AND stylesheet url(), since the stylesheets are separate
 * hashed files. */
function refsOf(html, pageUrl) {
  const out = [];
  // `data-href` counts: hex's alternate cat poses park their URL there
  // (warmPoseFrames in hex-clicker/src/cat.js) and still 404 if moved.
  const patterns = [
    /(?:data-)?(?:href|src)="([^"]+)"/g,
    /url\(\s*["']?([^"')]+)["']?\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const raw = m[1].trim();
      if (/^(https?:|data:|mailto:|#|\/\/)/.test(raw)) continue;
      out.push(new URL(raw, "https://x" + pageUrl).pathname);
    }
  }
  return out;
}

let failures = 0;
for (const [name, { out: rel, entries }] of pickSites(process.argv[2])) {
  const dist = join(repoRoot, rel);
  if (!(await exists(dist))) {
    console.log(`FAIL  ${name}: ${rel} does not exist — assemble it first`);
    failures++;
    continue;
  }
  console.log(`\n${name}  (${rel})`);
  for (const entry of entries) {
    const page = await fetchPath(dist, entry);
    if (page.status !== 200) {
      console.log(`FAIL  ${entry}  -> HTTP ${page.status}`);
      failures++;
      continue;
    }
    console.log(`ok    ${entry}  -> ${page.pathname}`);
    if (extname(page.file) !== ".html") continue;
    const html = await readFile(page.file, "utf8");
    for (const ref of refsOf(html, page.pathname)) {
      const sub = await fetchPath(dist, ref);
      if (sub.status !== 200) {
        console.log(`  FAIL  ${ref}  -> HTTP ${sub.status}`);
        failures++;
        continue;
      }
      console.log(`  ok    ${ref}`);
      // A linked stylesheet is a page of refs in its own right.
      if (extname(sub.file) !== ".css") continue;
      const css = await readFile(sub.file, "utf8");
      for (const cssRef of refsOf(css, sub.pathname)) {
        const asset = await fetchPath(dist, cssRef);
        if (asset.status !== 200) {
          console.log(`    FAIL  ${cssRef}  -> HTTP ${asset.status}`);
          failures++;
        } else {
          console.log(`    ok    ${cssRef}`);
        }
      }
    }
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll routes and refs OK");
process.exit(failures ? 1 : 0);
