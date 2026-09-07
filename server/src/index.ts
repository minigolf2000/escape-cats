// Worker entry: routes a WebSocket upgrade to its Durable Object.
// `routePartykitRequest` matches PartyKit's /parties/:party/:room, so the
// clients' `partysocket` connections need nothing; :party is the kebab-cased
// BINDING name (wrangler.jsonc), which is why the bindings are not class names.

import { routePartykitRequest } from "partyserver";
import { isTeamRoom } from "@escape-cats/shared";

export { HexServer } from "./hex";
export { LobbyServer } from "./lobby";
export { ChatServer } from "./chat";
export { GoombaServer } from "./goomba";

/** `/parties/chat/<room>` — the only party whose room id is a closed list. */
const CHAT_ROOM = /^\/parties\/chat\/([^/]+)\/?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Chat is the four teams and nothing else, and this is the one place that
    // rule lives on the wire — refused HERE rather than in ChatServer so a
    // room nobody may join never wakes a Durable Object. `t0`, an ad-hoc slug
    // and a typo are the same 404; the games still take both (`roomFor`).
    const chat = CHAT_ROOM.exec(new URL(request.url).pathname);
    if (chat && !isTeamRoom(decodeURIComponent(chat[1]))) {
      return new Response("No such chat room", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
    }
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
