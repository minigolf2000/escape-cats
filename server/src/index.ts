// Worker entry: routes a WebSocket upgrade to its Durable Object.
// `routePartykitRequest` matches PartyKit's /parties/:party/:room, so the
// clients' `partysocket` connections need nothing; :party is the kebab-cased
// BINDING name (wrangler.jsonc), which is why the bindings are not class names.

import { routePartykitRequest } from "partyserver";

export { HexServer } from "./hex";
export { LobbyServer } from "./lobby";
export { ChatServer } from "./chat";
export { GoombaServer } from "./goomba";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ??
      // Not a room connection; the games are on Vercel, nothing to serve here.
      new Response("Escape Cats room server", {
        status: 404,
        headers: { "content-type": "text/plain" },
      })
    );
  },
};
