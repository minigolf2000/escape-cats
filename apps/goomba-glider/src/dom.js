// Every element reference, in one place. The markup lives in index.html;
// modules import what they touch. (hex-clicker/src/dom.js is the same idea.)

const $ = (id) => document.getElementById(id);

export const cv = $("c");
export const hudEl = $("hud");
export const hintEl = $("hint");
export const dotsEl = $("dots");
export const invEl = $("inv");
export const playBtn = $("play");
export const clearBtn = $("clear");
export const toastEl = $("toast");
export const labEl = $("lab");
export const connEl = $("conn");

// The how-to-play sheet, which is also the join gate.
export const gateEl = $("gate");
export const gateStatusEl = $("gateStatus");
export const gateErrEl = $("gateErr");
export const gateCloseEl = $("gateClose");
export const helpEl = $("help");
export const scGoalEl = $("scGoal");
export const scTitleEl = $("scTitle");
export const scDragEl = $("scDrag");
export const scLiftEl = $("scLift");
export const titleH1El = document.querySelector("#gate h1");
