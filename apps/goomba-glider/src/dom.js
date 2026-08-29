// Every element reference, in one place. The markup lives in index.html;
// modules import what they touch. (hex-clicker/src/dom.js is the same idea.)

const $ = (id) => document.getElementById(id);

export const cv = $("c");
export const hudEl = $("hud");
export const hintEl = $("hint");
// The roster: who is in this room, one name per line. See #team in styles.css.
export const teamEl = $("team");
export const dotsEl = $("dots");
export const invEl = $("inv");
export const playBtn = $("play");
// The band strip IS the button that empties it — see `#bandbar` in styles.css.
// `#inv` above is the row of slots inside it.
export const bandbarEl = $("bandbar");
export const toastEl = $("toast");
export const labEl = $("lab");
// The top bar itself, measured (never copied) for where the bunting hangs from.
export const topEl = $("top");
export const connEl = $("conn");

// The how-to-play sheet, which is also the join gate.
export const gateEl = $("gate");
export const gateStatusEl = $("gateStatus");
export const gateErrEl = $("gateErr");
export const helpEl = $("help");
export const scGoalEl = $("scGoal");
export const scTitleEl = $("scTitle");
export const scDragEl = $("scDrag");
export const scLiftEl = $("scLift");
export const titleH1El = document.querySelector("#gate h1");
