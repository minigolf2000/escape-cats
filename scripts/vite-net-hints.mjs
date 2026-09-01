/**
 * Two connection hints for the two game clients, added at build time because
 * both depend on things only the build knows: the room server's host, and the
 * hashed name of a chunk that is fetched dynamically.
 *
 * Both games open a websocket to the room server as their first act, and both
 * reach it down the same two-step waterfall:
 *
 *   index.html  ->  the app chunk  ->  import("partysocket")  ->  connect
 *
 * Nothing in the served markup names either the socket's host or partysocket's
 * chunk, so the browser cannot start on them until the app chunk has been
 * fetched AND parsed. Measured on an emulated 4G phone, the partysocket chunk
 * was the LAST request either game made — a round trip that had nothing to do
 * with the bytes and everything to do with when they were discovered.
 *
 * `preconnect` moves DNS + TCP + TLS for the room server off the front of the
 * connection, and `modulepreload` puts the chunk in flight alongside the app
 * chunk instead of behind it. Neither changes a line of runtime code.
 *
 * The dynamic import stays a dynamic import on purpose: the ?debug backend runs
 * the whole game in-page with no socket at all (see each app's debug module),
 * and a preload is a hint the browser may ignore, where a static import is 12KB
 * nobody can decline.
 */

/** Loopback is what `npm run dev` falls back to; a hint to it is noise. */
const isLocal = (host) => /^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(host);

/**
 * @param {object} opts
 * @param {string[]} opts.preloadModules
 *   Substrings matched against a chunk's module ids. Every chunk holding a
 *   match gets a `modulepreload`. Matching on module id rather than chunk name
 *   is deliberate: Vite names a dynamic chunk after the entry that reaches it,
 *   so both apps' partysocket chunk is called `index-<hash>.js` and a
 *   name-based rule would preload the app itself.
 */
export function netHints({ preloadModules = [] } = {}) {
  let base = "/";
  let host = "";
  let isBuild = false;

  return {
    name: "escape-cats:net-hints",
    apply: () => true,
    configResolved(config) {
      base = config.base;
      isBuild = config.command === "build";
      // The same value net.ts reads. Vite has already merged .env files and
      // the process environment by here, so this is exactly what the bundle
      // will be built with.
      host = config.env.VITE_PARTYKIT_HOST || "";
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        // Build only. In dev there is no bundle to name chunks from, and the
        // room server is on the LAN or on loopback — already connected to, or
        // not worth a handshake in advance.
        if (!isBuild) return;
        const tags = [];

        if (host && !isLocal(host)) {
          // No `crossorigin`: preconnect without it warms the CREDENTIALED
          // connection pool, and a WebSocket sends cookies. The anonymous
          // form would open a socket the game then cannot use.
          tags.push({
            tag: "link",
            attrs: { rel: "preconnect", href: `https://${host}` },
            injectTo: "head-prepend",
          });
        }

        for (const [fileName, chunk] of Object.entries(ctx.bundle || {})) {
          if (chunk.type !== "chunk" || chunk.isEntry) continue;
          const hit = (chunk.moduleIds || []).some((id) =>
            preloadModules.some((m) => id.includes(m)),
          );
          if (!hit) continue;
          tags.push({
            tag: "link",
            // `crossorigin` matches the attribute Vite puts on its own module
            // script; a preload fetched in the other mode is a second copy.
            attrs: { rel: "modulepreload", crossorigin: true, href: base + fileName },
            injectTo: "head-prepend",
          });
        }

        return tags;
      },
    },
  };
}
