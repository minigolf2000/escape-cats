import type * as Party from "partykit/server";
import {
  HexSim,
  SNAPSHOT_TICK_MS,
  type HexClientMsg,
  type HexServerMsg,
} from "@escape-cats/shared";
import { Roster } from "./connections";

// The room server is transport only: every game rule lives in the shared
// HexSim (packages/shared/src/hex/sim.ts), which the client's ?solo mode runs
// too. If you're changing what a purchase or a pet does, change the sim.
export default class HexServer implements Party.Server {
  private roster = new Roster();
  private sim = new HexSim(Date.now());
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {}

  onStart() {
    this.ticker = setInterval(() => {
      this.sim.tick(Date.now());
      this.broadcast();
    }, SNAPSHOT_TICK_MS);
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    this.roster.register(conn, ctx, this.proctorToken());
    this.broadcast();
  }

  onClose(conn: Party.Connection) {
    this.roster.disconnect(conn);
    this.broadcast();
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: HexClientMsg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const now = Date.now();
    const proctor = this.roster.isProctor(sender);
    switch (msg.type) {
      case "join":
        this.roster.rename(sender, String(msg.name).slice(0, 24));
        break;
      case "pets":
        // No broadcast: four phones flushing taps at 10Hz would mean ~40 full
        // snapshots/sec fanned out to the room, and pets only move numbers the
        // phones already show optimistically. The next tick (250ms) carries it.
        if (!proctor) this.sim.pets(msg.count, now);
        return;
      case "buyBuilding":
        if (!proctor) this.sim.buyBuilding(String(msg.id), now);
        break;
      case "buyUpgrade":
        if (!proctor) this.sim.buyUpgrade(String(msg.key), now);
        break;
      case "catchGold":
        if (!proctor) this.sim.catchGold(msg.id, now);
        break;
      case "reset":
        if (!proctor) return;
        this.sim.reset(now);
        this.roster.reset();
        break;
      case "speed": {
        // Dev time-scale for rehearsals: accelerates income + golden cadence,
        // never click feel. Proctor only, clamped to something sane.
        if (!proctor) return;
        const m = Number(msg.mult);
        this.sim.state.speed = Number.isFinite(m)
          ? Math.max(0.25, Math.min(50, m))
          : 1;
        break;
      }
    }
    this.broadcast();
  }

  private proctorToken(): string {
    return (this.room.env.PROCTOR_TOKEN as string) ?? "dev-proctor";
  }

  private broadcast() {
    const state = this.sim.snapshot(
      Date.now(),
      this.roster.list(),
      this.room.env.HEX_CODEWORD as string | undefined,
    );
    const msg: HexServerMsg = { type: "state", state };
    this.room.broadcast(JSON.stringify(msg));
  }
}

HexServer satisfies Party.Worker;
