// GENERATED, with ONE exception (TAIL_HI/TAIL_LO — see below). Source: Figma
// "Hexxxygon" file, page Hex_v2 (node 52:2), the "Green 2 1" mouse strip on the
// shared-across-modes section; the FIRST of its four mice, traced. Regenerate by
// re-tracing that strip — and re-place the tail after, since nothing on the
// sheet carries it. See art.js for how these are consumed.
//
// The hand-drawn mouse traced to polygons rather than re-drawn as beziers, so
// the wobble in the artist's line survives verbatim. Layers, drawn in order:
// SIL is the full silhouette (painted in the keyline colour), BODY is the
// coloured fill on top of it, and what is left of SIL showing around BODY *is*
// the keyline. That inversion is why the body stays recolourable — nothing here
// names a mouse colour, so the palette stays art.js's to choose.
//
// EAR and NOSE are the two accent marks, and unlike the body they are NOT
// recoloured: the artist draws the same hot pink on all four of her mice
// whatever the body is, so their colour lives in art.js as one constant.
//
// TAIL is the ONE mark here that is not off the v2 sheet: it is v1's squiggle,
// lifted out of that trace as its own ring and set on this rump (scale 1.0,
// rotated 18 degrees so it leaves the flank along the v2 drawing's own slope).
// It is seated DEEP: the ring's two lips and the straight edge that closes them
// all sit under the coat, the nearest by 0.4 units and the closing edge by 2.5.
// Seated shallower — lips a fraction OUTSIDE the silhouette, which is where the
// artist's own run left them once rotated — the arm skims alongside the belly
// instead of joining it, and that closing edge cuts back across as a thin wedge:
// a jagged little notch under the rump. There is nothing to see in what the seat
// buries, since the tail wears the keyline colour and the coat is the same
// paint; the depth costs nothing and it is the whole fix.
// The artist's v2 mice have no tail — this is the game's addition, so a re-trace
// of the sheet will not bring it back and must not drop it either. It carries NO
// body fill because v1's did not: the v1 body ring stopped at the rump and the
// curl was keyline all the way through, which is what keeps it readable when it
// thins. It is drawn as its OWN path, never merged into SIL: the two overlap at
// the rump, and one even-odd path would punch that overlap into a hole.
//
// Coordinates are a 54.0 x 28.94 box, nose facing +x, matching the artwork's
// own aspect. The WIDTH is deliberately v1's 54.0 — every downstream size
// (NIGHT_POP_SCALE, WALL_MOUSE_R, the coin's box) is set against it.
//
// MOUSE_BOX is the BODY's box and does not move when the tail is added: the tail
// hangs off the rump at NEGATIVE x, so every existing coordinate here — the eye,
// the golden mouse's shine, the wall's pivot — stays valid, and only renderers
// that draw the whole animal switch to MOUSE_VIEWBOX. That is why the tail was
// placed rather than the drawing re-registered.
// Each entry is one closed ring as a flat [x0,y0,x1,y1,...] run; rings within a
// layer are filled even-odd, so inner rings cut holes.
//
// HI is for SVG (the click-pop, the golden mouse, the price coin). LO is the
// same shape simplified for the night wall, which draws dozens of mice per
// frame at ~7.6px across — at that size the extra points cost fill rate and buy
// nothing you can see. The wall draws SIL/TAIL/BODY/eye only: at 7.6px the ear
// and nose are a third of a pixel each, but the tail is the silhouette's own
// outline and reads as the swarm's direction even when it is one pixel wide.

export const MOUSE_BOX = { w: 54, h: 28.94 };
// The whole animal, tail included: MOUSE_BOX grown to the left by the tail's
// reach. Anything drawing the mouse WHOLE (the click-pop, the golden mouse)
// takes this; anything sized against the body (the wall's pivot, the coin) takes
// MOUSE_BOX. The tail stays inside the body's height, so only x moved.
export const MOUSE_VIEWBOX = "-8.11 0 62.11 28.94";
export const MOUSE_EYE = { cx: 37.43, cy: 17.38, r: 2.77 };

// The coin's box: cropped to the HEAD, which is v1's answer to the same problem
// and is back for v1's reason — the mouse has a tail again, and at 16px a tail is
// spiral nobody can resolve spending a fifth of the body to be there. Re-fitted
// to THIS drawing rather than reused: v1's numbers frame v1's head, and the ear
// this one wears would sit half outside them. x starts at 24, a whisker left of
// the ear (23.77), and the box runs to the nose; the height is the silhouette's
// own over that span. Nothing else may be assumed square: it is 1.11:1, and the
// coin is sized on HEIGHT (1em) in CSS, which is what keeps an icon from ever
// setting the width of a shop row.
export const MOUSE_COIN_VIEWBOX = "24 2 30 27";

export const SIL_HI = [[12.4,0,15.5,0,15.76,0.26,18.09,0.26,18.34,0.52,19.38,0.52,19.64,0.78,20.41,0.78,20.93,1.29,21.7,1.29,22.22,1.81,22.74,1.81,23.51,2.33,24.03,2.33,24.29,2.58,25.32,2.58,25.58,2.84,25.84,2.58,26.1,2.84,27.13,2.84,27.39,3.1,27.65,3.1,28.42,3.62,28.94,3.62,29.2,3.88,29.97,3.88,30.23,4.13,31.52,4.13,31.78,4.39,32.3,4.39,32.56,4.65,33.07,4.65,33.33,4.91,33.59,4.91,33.85,5.17,34.11,5.17,34.62,5.68,34.88,5.68,35.14,5.94,35.4,5.94,36.17,6.46,37.21,6.46,37.46,6.72,38.24,6.72,38.5,6.98,38.76,6.98,39.27,7.49,39.53,7.49,39.79,7.75,40.05,7.75,40.31,8.01,40.56,8.01,41.08,8.53,41.34,8.53,41.6,8.78,41.86,8.78,42.37,9.3,42.63,9.3,42.89,9.56,43.41,9.56,43.67,9.82,43.92,9.82,44.18,10.08,44.44,10.08,44.96,10.59,45.22,10.59,45.47,10.85,45.99,10.85,46.25,11.11,46.51,11.11,47.28,11.63,47.54,11.63,48.32,12.4,48.57,12.4,49.35,12.92,49.61,12.92,50.64,13.95,51.42,13.95,51.67,14.21,51.93,13.95,52.19,14.21,52.19,14.99,51.67,15.5,52.19,16.02,52.19,16.54,52.97,17.31,52.97,17.57,53.48,18.34,53.48,20.15,53.74,20.41,53.74,20.93,53.48,21.19,53.48,21.7,52.97,22.22,52.97,22.48,52.71,22.74,52.71,23,51.93,23.77,51.93,24.03,50.9,25.06,50.64,25.06,50.12,25.58,49.87,25.58,49.09,26.1,48.83,25.84,48.06,25.84,47.8,25.58,47.54,25.58,47.28,25.84,45.73,25.84,44.96,26.35,44.7,26.1,42.89,26.1,42.63,26.35,41.6,26.35,41.34,26.61,38.24,26.61,37.98,26.87,37.21,26.87,36.95,27.13,35.91,27.13,35.66,27.39,35.4,27.39,34.62,27.9,33.59,27.9,33.33,27.65,32.56,27.65,32.3,27.9,31.26,27.9,31,28.16,29.97,28.16,29.71,28.42,24.8,28.42,24.55,28.68,24.29,28.68,24.03,28.42,23.77,28.68,18.86,28.68,18.6,28.42,18.34,28.68,13.69,28.68,13.44,28.42,12.92,28.42,12.66,28.68,12.4,28.68,12.14,28.42,11.37,28.42,11.11,28.16,10.08,28.16,9.82,27.9,9.56,27.9,9.3,27.65,8.78,27.65,8.53,27.39,7.75,27.39,7.23,26.87,6.98,26.87,6.46,26.35,6.2,26.35,5.94,26.1,5.43,26.1,5.17,25.84,4.91,25.84,3.62,24.55,3.36,24.55,2.58,23.77,2.58,23.51,1.81,22.74,1.55,22.74,1.29,22.48,1.29,22.22,0.78,21.44,0.78,20.67,0.52,20.41,0.52,19.89,0.26,19.64,0.26,18.86,0,18.6,0,14.21,0.26,13.95,0.26,12.92,0.78,12.14,0.78,11.63,1.03,11.37,1.03,10.85,1.55,10.08,1.55,9.56,2.07,9.04,2.07,8.78,2.33,8.53,2.33,8.01,2.58,7.75,2.58,7.49,3.1,6.98,3.1,6.46,3.36,6.2,3.36,5.94,4.13,5.17,4.39,5.17,5.17,4.39,5.43,4.39,6.72,3.1,6.98,3.1,8.27,1.81,8.53,1.81,8.78,1.55,9.04,1.55,9.82,1.03,10.08,1.03,10.59,0.52,11.11,0.52,11.37,0.26,12.14,0.26]];
export const BODY_HI = [[13.95,2.58,16.54,2.58,16.79,2.84,17.57,2.84,17.83,3.1,18.86,3.1,19.38,3.62,19.89,3.62,20.15,3.88,20.41,3.88,20.67,4.13,21.19,4.13,21.96,4.65,22.48,4.65,22.74,4.91,23.51,4.91,23.77,5.17,24.55,5.17,24.8,5.43,25.32,5.43,25.58,5.68,26.1,5.68,26.35,5.94,26.87,5.94,27.13,6.2,28.16,6.2,28.42,6.46,28.94,6.46,29.71,6.98,31,6.98,31.26,7.23,31.78,7.23,32.3,7.75,32.81,7.75,33.33,8.27,33.59,8.27,33.85,8.53,34.36,8.53,34.62,8.78,35.14,8.78,35.4,9.04,35.91,9.04,36.17,9.3,36.95,9.3,37.21,9.56,37.98,9.56,38.24,9.82,38.5,9.82,39.53,10.85,39.79,10.85,40.31,11.37,40.56,11.37,41.34,11.89,42.11,11.89,42.63,12.4,42.89,12.4,43.67,12.92,44.18,12.92,44.7,13.44,44.96,13.44,45.73,13.95,45.99,13.95,46.51,14.47,47.02,14.47,49.09,16.54,49.09,16.79,49.35,17.05,49.35,17.57,50.38,18.6,50.9,18.6,51.42,19.12,51.42,19.64,51.67,19.89,51.67,20.15,51.16,20.93,51.16,21.7,50.64,22.22,50.64,22.48,49.87,23.25,49.35,23.25,49.09,23.51,48.57,23.51,48.32,23.77,47.8,23.77,47.54,23.51,47.28,23.51,47.28,23.25,46.77,22.74,46.51,22.74,46.25,23,45.73,23,45.47,23.25,44.44,23.25,44.18,23.51,41.08,23.51,40.82,23.77,39.79,23.77,39.53,24.03,36.43,24.03,36.17,24.29,35.66,24.29,35.14,24.8,34.88,24.8,34.62,25.06,33.59,25.06,33.33,25.32,31.78,25.32,31.52,25.06,31,25.06,30.75,25.32,29.71,25.32,29.45,25.58,26.35,25.58,26.1,25.84,25.84,25.58,25.06,25.58,24.8,25.84,21.7,25.84,21.44,26.1,19.89,26.1,19.64,25.84,18.86,25.84,18.6,26.1,18.09,26.1,17.83,25.84,16.02,25.84,15.76,26.1,15.5,26.1,15.24,25.84,13.69,25.84,13.44,26.1,12.92,26.1,12.66,25.84,11.89,25.84,11.63,25.58,11.11,25.58,10.85,25.32,10.33,25.32,10.08,25.06,9.3,25.06,9.04,24.8,8.78,24.8,8.53,24.55,8.27,24.55,7.49,24.03,7.23,24.03,6.46,23.25,6.2,23.25,5.94,23,5.43,23,3.88,21.96,3.88,21.44,3.62,21.19,3.62,20.67,3.36,20.41,3.36,20.15,2.84,19.38,2.84,18.09,2.58,17.83,2.58,15.24,2.84,14.99,2.84,14.47,3.1,14.21,3.1,13.18,3.36,12.92,3.36,12.4,3.88,11.63,3.88,10.59,4.13,10.33,4.13,10.08,4.39,9.82,4.39,9.56,4.91,9.04,4.91,8.53,5.94,7.49,5.94,7.23,6.46,6.72,6.72,6.72,6.98,6.46,7.23,6.46,8.01,5.68,8.27,5.68,9.04,4.91,9.3,4.91,10.59,3.62,10.85,3.62,11.63,3.1,12.4,3.1,12.66,2.84,13.69,2.84]];
export const EAR_HI = [[28.68,9.04,29.2,9.04,29.45,9.3,31.26,9.3,32.3,10.33,32.56,10.33,32.56,10.59,33.07,11.11,33.07,11.37,32.81,11.63,33.07,11.89,33.07,14.73,32.81,14.99,32.81,15.5,32.56,15.76,32.56,16.02,31.78,16.79,31.52,16.79,31.26,17.05,30.49,17.05,30.23,17.31,27.39,17.31,27.13,17.05,26.35,17.05,26.1,16.79,25.84,16.79,25.06,16.28,24.8,16.28,24.55,16.02,24.55,15.76,24.03,14.99,24.03,14.21,23.77,13.95,23.77,13.69,24.03,13.44,24.03,12.92,24.29,12.66,24.29,12.4,24.55,12.14,24.55,11.89,25.06,11.37,25.06,11.11,25.58,10.33,25.58,10.08,25.84,9.82,26.1,9.82,26.35,9.56,26.87,9.56,27.13,9.3,28.42,9.3]];
export const NOSE_HI = [[50.12,18.34,50.38,18.6,50.9,18.6,51.42,19.12,51.42,19.64,51.67,19.89,51.67,20.15,51.16,20.93,51.16,21.7,50.64,22.22,50.64,22.48,49.87,23.25,49.35,23.25,49.09,23.51,48.57,23.51,48.32,23.77,47.8,23.77,47.54,23.51,47.28,23.51,47.28,23.25,47.02,23,47.02,21.96,47.54,21.19,47.54,20.67,47.8,20.41,47.8,20.15,48.57,19.38,48.57,19.12,48.83,19.12,49.35,18.6,49.87,18.6]];
export const TAIL_HI = [[8.2,24.5,7.09,23.94,6.88,24,5.92,23.52,5.86,23.31,5.3,23.02,4.82,22.25,4.4,22.04,3,23.42,1.96,23.76,1.68,23.62,0.92,24.1,0.64,23.96,-0.19,24.23,-1.51,23.73,-2.49,23.59,-2.97,23.17,-4,22.81,-4.76,21.91,-5.31,21.62,-5.51,21,-5.79,20.86,-5.79,20.16,-6.41,19.67,-6.61,19.04,-7.3,18.35,-7.44,17.93,-7.29,17.65,-7.43,17.23,-7.71,17.09,-7.57,16.82,-7.84,15.98,-7.7,15.7,-8.11,15.14,-7.89,13.69,-8.09,13.06,-7.38,10.29,-6.89,9.32,-6.68,9.25,-6.39,8.71,-5.98,8.57,-5.83,8.29,-4.79,7.95,-4.65,7.68,-3.27,7.69,-2.71,7.96,-2.51,7.9,-0.91,8.88,-0.57,9.23,-0.36,9.86,0.33,10.56,0.8,12.02,0.66,12.29,0.78,14.1,0.43,14.8,-0.34,15.28,-0.48,15.55,-1.52,15.89,-1.79,15.75,-1.93,16.03,-2.42,15.95,-4.01,14.97,-4.35,13.92,-4.07,13.71,-3.86,12.96,-3.02,12.69,-2.26,12.89,-1.99,12.69,-2.46,11.24,-3.14,10.88,-4.12,10.73,-5.18,12.81,-5.47,14.05,-5.26,14.68,-5.4,14.96,-5.2,15.58,-4.92,15.73,-5.06,16,-4.79,16.14,-4.18,18.02,-3.9,18.16,-3.63,19,-3.01,19.49,-2.87,19.91,-1.28,20.89,-0.03,21.18,0.59,20.98,0.86,21.11,1.01,20.84,1.85,20.57,3.25,18.84,2.92,16.41,3.49,13.92]];
export const TAIL_LO = [[6.88,24,4.4,22.04,0.92,24.1,-2.49,23.59,-5.31,21.62,-7.71,17.09,-8.09,13.06,-6.89,9.32,-4.65,7.68,-3.27,7.69,-0.91,8.88,0.33,10.56,0.78,14.1,-0.48,15.55,-2.42,15.95,-4.01,14.97,-3.86,12.96,-1.99,12.69,-3.14,10.88,-4.12,10.73,-5.47,14.05,-2.87,19.91,0.86,21.11,3.25,18.84,3.49,13.92]];
export const SIL_LO = [[12.4,0,20.41,0.78,23.51,2.33,31.52,4.13,36.17,6.46,38.76,6.98,42.37,9.3,47.54,11.63,50.64,13.95,51.93,13.95,52.19,14.99,51.67,15.5,53.48,18.34,53.48,21.7,51.93,24.03,49.09,26.1,47.54,25.58,44.96,26.35,38.24,26.61,34.62,27.9,32.56,27.65,29.71,28.42,24.55,28.68,12.4,28.68,7.75,27.39,4.91,25.84,1.29,22.48,0,18.6,0,14.21,3.36,5.94,8.27,1.81]];
export const BODY_LO = [[13.95,2.58,18.86,3.1,21.96,4.65,31,6.98,33.85,8.53,38.5,9.82,40.31,11.37,47.02,14.47,49.09,16.54,49.35,17.57,51.42,19.12,51.67,20.15,51.16,21.7,49.87,23.25,48.32,23.77,46.51,22.74,44.18,23.51,36.43,24.03,33.33,25.32,31,25.06,21.44,26.1,12.92,26.1,7.23,24.03,3.88,21.96,2.84,19.38,2.58,15.24,3.88,10.59,6.46,6.72,10.59,3.62]];
