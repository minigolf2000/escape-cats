/**
 * Two connection hints for the game clients, added at build time because both
 * need what only the build knows: the room server's host, and the hashed name
 * of the dynamically imported partysocket chunk. Nothing in the markup names
 * either, so the browser cannot start on them until the app chunk is fetched
 * AND parsed. `preconnect` moves DNS+TCP+TLS off the front; `modulepreload`
 * puts the chunk in flight alongside the app chunk.
 *
 * The dynamic import stays dynamic: ?debug runs the whole game in-page with
 * no socket, and a preload is a hint the browser may ignore where a static
 * import is 12KB nobody can decline.
 */

/** Loopback is what `npm run dev` falls back to; a hint to it is noise. */
const isLocal = (host) => /^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(host);

/**
 * @param {object} opts
 * @param {string[]} opts.preloadModules
 *   Substrings matched against a chunk's MODULE ids, not its name: Vite names
 *   a dynamic chunk after the entry that reaches it (`index-<hash>.js`), so a
 *   name rule would preload the app itself.
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
      // Vite has merged .env files by here — exactly what the bundle is built
      // with.
      host = config.env.VITE_PARTYKIT_HOST || "";
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        // Build only: in dev there is no bundle to name chunks from, and the
        // server is on loopback/LAN.
        if (!isBuild) return;
        const tags = [];

        if (host && !isLocal(host)) {
          // No `crossorigin`: preconnect without it warms the CREDENTIALED
          // pool, and a WebSocket sends cookies; the anonymous form opens a
          // socket the game cannot use.
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
