#!/usr/bin/env node
// Renders the folding animation to an mp4 by stepping the page's timeline
// frame by frame in headless Chromium and piping screenshots into ffmpeg.
//
//   node render-video.mjs --out hexahexaflexagon.mp4
//
// Needs `playwright` (npm i playwright) and an ffmpeg binary — either on PATH,
// via --ffmpeg, or `npm i ffmpeg-static`. Pass --three path/to/three.min.js to
// render fully offline (the pinned build is inlined instead of fetched).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const OUT = arg('out', 'hexahexaflexagon.mp4');
const FPS = Number(arg('fps', 24));
const W = Number(arg('w', 1280)), H = Number(arg('h', 720));
const DSF = Number(arg('dsf', 2));            // supersampling; ffmpeg scales back down
const THREE_PATH = arg('three', '');
const EXECUTABLE = arg('chromium', process.env.PLAYWRIGHT_CHROMIUM || '');

const { chromium } = await import('playwright');

let ffmpegBin = arg('ffmpeg', '');
if (!ffmpegBin) {
  try { ffmpegBin = (await import('ffmpeg-static')).default; } catch { ffmpegBin = 'ffmpeg'; }
}

const here = path.dirname(new URL(import.meta.url).pathname);
let html = fs.readFileSync(arg('page', path.join(here, 'index.html')), 'utf8');
if (THREE_PATH) {
  const three = fs.readFileSync(THREE_PATH, 'utf8');
  html = html.replace(
    /<script src="https:\/\/cdnjs\.cloudflare\.com[^"]*three\.min\.js"><\/script>/,
    () => `<script>${three}</script>`);
}
const pageFile = path.join(os.tmpdir(), `hexahexa-render-${process.pid}.html`);
fs.writeFileSync(pageFile, html);

const launchOpts = EXECUTABLE ? { executablePath: EXECUTABLE } : {};
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) launchOpts.proxy = { server: proxy };   // lets webfonts load in sandboxed environments
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, ignoreHTTPSErrors: true });
page.on('pageerror', e => console.error('[page]', e.message));
await page.goto('file://' + pageFile);
await page.waitForFunction('!!window.__anim', null, { timeout: 30000 });
await page.evaluate(([w, h]) => window.__anim.prepareForVideo(w, h), [W, H]);
const dur = await page.evaluate(() => window.__anim.duration);
const frames = Math.ceil(dur * FPS);
console.log(`duration ${dur.toFixed(1)}s → ${frames} frames @ ${FPS}fps, ${W}x${H} (render ${W * DSF}x${H * DSF})`);

const ff = spawn(ffmpegBin, [
  '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-vf', `scale=${W}:${H}:flags=lanczos`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT,
], { stdio: ['pipe', 'ignore', 'inherit'] });
const ffDone = new Promise((res, rej) => {
  ff.on('close', c => c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)));
});

const write = buf => new Promise((res, rej) => {
  ff.stdin.write(buf, err => err ? rej(err) : res());
});

const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.__anim.renderAt(t), i / FPS);
  await write(await page.screenshot({ type: 'png' }));
  if (i % Math.ceil(frames / 20) === 0) {
    const pct = Math.round(i / frames * 100);
    const rate = (i + 1) / ((Date.now() - t0) / 1000);
    console.log(`${pct}%  (${rate.toFixed(1)} fps capture)`);
  }
}
ff.stdin.end();
await ffDone;
await browser.close();
fs.unlinkSync(pageFile);
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
