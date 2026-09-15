// Every element reference, in one place; modules import what they touch.

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
// The unseen-upgrade count, one chip per scroller edge — see the .moreHint
// block in index.html for why it lives here and not on the shop tab.
export const moreUpEl = $("#shopScroll .moreHint.up");
export const moreDownEl = $("#shopScroll .moreHint.down");
export const buildingSecEl = $("#buildingSec");
export const dockEl = $("#dock");
export const shopToggleEl = $("#shopToggle");

// The cat
export const catEl = $("#catWrap");
export const hexCatEl = $("#hexCat");
export const catMotionEl = $("#catMotion");
export const catFaceEl = $("#catFace");
// The eye is three nested transform channels, one job each: #eyeLeft/#eyeRight
// are the LIDS (scaleY), the .look groups inside are the LOOK (translate), and
// #pupilLeft/#pupilRight inside those are the DILATION (scale) — see the eye
// block in index.html. .look is a list because each eye has two: the pupil's
// group inside the socket clip and the sleeping lash arc's outside it.
// #earLeft/#earRight are real layers (a perk from the base — see index.html);
// whiskers and mouth are painted pixels with nothing to address.
export const earLeftEl = $("#earLeft");
export const earRightEl = $("#earRight");
export const lookEls = [...document.querySelectorAll("#hexCat .look")];
export const pupilLeftEl = $("#pupilLeft");
export const pupilRightEl = $("#pupilRight");
export const eyeLeftEl = $("#eyeLeft");
export const eyeRightEl = $("#eyeRight");

// The win splash and its one control
export const splashEl = $("#splash");
export const splashArtEl = $("#splashArt");
export const splashWordTextEl = $("#splashWordText");
export const wonPillEl = $("#wonPill");

// The cover over the stage until the first snapshot
export const gateEl = $("#gate");
