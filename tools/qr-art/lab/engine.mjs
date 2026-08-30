// Loads the QR Art Studio engine straight out of tools/qr-studio.html.
// One source of truth: the studio's <script> block IS the engine, so a lab
// run and a browser session are provably the same solver.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "..", "qr-studio.html"), "utf8");
const open = html.indexOf("<script>");
const close = html.indexOf("</script>", open);
const src = html.slice(open + "<script>".length, close);
const factory = new Function("module", "exports", src + "\n;return module.exports;");
const mod = { exports: {} };
export const QR = factory(mod, mod.exports);
export default QR;
