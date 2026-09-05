import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  HexSim,
  SNAPSHOT_TICK_MS,
  isAdhocRoom,
  type HexPersistedV1,
  type HexClientMsg,
  type HexServerMsg,
  type TapEvent,
} from "@escape-cats/shared";
import { Roster } from "./connections";

/** Write-behind cadence for the room's saved game. */
const PERSIST_MS = 5_000;

/** Wire coordinate (thousandths of Hex's box) to a 0..1 fraction, or undefined
 * for anything else — undefined replays the tap scattered, and JSON.stringify
 * drops the key. */
function fraction(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(1, v / 1000));
}

// Transport only: every rule lives in the shared HexSim
// (packages/shared/src/hex/sim.ts), which ?debug runs in-page too.
export class HexServer extends Server<Env> {
  // Hibernate, or one forgotten proctor tab pins four rooms resident all day.
  // Per-connection state lives in the socket attachment (Roster) or re-syncs
  // on the next pets batch (petSeq/petAcked).
  static options = { hibernate: true };

  private roster = new Roster(() => this.getConnections());
  private sim = new HexSim(Date.now());
  /** conn.id -> highest `pets` batch seq received, and the last one acked. */
  private petSeq = new Map<string, number>();
  private petAcked = new Map<string, number>();
  /** Taps since the last broadcast, in server time. Presentation only: the
   * bank already counted them. Cleared on every broadcast. */
  private taps: TapEvent[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private persister: ReturnType<typeof setInterval> | null = null;

  async onStart() {
    // Rehydrate BEFORE serving: partyserver holds connections until onStart
    // resolves. The loops are NOT started here — pending timers block
    // hibernation, so they run only while a player is connected (wake/sleep).
    const saved = await this.ctx.storage.get<HexPersistedV1>("hex");
    if (saved?.v === 1) this.sim.restore(saved, Date.now());
  }

  /** The loops run iff a PLAYER is connected — the one place that invariant
   * lives. A proctor is a spectator of a paused game (sim.tick clamps idle
   * dt): a snapshot on connect and on every player-driven broadcast is enough. */
  private syncLoops() {
    if (this.roster.hasPlayer()) this.wake();
    else this.sleep();
  }

  /** Start the loops. Idempotent; sim.tick clamps dt to 2s, so an idle
   * afternoon credits nothing on resume. */
  private wake() {
    this.ticker ??= setInterval(() => {
      this.broadcastState(); // ticks income up to the stamp — see below
    }, SNAPSHOT_TICK_MS);
    // Write-behind: income mutates the sim 4x/sec. 5s bounds an eviction's
    // loss, and the restore's offline credit covers most of that.
    this.persister ??= setInterval(() => void this.persist(), PERSIST_MS);
  }

  /** Stop the loops and save; pending intervals block hibernation. Proctors
   * may still be connected: spectators of a paused game, their connect
   * snapshot is current. */
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
    const meta = this.roster.register(conn, ctx);
    this.syncLoops();
    this.broadcastState();
    if (meta.role === "player") this.announce();
  }

  /** The lobby throwing an ad-hoc room away — this game's only non-socket door,
   * and the other half of `announce` below. Object-to-object: the fetch WAKES a
   * hibernating room, which is what a room being deleted usually is. */
  async onRequest(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith("/reset")) {
      this.resetRoom(Date.now());
      await this.persist();
      this.broadcastState();
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  /** One reset, two callers: the proctor's press and the lobby's delete. */
  private resetRoom(now: number) {
    this.sim.reset(now);
    this.roster.reset();
  }

  /** Tell the lobby an AD-HOC room has somebody in it (`sawRoom`). A `?r=`
   * room exists nowhere until it announces, and a Hex room the proctor cannot
   * see is one they cannot press 🏆 on. Goomba announces on its pack fetch;
   * Hex has none, so this is a bare fire-and-forget fetch. */
  private announce() {
    if (!isAdhocRoom(this.name)) return;
    void this.env.Lobby.get(this.env.Lobby.idFromName("main"))
      .fetch(`http://lobby/pack?room=${encodeURIComponent(this.name)}`)
      .catch(() => undefined);
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
    // A player message proves a player is here — the cheap case of
    // syncLoops(), for a hibernated room evicted with player sockets open.
    if (!proctor) this.wake();
    switch (msg.type) {
      case "join":
        this.roster.rename(sender, String(msg.name).slice(0, 24));
        break;
      case "pets": {
        this.petSeq.set(sender.id, Number(msg.seq) || 0);
        if (!proctor && me) {
          const slot = this.roster.slot(me.pid);
          // Offsets are ms before the batch was sent (spacing survives;
          // latency is uniform). xs/ys are the same taps' spots, in
          // thousandths. Index-aligned, each read defensively on its own.
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
        // No broadcast: four phones at 10Hz would be ~40 snapshots/sec, and
        // phones already show pets optimistically. The next tick carries it.
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
        // The PROCTOR's game action: they heard the code word. Write-through
        // like reset — rehydrating a pre-win save would un-win a team looking
        // at their splash.
        if (!proctor) return;
        this.sim.setWon(msg.won !== false, now);
        void this.persist();
        break;
      case "reset":
        if (!proctor) return;
        this.resetRoom(now);
        // Write-through, unlike player mutations: rehydrating the previous run
        // would undo the reset.
        void this.persist();
        break;
    }
    this.broadcastState();
  }

  private broadcastState() {
    // Acks BEFORE the snapshot: per-connection order is preserved, so a client
    // drops its in-flight taps before adding the authoritative bank.
    for (const conn of this.getConnections()) {
      const seq = this.petSeq.get(conn.id);
      if (seq !== undefined && this.petAcked.get(conn.id) !== seq) {
        const ack: HexServerMsg = { type: "petAck", seq };
        conn.send(JSON.stringify(ack));
        this.petAcked.set(conn.id, seq);
      }
    }
    // Tick income up to THIS instant before stamping: every non-ticker path
    // (purchase, join, proctor press) fires between ticks, and a bank up to
    // 250ms stale is a counter the phones walk BACKWARDS. Awake-only: a paused
    // game must not accrue on a proctor's press.
    const now = Date.now();
    if (this.ticker) this.sim.tick(now);
    const state = this.sim.snapshot(now, this.roster.list(), this.taps);
    this.taps = [];
    const msg: HexServerMsg = { type: "state", state };
    this.broadcast(JSON.stringify(msg));
  }
}
