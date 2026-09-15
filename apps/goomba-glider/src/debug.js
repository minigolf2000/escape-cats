// The one URL switch left.
//
//   ?debug  — open the levels grid without having earned it. The grid is
//             normally the reward for clearing the game (`levelSelect` in
//             state.js); this is the power user's way straight in, and `\`
//             is the same door from the keyboard.
//
// `?solo` is gone. It named "the shared sim in-page, no server" back when the
// other kind of game existed; that is every game now, so the flag had nothing
// left to distinguish. A level in the URL hash is read by `library.js`.

export function debugFromUrl() {
  return new URLSearchParams(location.search).has("debug");
}
