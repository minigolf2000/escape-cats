import type * as Party from "partykit/server";
import {
  HEX_BALANCE,
  upgradeCost,
  hashString,
  type HexClientMsg,
  type HexServerMsg,
  type HexState,
} from "@escape-cats/shared";
import { Roster } from "./connections";

const TICK_MS = 500;

export default class HexServer implements Party.Server {
  private roster = new Roster();
  private points = 0;
  private totalClicks = 0;
  private upgrades: Record<string, number> = {};
  private unlocked = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;

  constructor(readonly room: Party.Room) {}

  onStart() {
    this.lastTick = Date.now();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
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
    switch (msg.type) {
      case "join":
        this.roster.rename(sender, String(msg.name).slice(0, 24));
        break;
      case "clicks": {
        if (this.roster.isProctor(sender)) return;
        const n = Math.max(0, Math.min(50, Math.floor(msg.count)));
        this.totalClicks += n;
        this.points += n * HEX_BALANCE.clickPower;
        break;
      }
      case "buy": {
        if (this.roster.isProctor(sender)) return;
        const def = HEX_BALANCE.upgrades.find((u) => u.id === msg.upgradeId);
        if (!def) return;
        const owned = this.upgrades[def.id] ?? 0;
        const cost = upgradeCost(def, owned);
        if (this.points < cost) return;
        this.points -= cost;
        this.upgrades[def.id] = owned + 1;
        break;
      }
      case "reset":
        if (!this.roster.isProctor(sender)) return;
        this.points = 0;
        this.totalClicks = 0;
        this.upgrades = {};
        this.unlocked = false;
        this.roster.reset();
        break;
    }
    this.checkUnlock();
    this.broadcast();
  }

  private tick() {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.points += this.pointsPerSecond() * dt;
    this.checkUnlock();
    this.broadcast();
  }

  private pointsPerSecond(): number {
    return HEX_BALANCE.upgrades.reduce(
      (sum, u) => sum + u.cps * (this.upgrades[u.id] ?? 0),
      0,
    );
  }

  private toyCount(): number {
    return HEX_BALANCE.upgrades.reduce(
      (sum, u) => sum + (u.addsToy ? this.upgrades[u.id] ?? 0 : 0),
      0,
    );
  }

  private checkUnlock() {
    if (this.points >= HEX_BALANCE.unlockPoints) this.unlocked = true;
  }

  private proctorToken(): string {
    return (this.room.env.PROCTOR_TOKEN as string) ?? "dev-proctor";
  }

  private broadcast() {
    const state: HexState = {
      points: Math.floor(this.points),
      pointsPerSecond: this.pointsPerSecond(),
      clickPower: HEX_BALANCE.clickPower,
      totalClicks: this.totalClicks,
      upgrades: this.upgrades,
      toyCount: this.toyCount(),
      players: this.roster.list(),
      progress: Math.min(1, this.points / HEX_BALANCE.unlockPoints),
      codeword: this.unlocked
        ? ((this.room.env.HEX_CODEWORD as string) ?? "WHISKERS")
        : null,
      seed: hashString(this.room.id),
      serverTime: Date.now(),
    };
    const msg: HexServerMsg = { type: "state", state };
    this.room.broadcast(JSON.stringify(msg));
  }
}

HexServer satisfies Party.Worker;
