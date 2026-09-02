// NUMBER FORMATTING — full numbers, comma-grouped, deliberately NOT Cookie
// Clicker's short scale: counting real mice is the joke ("1,103" reads as a
// hoard). One formatter feeds the bank, prices, rates and effect text.

import { nightActive } from "./state.js";

// A trailing ".0" means the fraction did not survive rounding — drop it.
// Decide from the ROUNDED value, never the raw one (the raw test turned every
// "+1" into "+1.0" the moment a single upgrade made clickGain 1.002).
export const dropDeadZeros = (s) => s.replace(/\.0+$/, "");

export function fmt(n, floats = 1) {
  const neg = n < 0;
  n = Math.abs(n);
  // Under 10, the fraction is the whole signal (clickGain 1.002, a 0.5/s
  // rate); at 10+ the integer part is the signal and the fraction is noise.
  const out =
    n < 10
      ? dropDeadZeros(n.toFixed(floats))
      : Math.floor(n).toLocaleString("en-US");
  const signed = neg && out !== "0" ? "-" + out : out;
  // Night's numbers all read as MILLIONS. Pure presentation: the dream is
  // simply a place where you'd believe you have 2,000M mice.
  return nightActive() ? signed + "M" : signed;
}
