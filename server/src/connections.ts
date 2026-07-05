import type * as Party from "partykit/server";
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
 * authenticate with ?role=proctor&token=... and are spectators, never
 * players.
 */
export class Roster {
  private meta = new Map<string, ConnMeta>(); // connection.id -> meta
  private players = new Map<string, PlayerInfo>(); // pid -> info

  register(conn: Party.Connection, ctx: Party.ConnectionContext, proctorToken: string): ConnMeta {
    const url = new URL(ctx.request.url);
    const isProctor =
      url.searchParams.get("role") === "proctor" &&
      url.searchParams.get("token") === proctorToken;
    const m: ConnMeta = {
      role: isProctor ? "proctor" : "player",
      pid: url.searchParams.get("pid") ?? conn.id,
      name: url.searchParams.get("name") ?? "Cat",
    };
    this.meta.set(conn.id, m);
    if (m.role === "player") {
      this.players.set(m.pid, { id: m.pid, name: m.name, connected: true });
    }
    return m;
  }

  rename(conn: Party.Connection, name: string) {
    const m = this.meta.get(conn.id);
    if (!m || m.role !== "player") return;
    m.name = name;
    const p = this.players.get(m.pid);
    if (p) p.name = name;
  }

  disconnect(conn: Party.Connection) {
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

  get(conn: Party.Connection): ConnMeta | undefined {
    return this.meta.get(conn.id);
  }

  isProctor(conn: Party.Connection): boolean {
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
