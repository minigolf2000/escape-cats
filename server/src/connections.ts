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
 * `get` and `list` re-adopt live connections into the cache, so presence
 * self-heals after a wake.
 */
export class Roster {
  private players = new Map<string, PlayerInfo>(); // pid -> info, in join order

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
    const p = this.players.get(m.pid);
    if (p) p.name = name;
  }

  /**
   * Marks the player offline unconditionally; if another live connection
   * shares the pid, the next `list` re-adopts it as connected. (The closing
   * socket itself is never re-adopted — hibernating `getConnections` only
   * yields OPEN sockets, and this one is already closing.)
   */
  disconnect(conn: Connection) {
    const m = this.get(conn);
    if (!m || m.role !== "player") return;
    const p = this.players.get(m.pid);
    if (p) p.connected = false;
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
  hasPlayer(live: Iterable<Connection>): boolean {
    for (const c of live) if (this.get(c)?.role === "player") return true;
    return false;
  }

  /** Player slot index (0..3) for slingshot placement etc. */
  slot(pid: string): number {
    return Math.max(0, [...this.players.keys()].indexOf(pid));
  }

  list(live: Iterable<Connection>): PlayerInfo[] {
    for (const c of live) this.get(c); // re-adopt after a hibernation wake
    return [...this.players.values()];
  }

  reset(live: Iterable<Connection>) {
    this.players.clear();
    // Re-seat currently connected players so a mid-session proctor reset
    // doesn't orphan anyone.
    for (const c of live) this.get(c);
  }

  private adopt(m: ConnMeta) {
    if (m.role !== "player") return;
    const p = this.players.get(m.pid);
    if (p) p.connected = true;
    else this.players.set(m.pid, { id: m.pid, name: m.name, connected: true });
  }
}
