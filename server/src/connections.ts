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
 */
export class Roster {
  private meta = new Map<string, ConnMeta>(); // connection.id -> meta
  private players = new Map<string, PlayerInfo>(); // pid -> info

  register(conn: Connection, ctx: ConnectionContext): ConnMeta {
    const url = new URL(ctx.request.url);
    const m: ConnMeta = {
      role: url.searchParams.get("role") === "proctor" ? "proctor" : "player",
      pid: url.searchParams.get("pid") ?? conn.id,
      name: url.searchParams.get("name") ?? "Cat",
    };
    this.meta.set(conn.id, m);
    if (m.role === "player") {
      this.players.set(m.pid, { id: m.pid, name: m.name, connected: true });
    }
    return m;
  }

  rename(conn: Connection, name: string) {
    const m = this.meta.get(conn.id);
    if (!m || m.role !== "player") return;
    m.name = name;
    const p = this.players.get(m.pid);
    if (p) p.name = name;
  }

  disconnect(conn: Connection) {
    const m = this.meta.get(conn.id);
    this.meta.delete(conn.id);
    if (!m || m.role !== "player") return;
    // Only mark offline if no other live connection shares the pid.
    const stillHere = [...this.meta.values()].some(
      (o) => o.role === "player" && o.pid === m.pid,
    );
    const p = this.players.get(m.pid);
    if (p && !stillHere) p.connected = false;
  }

  get(conn: Connection): ConnMeta | undefined {
    return this.meta.get(conn.id);
  }

  isProctor(conn: Connection): boolean {
    return this.meta.get(conn.id)?.role === "proctor";
  }

  /** Player slot index (0..3) for slingshot placement etc. */
  slot(pid: string): number {
    return Math.max(0, [...this.players.keys()].indexOf(pid));
  }

  list(): PlayerInfo[] {
    return [...this.players.values()];
  }

  reset() {
    this.players.clear();
    // Re-seat currently connected players so a mid-session proctor reset
    // doesn't orphan anyone.
    for (const m of this.meta.values()) {
      if (m.role === "player") {
        this.players.set(m.pid, { id: m.pid, name: m.name, connected: true });
      }
    }
  }
}
