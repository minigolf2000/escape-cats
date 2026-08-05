import type * as Party from "partykit/server";
import {
  HexSim,
  SNAPSHOT_TICK_MS,
  type HexClientMsg,
  type HexServerMsg,
  type TapEvent,
} from "@escape-cats/shared";
import { Roster } from "./connections";

// The room server is transport only: every game rule lives in the shared
// HexSim (packages/shared/src/hex/sim.ts), which the client's ?solo mode runs
// too. If you're changing what a purchase or a pet does, change the sim.
export default class HexServer implements Party.Server {
  private roster = new Roster();
  private sim = new HexSim(Date.now());
  /** conn.id -> highest `pets` batch seq received, and the last one acked. */
  private petSeq = new Map<string, number>();
  private petAcked = new Map<string, number>();
  /** Taps since the last broadcast, stamped in server time. Presentation only:
   * the bank already counted them, these just let every phone replay a
   * teammate's rhythm. Cleared on every broadcast. */
  private taps: TapEvent[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {}

  onStart() {
    this.ticker = setInterval(() => {
      this.sim.tick(Date.now());
      this.broadcast();
    }, SNAPSHOT_TICK_MS);
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    this.roster.register(conn, ctx);
    this.broadcast();
  }

  onClose(conn: Party.Connection) {
    this.petSeq.delete(conn.id);
    this.petAcked.delete(conn.id);
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
      case "pets": {
        this.petSeq.set(sender.id, Number(msg.seq) || 0);
        const me = this.roster.get(sender);
        if (!proctor && me) {
          const slot = this.roster.slot(me.pid);
          // Offsets are ms before the client sent the batch, so they preserve
          // the spacing between taps. Everything shifts later by the one-way
          // latency, which is uniform and therefore invisible in the rhythm.
          const offsets = Array.isArray(msg.offsets) ? msg.offsets : [];
          for (let i = 0; i < msg.count; i++) {
            const off = Number(offsets[i]);
            this.taps.push({
              slot,
              at: now + (Number.isFinite(off) ? Math.min(0, off) : 0),
            });
          }
        }
        // No broadcast: four phones flushing taps at 10Hz would mean ~40 full
        // snapshots/sec fanned out to the room, and pets only move numbers the
        // phones already show optimistically. The next tick (250ms) carries it.
        if (!proctor) this.sim.pets(msg.count, now);
        return;
      }
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

  private broadcast() {
    // Acks go out BEFORE the snapshot. Message order is preserved per
    // connection, so each client drops its in-flight taps first and then adds
    // the authoritative bank — it never counts the same tap twice, not even
    // for one frame.
    for (const conn of this.room.getConnections()) {
      const seq = this.petSeq.get(conn.id);
      if (seq !== undefined && this.petAcked.get(conn.id) !== seq) {
        const ack: HexServerMsg = { type: "petAck", seq };
        conn.send(JSON.stringify(ack));
        this.petAcked.set(conn.id, seq);
      }
    }
    const state = this.sim.snapshot(Date.now(), this.roster.list(), this.taps);
    this.taps = [];
    const msg: HexServerMsg = { type: "state", state };
    this.room.broadcast(JSON.stringify(msg));
  }
}

HexServer satisfies Party.Worker;
