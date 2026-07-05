import Phaser from "phaser";
import { WORLD } from "@escape-cats/shared";
import { MainScene } from "./MainScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#87ceeb",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WORLD.width,
    height: WORLD.height,
  },
  scene: [MainScene],
});
