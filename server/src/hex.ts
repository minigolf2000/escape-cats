import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  HexSim,
  SNAPSHOT_TICK_MS,
  type HexPersistedV1,
  type HexClientMsg,
  type HexServerMsg,
  type TapEvent,
} from "@escape-cats/shared";
import { Roster } from "./connections";

/** Write-behind cadence for the room's saved game. */
const PERSIST_MS = 5_000;

/** One wire coordinate (thousandths of Hex's box) back to a 0..1 fraction, or
 * undefined for anything that isn't one — a client from before the field
 * existed, a short array, a hand-crafted socket. Undefined is a supported
 * answer all the way down: the tap replays scattered instead of at a spot, and
 * JSON.stringify drops the key on its way back out. */
function fraction(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(1, v / 1000));
}

// The room server is transport only: every game rule lives in the shared
// HexSim (packages/shared/src/hex/sim.ts), which the client's ?debug mode runs
// too. If you're changing what a purchase or a pet does, change the sim.
export class HexServer extends Server<Env> {
  // Hibernation keeps idle sockets from billing duration: without it, every
  // open WebSocket pins the object in memory around the clock, and one
  // forgotten proctor tab spends the day's GB-seconds on rooms nobody is
  // playing in. Everything per-connection lives in the socket attachment
  // (Roster) or tolerates a wake-time reset (petSeq/petAcked re-sync on the
  // next pets batch).
  static options = { hibernate: true };

  private roster = new Roster(() => this.getConnections());
  private sim = new HexSim(Date.now());
  /** conn.id -> highest `pets` batch seq received, and the last one acked. */
  private petSeq = new Map<string, number>();
  private petAcked = new Map<string, number>();
  /** Taps since the last broadcast, stamped in server time. Presentation only:
   * the bank already counted them, these just let every phone replay a
   * teammate's rhythm and spot. Cleared on every broadcast. */
  private taps: TapEvent[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private persister: ReturnType<typeof setInterval> | null = null;

  async onStart() {
    // Rehydrate BEFORE any connection is served — PartyKit holds connections
    // until onStart resolves, so no snapshot of the blank sim can ever leak
    // out. The tick/persist loops are NOT started here: they run only while
    // someone is connected (see wake/sleep), because pending timers keep the
    // object pinned in memory — an empty room holding a ticker bills for
    // duration around the clock instead of letting the runtime evict it.
    const saved = await this.ctx.storage.get<HexPersistedV1>("hex");
    if (saved?.v === 1) this.sim.restore(saved, Date.now());
  }

  /** The loops run iff a player is connected — this is the one place that
   * invariant lives. A proctor is a spectator of a paused game (sim.tick
   * clamps idle dt, so nothing moves): they get a snapshot on connect and on
   * every player-driven broadcast, and running the 4Hz loop for them is what
   * used to keep all four rooms resident whenever the proctor page was open. */
  private syncLoops() {
    if (this.roster.hasPlayer()) this.wake();
    else this.sleep();
  }

  /** Start the loops. Idempotent. Resuming after a sleep is safe
   * income-wise: sim.tick clamps dt to 2s, so an afternoon spent idle
   * credits nothing. */
  private wake() {
    this.ticker ??= setInterval(() => {
      this.sim.tick(Date.now());
      this.broadcastState();
    }, SNAPSHOT_TICK_MS);
    // Write-behind, not write-through: the sim mutates 4x/sec on its own
    // (income), so per-change writes would be nearly per-tick writes. A 5s
    // cadence bounds an eviction's loss to 5s of a 10-minute game — and the
    // restore's offline credit covers most of even that.
    this.persister ??= setInterval(() => void this.persist(), PERSIST_MS);
  }

  /** Stop the loops and save, leaving the room evictable. Pending intervals
   * block hibernation, so without this the object stays resident — billed
   * duration around the clock — for a room nobody is playing in. Proctors may
   * still be connected when this runs: they are spectators of a paused game
   * (sim.tick clamps idle dt to 2s, so nothing moves), and the snapshot they
   * got on connect is as current as a 4Hz feed of it would be. */
  private sleep() {
    if (!this.ticker && !this.persister) return; // already asleep
    clearInterval(this.ticker);
    clearInterval(this.persister);
    this.ticker = this.persister = null;
    void this.persist();
  }

  private persist() {
    return this.ctx.storage.put("hex", this.sim.persisted(Date.now()));
  }

  onConnect(conn: Connection, ctx: ConnectionContext) {
    this.roster.register(conn, ctx);
    this.syncLoops();
    this.broadcastState();
  }

  onClose(conn: Connection) {
    this.petSeq.delete(conn.id);
    this.petAcked.delete(conn.id);
    this.roster.disconnect(conn);
    this.broadcastState();
    this.syncLoops();
  }

  onMessage(sender: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    let msg: HexClientMsg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const now = Date.now();
    const me = this.roster.get(sender);
    const proctor = me?.role === "proctor";
    // A player message proves a player is here — the cheap special case of
    // syncLoops(). It exists for the runtime evicting a hibernated room
    // whose player sockets stayed open: the next tap batch re-arms the loops.
    if (!proctor) this.wake();
    switch (msg.type) {
      case "join":
        this.roster.rename(sender, String(msg.name).slice(0, 24));
        break;
      case "pets": {
        this.petSeq.set(sender.id, Number(msg.seq) || 0);
        if (!proctor && me) {
          const slot = this.roster.slot(me.pid);
          // Offsets are ms before the client sent the batch, so they preserve
          // the spacing between taps. Everything shifts later by the one-way
          // latency, which is uniform and therefore invisible in the rhythm.
          // xs/ys are the same taps' spots on Hex, in thousandths of her box.
          // All three arrays are index-aligned; each is read defensively on its
          // own, so a batch missing one still carries the others.
          const offsets = Array.isArray(msg.offsets) ? msg.offsets : [];
          const xs = Array.isArray(msg.xs) ? msg.xs : [];
          const ys = Array.isArray(msg.ys) ? msg.ys : [];
          for (let i = 0; i < msg.count; i++) {
            const off = Number(offsets[i]);
            this.taps.push({
              slot,
              at: now + (Number.isFinite(off) ? Math.min(0, off) : 0),
              x: fraction(xs[i]),
              y: fraction(ys[i]),
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
      case "won":
        // The one intent that is the PROCTOR's game action rather than their
        // housekeeping: they heard the code word, so the room is won. Same
        // write-through as reset below, and for the same reason — rehydrating a
        // pre-win save would silently un-win a team who are already looking at
        // their splash.
        if (!proctor) return;
        this.sim.setWon(msg.won !== false, now);
        void this.persist();
        break;
      case "reset":
        if (!proctor) return;
        this.sim.reset(now);
        this.roster.reset();
        // Write-through, like the win mark above and unlike every player
        // mutation: rehydrating the PREVIOUS run after an eviction would
        // silently undo the proctor's reset.
        void this.persist();
        break;
    }
    this.broadcastState();
  }

  private broadcastState() {
    // Acks go out BEFORE the snapshot. Message order is preserved per
    // connection, so each client drops its in-flight taps first and then adds
    // the authoritative bank — it never counts the same tap twice, not even
    // for one frame.
    for (const conn of this.getConnections()) {
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
    this.broadcast(JSON.stringify(msg));
  }
}
