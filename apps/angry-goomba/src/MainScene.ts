import Phaser from "phaser";
import {
  WORLD,
  type BodySnapshot,
  type GoombaServerMsg,
  type GoombaState,
} from "@escape-cats/shared";
import { connectGoomba, roomFromUrl } from "./net";

const LERP = 0.35; // smooth 15Hz server snapshots up to render framerate

interface Tracked {
  obj: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;
  targetX: number;
  targetY: number;
  targetAngle: number;
}

export class MainScene extends Phaser.Scene {
  private socket!: ReturnType<typeof connectGoomba>;
  private tracked = new Map<number, Tracked>();
  private hud!: Phaser.GameObjects.Text;
  private codewordText!: Phaser.GameObjects.Text;
  private aimLine!: Phaser.GameObjects.Graphics;
  private dragStart: { x: number; y: number } | null = null;

  constructor() {
    super("main");
  }

  create() {
    const room = roomFromUrl();

    // Ground and slingshot posts are static — drawn locally, never synced.
    this.add
      .rectangle(WORLD.width / 2, WORLD.groundY + 20, WORLD.width, 80, 0x4a7a3a)
      .setOrigin(0.5, 0.5);
    for (const x of WORLD.slingshotX) {
      this.add.text(x, WORLD.slingshotY, "🪃", { fontSize: "36px" }).setOrigin(0.5, 0.5);
    }

    this.aimLine = this.add.graphics();
    this.hud = this.add.text(16, 12, "", {
      fontSize: "24px",
      color: "#123",
      fontStyle: "bold",
    });
    this.codewordText = this.add
      .text(WORLD.width / 2, WORLD.height / 2, "", {
        fontSize: "72px",
        color: "#b5301e",
        fontStyle: "bold",
        backgroundColor: "#ffffffcc",
        padding: { x: 32, y: 20 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    if (!room) {
      this.hud.setText("Scan the room QR code to join your team.");
      return;
    }

    this.socket = connectGoomba(room);
    this.socket.addEventListener("open", () => {
      this.socket.send(JSON.stringify({ type: "join", name: localStorage.getItem("escape-cats-name") ?? "Cat" }));
    });
    this.socket.addEventListener("message", (e) => {
      const msg: GoombaServerMsg = JSON.parse(e.data);
      if (msg.type === "state") this.onState(msg.state);
      if (msg.type === "snapshot") this.onSnapshot(msg.bodies);
    });

    // Drag-back slingshot: pull anywhere, release to fire.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.dragStart = { x: p.worldX, y: p.worldY };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.dragStart) return;
      this.aimLine.clear();
      this.aimLine.lineStyle(4, 0xb5301e, 0.8);
      this.aimLine.lineBetween(this.dragStart.x, this.dragStart.y, p.worldX, p.worldY);
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (!this.dragStart) return;
      const dx = this.dragStart.x - p.worldX;
      const dy = this.dragStart.y - p.worldY;
      const dist = Math.hypot(dx, dy);
      this.aimLine.clear();
      this.dragStart = null;
      if (dist < 20) return; // ignore taps
      const angle = Math.atan2(dy, dx);
      const power = Math.min(1, dist / 250);
      this.socket.send(JSON.stringify({ type: "launch", angle, power }));
    });
  }

  private onState(state: GoombaState) {
    const players = state.players.map((p) => p.name).join(", ");
    this.hud.setText(
      `Level ${Math.min(state.levelsCleared + 1, state.totalLevels)}/${state.totalLevels}` +
        `  🍄×${state.targetsRemaining}  |  ${players}`,
    );
    if (state.codeword) {
      this.codewordText.setText(`Code word: ${state.codeword}`).setVisible(true);
    } else {
      this.codewordText.setVisible(false);
    }
  }

  private onSnapshot(bodies: BodySnapshot[]) {
    const seen = new Set<number>();
    for (const b of bodies) {
      seen.add(b.id);
      let t = this.tracked.get(b.id);
      if (!t) {
        t = { obj: this.spawn(b), targetX: b.x, targetY: b.y, targetAngle: b.angle };
        this.tracked.set(b.id, t);
      }
      t.targetX = b.x;
      t.targetY = b.y;
      t.targetAngle = b.angle;
    }
    for (const [id, t] of this.tracked) {
      if (!seen.has(id)) {
        t.obj.destroy();
        this.tracked.delete(id);
      }
    }
  }

  private spawn(b: BodySnapshot): Tracked["obj"] {
    switch (b.kind) {
      case "block":
        return this.add.rectangle(b.x, b.y, b.w, b.h, 0x9a6b3f).setStrokeStyle(2, 0x5f3f22);
      case "target":
        return this.add
          .text(b.x, b.y, "🍄", { fontSize: `${b.r * 2}px` })
          .setOrigin(0.5, 0.5);
      case "projectile":
      default:
        return this.add
          .text(b.x, b.y, "😾", { fontSize: `${b.r * 2}px` })
          .setOrigin(0.5, 0.5);
    }
  }

  update() {
    for (const t of this.tracked.values()) {
      t.obj.x += (t.targetX - t.obj.x) * LERP;
      t.obj.y += (t.targetY - t.obj.y) * LERP;
      t.obj.rotation += (t.targetAngle - t.obj.rotation) * LERP;
    }
  }
}
