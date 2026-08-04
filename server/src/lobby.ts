import type * as Party from "partykit/server";
import {
  TEAMS,
  TEAM_IDS,
  type LobbyClientMsg,
  type LobbyPlayer,
  type LobbyServerMsg,
} from "@escape-cats/shared";
import { Roster } from "./connections";

/**
 * The team lobby. One room ("main" on this party) for the whole event.
 *
 * Unlike the game rooms, this state is PERSISTED to room.storage. A game room
 * losing its memory costs a team its progress; the lobby losing its memory
 * costs every team its identity, mid-event, with no way to rebuild it except
 * asking forty people who they are. Assignments change a handful of times per
 * event, so writing through on every change is free.
 *
 * Players are remembered by pid even after they disconnect — a phone that
 * locks between sorting and playing must come back to the same team, not
 * reappear as a stranger.
 */
export default class LobbyServer implements Party.Server {
  private roster = new Roster();
  /** pid -> team id. Persisted. */
  private teams = new Map<string, string>();
  /** pid -> display name, kept for players who are currently offline. */
  private names = new Map<string, string>();

  constructor(readonly room: Party.Room) {}

  async onStart() {
    const teams =
      await this.room.storage.get<Record<string, string>>("teams");
    if (teams) this.teams = new Map(Object.entries(teams));
    const names =
      await this.room.storage.get<Record<string, string>>("names");
    if (names) this.names = new Map(Object.entries(names));
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const meta = this.roster.register(conn, ctx, this.proctorToken());
    if (this.isPlayerDevice(meta.role, ctx)) {
      // Don't let a reconnect with the default name overwrite a name the
      // player already gave us.
      if (meta.name !== "Cat" || !this.names.has(meta.pid)) {
        this.names.set(meta.pid, meta.name);
      }
      void this.persist();
    }
    this.broadcast();
  }

  /**
   * Roster downgrades a failed proctor to role "player" with a connection-id
   * pid. That is harmless in a game room, but here it would persist a phantom
   * "Cat" into the roster that the proctor then has to sort — permanently, and
   * once per mistyped token. A real player device always sends its own pid and
   * never claims a role.
   */
  private isPlayerDevice(
    role: string,
    ctx: Party.ConnectionContext,
  ): boolean {
    if (role !== "player") return false;
    const params = new URL(ctx.request.url).searchParams;
    return params.get("pid") !== null && params.get("role") === null;
  }

  onClose(conn: Party.Connection) {
    this.roster.disconnect(conn);
    this.broadcast();
  }

  async onMessage(message: string, sender: Party.Connection) {
    let msg: LobbyClientMsg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const proctor = this.roster.isProctor(sender);
    const me = this.roster.get(sender);

    switch (msg.type) {
      case "rename": {
        if (!me || me.role !== "player") return;
        const name = String(msg.name).slice(0, 24).trim();
        if (!name) return;
        this.roster.rename(sender, name);
        this.names.set(me.pid, name);
        break;
      }
      case "assign": {
        if (!proctor) return;
        const team = msg.team === null ? null : String(msg.team);
        // An unknown team id would strand the player in a room no game
        // serves, so only ids from TEAMS are accepted.
        if (team !== null && !TEAM_IDS.includes(team)) return;
        const pid = String(msg.pid);
        if (!this.names.has(pid)) return;
        if (team === null) this.teams.delete(pid);
        else this.teams.set(pid, team);
        break;
      }
      case "autoAssign": {
        if (!proctor) return;
        this.autoAssign();
        break;
      }
      case "clearTeams": {
        if (!proctor) return;
        this.teams.clear();
        break;
      }
      case "forget": {
        if (!proctor) return;
        const live = this.connectedPids();
        for (const pid of [...this.names.keys()]) {
          if (!live.has(pid)) {
            this.names.delete(pid);
            this.teams.delete(pid);
          }
        }
        break;
      }
    }

    await this.persist();
    this.broadcast();
  }

  /**
   * Round-robin the unassigned across teams, continuing from whichever team is
   * smallest — so pressing it after a few manual assignments evens things out
   * instead of piling everyone onto Team 1.
   */
  private autoAssign() {
    const counts = new Map(TEAM_IDS.map((id) => [id, 0]));
    for (const team of this.teams.values()) {
      counts.set(team, (counts.get(team) ?? 0) + 1);
    }
    for (const pid of this.names.keys()) {
      if (this.teams.has(pid)) continue;
      let smallest = TEAM_IDS[0];
      for (const id of TEAM_IDS) {
        if ((counts.get(id) ?? 0) < (counts.get(smallest) ?? 0)) smallest = id;
      }
      this.teams.set(pid, smallest);
      counts.set(smallest, (counts.get(smallest) ?? 0) + 1);
    }
  }

  private connectedPids(): Set<string> {
    return new Set(
      this.roster
        .list()
        .filter((p) => p.connected)
        .map((p) => p.id),
    );
  }

  private snapshot(): LobbyServerMsg {
    const live = this.connectedPids();
    const players: LobbyPlayer[] = [...this.names.entries()].map(
      ([pid, name]) => ({
        pid,
        name,
        team: this.teams.get(pid) ?? null,
        connected: live.has(pid),
      }),
    );
    return { type: "lobby", snapshot: { players, teams: TEAMS } };
  }

  private broadcast() {
    this.room.broadcast(JSON.stringify(this.snapshot()));
  }

  private async persist() {
    await this.room.storage.put(
      "teams",
      Object.fromEntries(this.teams.entries()),
    );
    await this.room.storage.put(
      "names",
      Object.fromEntries(this.names.entries()),
    );
  }

  private proctorToken(): string {
    return (this.room.env.PROCTOR_TOKEN as string) ?? "dev-proctor";
  }
}
