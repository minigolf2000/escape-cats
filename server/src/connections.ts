import type { Connection, ConnectionContext } from "partyserver";
import type { PlayerInfo } from "@escape-cats/shared";

export interface ConnMeta {
  role: "player" | "proctor";
  pid: string;
  name: string;
}

/**
 * Shared join/presence plumbing for both game rooms.
 *
 * Players carry a persistent `pid` (client-generated, localStorage) so a phone
 * that locks or drops wifi reclaims its seat instead of appearing as a fifth
 * player. `?role=proctor` connections are spectators, never players. The role
 * is a claim, not a credential: the proctor page is a static asset, so a token
 * would ship in its bundle and gate nothing.
 *
 * Every server hibernates, so a connection's meta lives in its WebSocket
 * attachment (`conn.setState`), which survives eviction. `players` is only a
 * cache over that: the offline (a locked phone keeps its seat) and join order
 * (= slot order), both reset by an eviction; `sync` rebuilds it once per wake.
 */
export class Roster {
  private players = new Map<string, PlayerInfo>(); // pid -> info, in join order
  private hydrated = false;

  constructor(private live: () => Iterable<Connection>) {}

  register(conn: Connection, ctx: ConnectionContext): ConnMeta {
    const url = new URL(ctx.request.url);
    const m: ConnMeta = {
      role: url.searchParams.get("role") === "proctor" ? "proctor" : "player",
      pid: url.searchParams.get("pid") ?? conn.id,
      name: url.searchParams.get("name") ?? "Cat",
    };
    conn.setState(m);
    this.adopt(m);
    // A reconnect announces the CURRENT name, so it wins over the cached one:
    // a phone that renamed itself while it was away (the chat's chip, the
    // lobby's) must not come back under the name this room last saw. "Cat" is
    // the placeholder a phone with no name of its own sends, and never
    // overwrites a real one — the same rule the lobby applies to its roster.
    const known = this.players.get(m.pid);
    if (known && m.name !== "Cat") known.name = m.name;
    return m;
  }

  rename(conn: Connection, name: string) {
    const m = this.get(conn);
    if (!m || m.role !== "player") return;
    conn.setState({ ...m, name });
    this.players.get(m.pid)!.name = name; // get() adopted the entry above
  }

  disconnect(conn: Connection) {
    const m = this.get(conn);
    if (!m || m.role !== "player") return;
    // Only mark offline if no other live connection shares the pid. The
    // closing socket is no longer OPEN, so live() already excludes it.
    for (const c of this.live()) {
      const o = this.get(c);
      if (o?.role === "player" && o.pid === m.pid) return;
    }
    this.players.get(m.pid)!.connected = false;
  }

  get(conn: Connection): ConnMeta | undefined {
    const m = (conn.state as ConnMeta | null) ?? undefined;
    if (m) this.adopt(m);
    return m;
  }

  isProctor(conn: Connection): boolean {
    return this.get(conn)?.role === "proctor";
  }

  /** Whether any live connection is a player (not a proctor). */
  hasPlayer(): boolean {
    for (const c of this.live()) if (this.get(c)?.role === "player") return true;
    return false;
  }

  /** Player slot index (0..3), in join order — what hex stamps on teammate
   * taps, and what picks a player's colour on every phone. */
  slot(pid: string): number {
    return Math.max(0, [...this.players.keys()].indexOf(pid));
  }

  list(): PlayerInfo[] {
    this.sync();
    return [...this.players.values()];
  }

  reset() {
    // Re-seat connected players so a mid-session reset orphans nobody.
    this.players.clear();
    this.hydrated = false;
    this.sync();
  }

  /** Rebuild the cache from the live sockets: once per wake (fields reset
   * with an eviction), a no-op on the 4Hz broadcast path otherwise. */
  private sync() {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const c of this.live()) this.get(c);
  }

  private adopt(m: ConnMeta) {
    if (m.role !== "player") return;
    const p = this.players.get(m.pid);
    if (p) p.connected = true;
    else this.players.set(m.pid, { id: m.pid, name: m.name, connected: true });
  }
}
