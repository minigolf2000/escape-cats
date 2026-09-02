/**
 * Crawl the assembled dist/ through a router that implements vercel.json, and
 * fail if any page's links or assets 404. `python -m http.server` cannot
 * catch these: it redirects /x to /x/, the opposite of Vercel's default.
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
const ORIGIN_HOST = "escape-cats.vercel.app";
const ORIGIN = `https://${ORIGIN_HOST}`;

const exists = async (p) => access(p).then(() => true, () => false);

/** path-to-regexp-lite: supports the /:path* and /literal forms we use. */
function matchSource(source, pathname) {
  if (source.endsWith("/:path*")) {
    const prefix = source.slice(0, -"/:path*".length);
    // `/:path*` does NOT match a bare directory on Vercel — the tail must be
    // non-empty, for ANY prefix, root included. That directory needs its own
    // literal rule, listed first. `trailingSlash: true` turns `/chat` into
    // `/chat/` BEFORE redirects run, so the empty-tail form is the only one
    // these rules are ever asked about.
    if (pathname === prefix + "/" || (prefix === "" && pathname === "/"))
      return null;
    if (pathname === prefix) return { path: "" };
    if (pathname.startsWith(prefix + "/"))
      return { path: pathname.slice(prefix.length + 1) };
    return null;
  }
  return source === pathname ? {} : null;
}

/** Resolve a request the way Vercel does: trailing-slash normalisation, then
 * redirects, rewrites, filesystem. Returns { status, file, location }. */
function route(pathname, host = ORIGIN_HOST) {
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
      host = ORIGIN_HOST;
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

/** [entry, host, expected-landing-path]. The third element is what makes a
 * vanity check meaningful: a root landing on the WRONG app still resolves to
 * a file whose refs resolve. */
const ENTRIES = [
  // The origin root legitimately serves the lobby from the dist root.
  ["/", ORIGIN_HOST, "/"],
  ["/hexxygon", ORIGIN_HOST, "/hexxygon/"],
  ["/proctor", ORIGIN_HOST, "/proctor/"],
  ["/chat", ORIGIN_HOST, "/chat/"],
  ["/g00mBa", ORIGIN_HOST, "/g00mBa/"],
  ["/qr-studio", ORIGIN_HOST, "/qr-studio/"],
  ["/reveal-lab", ORIGIN_HOST, "/reveal-lab/"],
  // A retired host gets no row: this models vercel.json against dist/, but
  // Vercel rejects an unattached host at the edge before the config is
  // consulted, so a green row would be a simulation artifact.
  // Vanity roots MUST land in their game's subdirectory, never the dist root.
  ["/", "hexxygon.com", "/hexxygon/"],
  ["/", "www.hexxygon.com", "/hexxygon/"],
  ["/", "g00.mba", "/g00mBa/"],
  ["/", "www.g00.mba", "/g00mBa/"],
];

let failures = 0;
for (const [entry, host, expect] of ENTRIES) {
  const page = await fetchPath(entry, host);
  const label = `${host}${entry}`;
  if (page.status !== 200) {
    console.log(`FAIL  ${label}  -> HTTP ${page.status}`);
    failures++;
    continue;
  }
  if (expect && page.pathname !== expect) {
    console.log(
      `FAIL  ${label}  -> ${page.pathname}  (expected ${expect})`,
    );
    failures++;
    continue;
  }
  console.log(`ok    ${label}  -> ${page.pathname}`);
  if (extname(page.file) !== ".html") continue;
  const html = await readFile(page.file, "utf8");
  for (const ref of refsOf(html, page.pathname)) {
    const sub = await fetchPath(ref, ORIGIN_HOST);
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
      const asset = await fetchPath(cssRef, ORIGIN_HOST);
      if (asset.status !== 200) {
        console.log(`    FAIL  ${cssRef}  -> HTTP ${asset.status}`);
        failures++;
      } else {
        console.log(`    ok    ${cssRef}`);
      }
    }
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll routes and refs OK");
process.exit(failures ? 1 : 0);
