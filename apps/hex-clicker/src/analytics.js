// Vercel Web Analytics — page views and referrers, nothing else. Cookieless,
// and only in a production build: `npm run dev` never loads the script.
//
// The free (Hobby) tier has no custom events, so a game milestone goes up as a
// VIRTUAL page view under `/progress/…`: one row per milestone in the Pages
// panel, which is all a funnel on this tier can be. Each one spends an event
// from the account's monthly 50k, shared with g00.mba — keep the list short.
//
// `?debug` is a bench, not a player, so it reports nothing.

import { inject, pageview } from "@vercel/analytics";
import { debugFromUrl } from "./transport";

const ON = import.meta.env.PROD && !debugFromUrl();

export function initAnalytics() {
  if (!ON) return;
  inject(
    {
      mode: "production",
      // Path only: the query is ours (`?debug`, `?speed`), not a page.
      beforeSend: (ev) => ({ ...ev, url: ev.url.split(/[?#]/)[0] }),
    },
    __VA_CONF__,
  );
}

/** One milestone, e.g. `milestone("won")` -> `/progress/won`. */
export function milestone(name) {
  if (ON) pageview({ route: `/progress/${name}`, path: `/progress/${name}` });
}
