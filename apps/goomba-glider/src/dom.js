// Every element reference, in one place. The markup lives in index.html.

const $ = (id) => document.getElementById(id);

export const cv = $("c");
export const hudEl = $("hud");
export const hintEl = $("hint");
export const dotsEl = $("dots");
export const invEl = $("inv");
export const playBtn = $("play");
// The band strip IS the button that empties it — see `#bandbar` in styles.css.
// `#inv` above is the row of slots inside it.
export const bandbarEl = $("bandbar");
export const toastEl = $("toast");
export const labEl = $("lab");
// The level editor's export, top-right of the grid (#labtools in styles.css).
export const exportBtn = $("export");
// The top bar itself, measured (never copied) for where the bunting hangs from.
export const topEl = $("top");

// The how-to-play sheet. It used to be the join gate as well, and held the
// connection lines; with nothing to join it is only the sheet.
export const gateEl = $("gate");
export const helpEl = $("help");
export const scGoalEl = $("scGoal");
export const scTitleEl = $("scTitle");
export const scDragEl = $("scDrag");
export const scLiftEl = $("scLift");
export const titleH1El = document.querySelector("#gate h1");
