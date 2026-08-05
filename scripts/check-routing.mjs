/**
 * Crawl the assembled dist/ through a router that implements vercel.json, and
 * fail if any page's own links or assets 404.
 *
 * This exists because two production-only breakages got past manual checks.
 * Both were the same shape: a page served at a URL whose directory depth
 * differed from what its relative references assumed. `python -m http.server`
 * cannot catch them — it redirects /x to /x/, the opposite of Vercel's default,
 * so it silently serves builds that are broken in production.
 *
 * Run: node scripts/check-routing.mjs
 */
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(repoRoot, "dist");
const config = JSON.parse(
  await readFile(join(repoRoot, "vercel.json"), "utf8"),
);
const ORIGIN = "https://cat-games-tau.vercel.app";

const exists = async (p) => access(p).then(() => true, () => false);

/** path-to-regexp-lite: supports the /:path* and /literal forms we use. */
function matchSource(source, pathname) {
  if (source.endsWith("/:path*")) {
    const prefix = source.slice(0, -"/:path*".length);
    if (pathname === prefix || pathname === prefix + "/") return { path: "" };
    if (pathname.startsWith(prefix + "/"))
      return { path: pathname.slice(prefix.length + 1) };
    return null;
  }
  return source === pathname ? {} : null;
}

/**
 * Resolve a request the way Vercel does: trailing-slash normalisation first,
 * then redirects, then rewrites, then the filesystem.
 * Returns { status, file, location }.
 */
function route(pathname, host = "cat-games-tau.vercel.app") {
  // trailingSlash, which skips paths carrying a file extension.
  if (!extname(pathname)) {
    const want = config.trailingSlash === true;
    const has = pathname.endsWith("/") && pathname !== "/";
    if (want && !has && pathname !== "/")
      return { status: 308, location: pathname + "/" };
    if (!want && has) return { status: 308, location: pathname.slice(0, -1) };
  }
  for (const r of config.redirects ?? []) {
    const hostRule = r.has?.find((h) => h.type === "host");
    if (hostRule && hostRule.value !== host) continue;
    const m = matchSource(r.source, pathname);
    if (m)
      return {
        status: r.permanent ? 308 : 307,
        location: r.destination.replace(":path*", m.path ?? ""),
      };
  }
  for (const r of config.rewrites ?? []) {
    const hostRule = r.has?.find((h) => h.type === "host");
    if (hostRule && hostRule.value !== host) continue;
    if (matchSource(r.source, pathname)) return { file: r.destination };
  }
  return { file: pathname };
}

/** Follow redirects (within our own origin) to a final file on disk. */
async function fetchPath(pathname, host) {
  for (let hop = 0; hop < 6; hop++) {
    const res = route(pathname, host);
    if (res.location) {
      const loc = res.location.startsWith(ORIGIN)
        ? res.location.slice(ORIGIN.length)
        : res.location;
      if (!loc.startsWith("/")) return { status: 0, external: res.location };
      pathname = loc;
      host = "cat-games-tau.vercel.app";
      continue;
    }
    for (const cand of [
      join(DIST, res.file),
      join(DIST, res.file, "index.html"),
    ]) {
      if ((await exists(cand)) && extname(cand)) {
        return { status: 200, file: cand, pathname };
      }
    }
    return { status: 404, pathname };
  }
  return { status: 508, pathname };
}

/** Every reference a page makes, resolved against the URL it is served at. */
function refsOf(html, pageUrl) {
  const out = [];
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (/^(https?:|data:|mailto:|#|\/\/)/.test(raw)) continue;
    out.push(new URL(raw, "https://x" + pageUrl).pathname);
  }
  return out;
}

const ENTRIES = [
  ["/", "cat-games-tau.vercel.app"],
  ["/hexxygon", "cat-games-tau.vercel.app"],
  ["/proctor", "cat-games-tau.vercel.app"],
  ["/g00mBa", "cat-games-tau.vercel.app"],
  ["/prototypes", "cat-games-tau.vercel.app"],
  ["/solo-hex", "cat-games-tau.vercel.app"],
  ["/qr-studio", "cat-games-tau.vercel.app"],
  ["/reveal-lab", "cat-games-tau.vercel.app"],
  ["/", "hexxygon.com"],
  ["/", "www.hexxygon.com"],
  ["/", "g00.mba"],
  // Both forms: the slashed one exercises the /ar redirect on the vanity host,
  // the bare one exercises the trailingSlash 308 that precedes it. Either must
  // beat the host's /:path* catch-all, which would otherwise send /ar into
  // /g00mBa/ar and 404.
  ["/ar/", "g00.mba"],
  ["/ar", "g00.mba"],
  ["/ar/", "www.g00.mba"],
  ["/ar", "cat-games-tau.vercel.app"],
];

let failures = 0;
for (const [entry, host] of ENTRIES) {
  const page = await fetchPath(entry, host);
  const label = `${host}${entry}`;
  if (page.status !== 200) {
    console.log(`FAIL  ${label}  -> HTTP ${page.status}`);
    failures++;
    continue;
  }
  console.log(`ok    ${label}  -> ${page.pathname}`);
  if (extname(page.file) !== ".html") continue;
  const html = await readFile(page.file, "utf8");
  for (const ref of refsOf(html, page.pathname)) {
    const sub = await fetchPath(ref, "cat-games-tau.vercel.app");
    if (sub.status !== 200) {
      console.log(`  FAIL  ${ref}  -> HTTP ${sub.status}`);
      failures++;
    } else {
      console.log(`  ok    ${ref}`);
    }
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll routes and refs OK");
process.exit(failures ? 1 : 0);
