// Every element reference, in one place. The markup lives in index.html
// (ported verbatim from the prototype); modules import what they touch.

export const $ = (s) => document.querySelector(s);

// HUD + stage
export const countEl = $("#count");
export const countIconEl = $("#countIcon");
export const cpsEl = $("#cps");
export const stageEl = $("#stage");
export const goldenEl = $("#golden");
export const buffEl = $("#buff");
export const hudEl = $("#hud");
export const starsEl = $("#stars");
export const cutsceneVeilEl = $("#cutsceneVeil");
export const wallCv = $("#wall");

// Shop / dock
export const shopEl = $("#shop");
export const upgradesEl = $("#upgrades");
export const upgradeSecEl = $("#upgradeSec");
export const shopScrollEl = $("#shopScroll");
export const newBadgeEl = $("#newBadge");
export const buildingSecEl = $("#buildingSec");
export const dockEl = $("#dock");
export const shopToggleEl = $("#shopToggle");

// The cat
export const catEl = $("#catWrap");
export const hexCatEl = $("#hexCat");
export const catMotionEl = $("#catMotion");
export const catFaceEl = $("#catFace");
// #eyeLeft/#eyeRight are the LIDS, #irisLeft/#irisRight inside them are the
// LOOK — see the eye block in index.html for why the pair is split that way.
// The old #earLeft/#earRight/#whiskers/#mouth refs are gone with the vector cat:
// the drawn head carries ears, whiskers and muzzle as painted pixels, so there
// is nothing left to address individually. cat.js re-expresses what those used
// to say through the channels the drawing does have.
export const irisLeftEl = $("#irisLeft");
export const irisRightEl = $("#irisRight");
export const eyeLeftEl = $("#eyeLeft");
export const eyeRightEl = $("#eyeRight");

// Multiplayer shell
export const gateEl = $("#gate");
export const gateStatusEl = $("#gateStatus");
export const gateErrEl = $("#gateErr");
export const teamEl = $("#team");
export const connToastEl = $("#connToast");
