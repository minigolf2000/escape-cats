// png.mjs — PNG I/O + matrix rendering helpers on top of the engine's toRGBA.
//
// The engine's toRGBA(matrix, version, {scale, quiet, dark, light}) already
// produces an RGBA buffer with a quiet zone, so renderMatrix is a thin wrapper
// that just reuses its scale/quiet options.
import { PNG } from "pngjs";
import fs from "node:fs";
import { QRArt } from "./engine.mjs";

// renderMatrix(matrix, version, {scale=8, quiet=4}) -> {data, width, height}
// data is a Uint8ClampedArray of RGBA pixels (4 bytes/pixel), row-major.
export function renderMatrix(matrix, version, opts = {}) {
  const { scale = 8, quiet = 4, dark, light } = opts;
  const rgbaOpts = { scale, quiet };
  if (dark) rgbaOpts.dark = dark;
  if (light) rgbaOpts.light = light;
  return QRArt.toRGBA(matrix, version, rgbaOpts);
}

// writePNG(path, {data, width, height}) — data is RGBA (Uint8ClampedArray or
// Uint8Array). Writes a PNG synchronously.
export function writePNG(path, { data, width, height }) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const buf = PNG.sync.write(png);
  fs.writeFileSync(path, buf);
  return path;
}

// readPNG(path) -> {data:Uint8ClampedArray RGBA, width, height}
export function readPNG(path) {
  const buf = fs.readFileSync(path);
  const png = PNG.sync.read(buf);
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    width: png.width,
    height: png.height,
  };
}
