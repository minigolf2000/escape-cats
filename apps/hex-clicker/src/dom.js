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
export const earLeftEl = $("#earLeft");
export const earRightEl = $("#earRight");
export const irisLeftEl = $("#irisLeft");
export const irisRightEl = $("#irisRight");
export const eyeLeftEl = $("#eyeLeft");
export const eyeRightEl = $("#eyeRight");
export const whiskersEl = $("#whiskers");
export const mouthEl = $("#mouth");

// Multiplayer shell
export const gateEl = $("#gate");
export const gateRoomEl = $("#gateRoom");
export const gateNameEl = $("#gateName");
export const gateErrEl = $("#gateErr");
export const roomInputEl = $("#roomInput");
export const nameInputEl = $("#nameInput");
export const joinBtnEl = $("#joinBtn");
export const soloBtnEl = $("#soloBtn");
export const teamEl = $("#team");
export const connToastEl = $("#connToast");
