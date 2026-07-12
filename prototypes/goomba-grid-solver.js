'use strict';
// Goomba Grid — deterministic sim + brute-force solver for level design.
//   node prototypes/goomba-grid-solver.js
//
// This is the level-design harness for goomba-grid.html: levels are ASCII
// text, and this script proves each one (a) fails with 0 arrows, (b) is
// winnable within its arrow budget, and reports par (fewest arrows any
// winning placement needs) plus the best treat count. Keep the rules and
// LEVELS below in sync with goomba-grid.html.
//
// Movement rule (the whole premise): each tick Goomba tries, in order:
//   forward, right, left, back — first unblocked direction wins.
// Arrows (player-placed) set his facing when he arrives on them.
// Tiles: # wall · . floor · >v<^ start+facing · B bowl (win) · t treat ·
//   c cucumber (lose — smashed instead while zooming) · n catnip (6 ticks of
//   zoomies) · x paper wall (blocks; shredded while zooming) · 1/2 box
//   teleport pairs · ~ water (blocks).

const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // N E S W
const DCH = { '^': 0, '>': 1, 'v': 2, '<': 3 };
const ZOOM_TICKS = 6;

const LEVELS = [
  {
    name: 'Breakfast', arrows: 1,
    grid: `
#########
#>......#
#.......#
#..###..#
#..#B#..#
#..#.#..#
#..#.#..#
#.......#
#...t...#
#.......#
#########`,
  },
  {
    name: 'Treat Sweep', arrows: 2,
    grid: `
#########
#>....t.#
#.#####.#
#.....#.#
#.###.#.#
#.#B..#.#
#.#####.#
#......t#
#########`,
  },
  {
    name: 'Cucumber Alley', arrows: 2,
    grid: `
#########
#>...c..#
#.##.##.#
#.#..t#.#
#.#.#.#.#
#.#.#.#.#
#.#t#B#.#
#.#####.#
#.......#
#########`,
  },
  {
    name: 'Zoomies', arrows: 2,
    grid: `
#########
#>.....n#
#.#####.#
#.#B.xt.#
#.#####.#
#.#..n#.#
#.#.###.#
#.#.....#
#.###.###
#.......#
#########`,
  },
  {
    name: 'Box Fort', arrows: 3,
    grid: `
#########
#>.....1#
#.##.####
#.#t.cB##
#.#.#####
#.#.n.###
#.###t###
#.##..###
#1.t....#
#########`,
  },
];

function parse(text) {
  const rows = text.trim().split('\n').map(r => r.split(''));
  let start = null, facing = 0;
  const boxes = {};
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch in DCH) { start = [r, c]; facing = DCH[ch]; rows[r][c] = '.'; }
      if (ch >= '1' && ch <= '3') (boxes[ch] = boxes[ch] || []).push([r, c]);
    }
  return { rows, start, facing, boxes };
}

// arrows: Map "r,c" -> dir
function run(level, arrows, maxTicks = 250) {
  const { rows, start, facing, boxes } = parse(level.grid);
  const g = rows.map(r => r.slice());
  let [r, c] = start, f = facing, zoom = 0, treats = 0, won = false;
  const total = g.flat().filter(ch => ch === 't').length;
  const seen = new Set();
  const path = [[r, c]];
  for (let tick = 0; tick < maxTicks; tick++) {
    const key = r + ',' + c + ',' + f + ',' + zoom + ',' + g.flat().join('');
    if (seen.has(key)) return { won: false, bored: true, treats, total, ticks: tick, path };
    seen.add(key);
    const a = arrows.get(r + ',' + c);
    if (a !== undefined) f = a;
    const blocked = (rr, cc) => {
      const ch = (g[rr] || [])[cc];
      if (ch === undefined || ch === '#' || ch === '~') return true;
      if (ch === 'x') return zoom <= 0;
      return false;
    };
    let moved = false;
    for (const d of [f, (f + 1) % 4, (f + 3) % 4, (f + 2) % 4]) {
      const rr = r + DIRS[d][0], cc = c + DIRS[d][1];
      if (blocked(rr, cc)) continue;
      f = d; r = rr; c = cc; moved = true;
      break;
    }
    if (!moved) return { won: false, stuck: true, treats, total, ticks: tick, path };
    if (zoom > 0) zoom--;
    // arrival effects
    let ch = g[r][c];
    if (ch === 'x') { g[r][c] = '.'; ch = '.'; } // shredded (only reachable while zooming)
    if (ch === 't') { treats++; g[r][c] = '.'; }
    else if (ch === 'c') {
      if (zoom > 0) g[r][c] = '.'; // zoomies smash cucumbers
      else return { won: false, scared: true, treats, total, ticks: tick + 1, path };
    }
    else if (ch === 'n') { g[r][c] = '.'; zoom = ZOOM_TICKS; }
    else if (ch >= '1' && ch <= '3') {
      const pair = boxes[ch];
      const other = pair.find(([pr, pc]) => pr !== r || pc !== c);
      if (other) [r, c] = other;
    } else if (ch === 'B') { won = true; }
    path.push([r, c]);
    if (won) return { won: true, treats, total, ticks: tick + 1, path };
  }
  return { won: false, timeout: true, treats, total, ticks: maxTicks, path };
}

// brute force: all placements of up to n arrows on floor tiles
function solve(level, maxArrows) {
  const { rows } = parse(level.grid);
  const cells = [];
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++)
      if ('.tcn'.includes(rows[r][c])) cells.push(r + ',' + c);
  const opts = [];
  for (const cell of cells) for (let d = 0; d < 4; d++) opts.push([cell, d]);
  let best = null;
  const tryArrows = (arr) => {
    const res = run(level, new Map(arr));
    if (!res.won) return;
    const score = res.treats * 1000 - arr.length * 10 - res.ticks / 1000;
    if (!best || score > best.score) best = { score, arrows: arr.slice(), ...res };
  };
  const rec = (startIdx, arr, k) => {
    if (k === 0) { tryArrows(arr); return; }
    tryArrows(arr);
    for (let i = startIdx; i < opts.length; i++) {
      if (arr.some(([cell]) => cell === opts[i][0])) continue;
      arr.push(opts[i]);
      rec(i + 1, arr, k - 1);
      arr.pop();
    }
  };
  rec(0, [], maxArrows);
  return best;
}

function printPath(level, res) {
  const { rows } = parse(level.grid);
  const order = new Map();
  res.path.forEach(([r, c], i) => { if (!order.has(r + ',' + c)) order.set(r + ',' + c, i); });
  const out = rows.map((row, r) => row.map((ch, c) => {
    const i = order.get(r + ',' + c);
    if (i === undefined) return ch === '.' ? ' ' : ch;
    if (ch !== '.' && ch !== ' ') return ch;
    return String.fromCharCode(97 + (i % 26));
  }).join('')).join('\n');
  console.log(out);
}

module.exports = { run, solve, parse, printPath, LEVELS };

if (require.main === module) {
  for (const lv of LEVELS) {
    console.log(`\n=== ${lv.name} (arrows: ${lv.arrows}) ===`);
    const noArrow = run(lv, new Map());
    console.log(`  0 arrows: won=${noArrow.won} treats=${noArrow.treats}/${noArrow.total}`);
    for (let k = 1; k <= lv.arrows; k++) {
      const t0 = Date.now();
      const best = solve(lv, k);
      const dt = Date.now() - t0;
      if (best) {
        console.log(`  <=${k} arrows: WIN treats=${best.treats}/${best.total} ticks=${best.ticks} using ${best.arrows.length} arrows: ${JSON.stringify(best.arrows)} (${dt}ms)`);
        if (k === lv.arrows) printPath(lv, best);
      } else {
        console.log(`  <=${k} arrows: no solution (${dt}ms)`);
      }
    }
  }
}
