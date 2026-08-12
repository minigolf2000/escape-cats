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
 * Players carry a persistent `pid` (client-generated, stored in
 * localStorage) so a phone that locks or drops wifi reclaims its seat on
 * reconnect instead of appearing as a fifth player. Proctor connections
 * declare ?role=proctor and are spectators, never players.
 *
 * The role is a claim, not a credential — anyone can append it. That is
 * deliberate: the proctor page is a static asset, so any token it sent would
 * ship in its own bundle and gate nothing. The only power the role carries
 * is reset on your own room, which is not worth defending here.
 *
 * Every server here hibernates, so a connection's meta lives in its WebSocket
 * attachment (`conn.setState`), which the runtime persists with the socket —
 * the object can be evicted mid-connection and the meta comes back with the
 * wake. The `players` map is only a cache on top of that: it remembers the
 * offline (a phone that locked keeps its seat in the list) and join order
 * (which is slot order), both of which reset with an eviction — the same
 * lifetime they had before hibernation, when an eviction closed every socket.
 * After a wake, `sync` rebuilds the cache from the live sockets, once.
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

  /** Player slot index (0..3) for slingshot placement etc. */
  slot(pid: string): number {
    return Math.max(0, [...this.players.keys()].indexOf(pid));
  }

  list(): PlayerInfo[] {
    this.sync();
    return [...this.players.values()];
  }

  reset() {
    // Re-seat currently connected players so a mid-session proctor reset
    // doesn't orphan anyone.
    this.players.clear();
    this.hydrated = false;
    this.sync();
  }

  /** Rebuild the cache from the live sockets — needed once per wake (the
   * instance fields reset with an eviction, so `hydrated` re-arms itself),
   * a no-op on the 4Hz broadcast path the rest of the time. */
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
