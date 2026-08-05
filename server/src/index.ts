// Worker entry. Both game surfaces are Durable Objects; this module is only the
// front door that routes an incoming WebSocket upgrade to the right one.
//
// `routePartykitRequest` matches PartyKit's URL shape — /parties/:party/:room —
// so the clients' `partysocket` connections are unchanged from when this ran on
// the PartyKit platform. The :party segment is the kebab-cased BINDING name
// (see wrangler.jsonc), which is why the bindings are `Main` and `Lobby` rather
// than the class names: `main` is partysocket's default party, and `lobby` is
// what the proctor and the landing page already ask for.

import { routePartykitRequest } from "partyserver";

export { HexServer } from "./hex";
export { LobbyServer } from "./lobby";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ??
      // Anything that isn't a room connection. The games are served from
      // Vercel, so there is no site here to fall back to.
      new Response("Escape Cats room server", {
        status: 404,
        headers: { "content-type": "text/plain" },
      })
    );
  },
};
