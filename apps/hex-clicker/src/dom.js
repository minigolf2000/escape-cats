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
// are the LIDS (scaleY), the .look groups inside them are the LOOK (translate),
// and #pupilLeft/#pupilRight inside those are the DILATION (scale). See the eye
// block in index.html for why they can't be collapsed.
// .look is a list rather than a pair because each eye has two of them — the
// pupil's group, which sits inside the socket clip, and the sleeping lash arc's,
// which has to sit outside it. All four carry the same value.
// #earLeft/#earRight are back: the day coat is split into a head plus two ear
// layers, so the ears have their own channel again (a perk from the base — see
// the pivot note in index.html). #whiskers and #mouth are still gone, since the
// drawn head carries those as painted pixels with nothing to address.
export const earLeftEl = $("#earLeft");
export const earRightEl = $("#earRight");
export const lookEls = [...document.querySelectorAll("#hexCat .look")];
export const pupilLeftEl = $("#pupilLeft");
export const pupilRightEl = $("#pupilRight");
export const eyeLeftEl = $("#eyeLeft");
export const eyeRightEl = $("#eyeRight");

// The win splash (proctor-marked win) and its one control
export const splashEl = $("#splash");
export const splashArtEl = $("#splashArt");
export const wonPillEl = $("#wonPill");

// Multiplayer shell
export const gateEl = $("#gate");
export const gateStatusEl = $("#gateStatus");
export const gateErrEl = $("#gateErr");
export const teamEl = $("#team");
export const connToastEl = $("#connToast");
