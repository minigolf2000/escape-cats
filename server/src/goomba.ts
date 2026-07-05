import type * as Party from "partykit/server";
import Matter from "matter-js";
import {
  LEVELS,
  WORLD,
  type BodyKind,
  type BodySnapshot,
  type GoombaClientMsg,
  type GoombaServerMsg,
  type GoombaState,
} from "@escape-cats/shared";
import { Roster } from "./connections";

const PHYSICS_MS = 1000 / 30;
const SNAPSHOT_EVERY = 2; // -> 15Hz to clients
const TARGET_IMPACT_SPEED = 5; // min relative speed to squash a target
const PROJECTILE_TTL_MS = 12_000;
const LEVEL_CLEAR_DELAY_MS = 2_000;
// Targets are invulnerable briefly after a level spawns so physics settling
// can never squash them before anyone has fired.
const SPAWN_GRACE_MS = 1_000;

interface BodyMeta {
  kind: BodyKind;
  shape: "box" | "circle";
  w: number;
  h: number;
  r: number;
  bornAt?: number;
}

export default class GoombaServer implements Party.Server {
  private roster = new Roster();
  private engine = Matter.Engine.create();
  private meta = new Map<number, BodyMeta>();
  private levelIndex = 0;
  private levelsCleared = 0;
  private advancing = false;
  private levelBuiltAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private frame = 0;

  constructor(readonly room: Party.Room) {}

  onStart() {
    this.buildLevel(0);
    Matter.Events.on(this.engine, "collisionStart", (ev) => {
      for (const pair of ev.pairs) this.onCollision(pair.bodyA, pair.bodyB);
    });
    this.ticker = setInterval(() => this.tick(), PHYSICS_MS);
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    this.roster.register(conn, ctx, this.proctorToken());
    this.broadcastState();
  }

  onClose(conn: Party.Connection) {
    this.roster.disconnect(conn);
    this.broadcastState();
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: GoombaClientMsg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    switch (msg.type) {
      case "join":
        this.roster.rename(sender, String(msg.name).slice(0, 24));
        this.broadcastState();
        break;
      case "launch": {
        const m = this.roster.get(sender);
        if (!m || m.role !== "player") return;
        this.launch(this.roster.slot(m.pid), msg.angle, msg.power);
        break;
      }
      case "reset":
        if (!this.roster.isProctor(sender)) return;
        this.levelsCleared = 0;
        this.roster.reset();
        this.buildLevel(0);
        this.broadcastState();
        break;
    }
  }

  private launch(slot: number, angle: number, power: number) {
    const p = Math.max(0.05, Math.min(1, power));
    const speed = p * WORLD.maxLaunchSpeed;
    const x = WORLD.slingshotX[Math.min(slot, WORLD.slingshotX.length - 1)];
    const body = Matter.Bodies.circle(x, WORLD.slingshotY, WORLD.projectileRadius, {
      restitution: 0.4,
      density: 0.004,
    });
    Matter.Body.setVelocity(body, {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    });
    this.addBody(body, {
      kind: "projectile",
      shape: "circle",
      w: 0,
      h: 0,
      r: WORLD.projectileRadius,
      bornAt: Date.now(),
    });
  }

  private onCollision(a: Matter.Body, b: Matter.Body) {
    if (Date.now() - this.levelBuiltAt < SPAWN_GRACE_MS) return;
    for (const [target, other] of [
      [a, b],
      [b, a],
    ] as const) {
      if (this.meta.get(target.id)?.kind !== "target") continue;
      const rel = Math.hypot(
        target.velocity.x - other.velocity.x,
        target.velocity.y - other.velocity.y,
      );
      if (rel >= TARGET_IMPACT_SPEED) this.removeBody(target);
    }
  }

  private tick() {
    Matter.Engine.update(this.engine, PHYSICS_MS);
    const now = Date.now();

    // Cull expired / out-of-world projectiles.
    for (const body of [...Matter.Composite.allBodies(this.engine.world)]) {
      const m = this.meta.get(body.id);
      if (!m) continue;
      const expired = m.kind === "projectile" && now - (m.bornAt ?? 0) > PROJECTILE_TTL_MS;
      const escaped = body.position.x < -200 || body.position.x > WORLD.width + 200 || body.position.y > WORLD.height + 200;
      if (expired || (m.kind !== "ground" && escaped)) this.removeBody(body);
    }

    // Level cleared?
    if (!this.advancing && this.targetsRemaining() === 0) {
      this.advancing = true;
      this.levelsCleared++;
      this.broadcastState();
      setTimeout(() => {
        if (this.levelsCleared < LEVELS.length) this.buildLevel(this.levelsCleared);
        this.advancing = false;
        this.broadcastState();
      }, LEVEL_CLEAR_DELAY_MS);
    }

    this.frame++;
    if (this.frame % SNAPSHOT_EVERY === 0) this.broadcastSnapshot(now);
  }

  private buildLevel(index: number) {
    Matter.Composite.clear(this.engine.world, false);
    this.meta.clear();
    this.levelIndex = index;
    this.levelBuiltAt = Date.now();

    const ground = Matter.Bodies.rectangle(
      WORLD.width / 2,
      WORLD.groundY + 20,
      WORLD.width * 2,
      40,
      { isStatic: true },
    );
    this.addBody(ground, { kind: "ground", shape: "box", w: WORLD.width * 2, h: 40, r: 0 });

    const level = LEVELS[index];
    for (const blk of level.blocks) {
      const body = Matter.Bodies.rectangle(blk.x, blk.y, blk.w, blk.h, { friction: 0.8 });
      this.addBody(body, { kind: "block", shape: "box", w: blk.w, h: blk.h, r: 0 });
    }
    for (const t of level.targets) {
      const body = Matter.Bodies.circle(t.x, t.y, t.r, { friction: 0.9 });
      this.addBody(body, { kind: "target", shape: "circle", w: 0, h: 0, r: t.r });
    }
  }

  private addBody(body: Matter.Body, meta: BodyMeta) {
    this.meta.set(body.id, meta);
    Matter.Composite.add(this.engine.world, body);
  }

  private removeBody(body: Matter.Body) {
    this.meta.delete(body.id);
    Matter.Composite.remove(this.engine.world, body);
  }

  private targetsRemaining(): number {
    let n = 0;
    for (const m of this.meta.values()) if (m.kind === "target") n++;
    return n;
  }

  private proctorToken(): string {
    return (this.room.env.PROCTOR_TOKEN as string) ?? "dev-proctor";
  }

  private broadcastState() {
    const done = this.levelsCleared >= LEVELS.length;
    const state: GoombaState = {
      levelIndex: this.levelIndex,
      totalLevels: LEVELS.length,
      levelsCleared: this.levelsCleared,
      targetsRemaining: this.targetsRemaining(),
      players: this.roster.list(),
      progress: this.levelsCleared / LEVELS.length,
      codeword: done ? ((this.room.env.GOOMBA_CODEWORD as string) ?? "POUNCE") : null,
    };
    const msg: GoombaServerMsg = { type: "state", state };
    this.room.broadcast(JSON.stringify(msg));
  }

  private broadcastSnapshot(t: number) {
    const bodies: BodySnapshot[] = [];
    for (const body of Matter.Composite.allBodies(this.engine.world)) {
      const m = this.meta.get(body.id);
      if (!m || m.kind === "ground") continue; // clients draw the ground themselves
      bodies.push({
        id: body.id,
        kind: m.kind,
        shape: m.shape,
        x: Math.round(body.position.x * 10) / 10,
        y: Math.round(body.position.y * 10) / 10,
        angle: Math.round(body.angle * 1000) / 1000,
        w: m.w,
        h: m.h,
        r: m.r,
      });
    }
    const msg: GoombaServerMsg = { type: "snapshot", t, bodies };
    this.room.broadcast(JSON.stringify(msg));
  }
}

GoombaServer satisfies Party.Worker;
