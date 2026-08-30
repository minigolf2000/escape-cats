/*
 * Does the URL in the code actually go anywhere?
 *
 * Everything else in this lab verifies that the code decodes to the string we
 * meant. Nothing verified that the string resolves — so a wrong video id
 * sailed through two decoders, an adversarial review and a commit, because
 * every one of them was checking the wrong thing. A scannable code pointing
 * at a 404 is a failure, and it is the cheapest of all of these to test.
 *
 * YouTube rate-limits the watch page from CI-ish environments, so this asks
 * two independent questions: oEmbed (is it a video?) and the thumbnail
 * endpoint (does the id exist at all?). A dead id fails both; a live one with
 * embedding disabled fails only the first.
 */
const UA = "Mozilla/5.0 (X11; Linux x86_64)";

async function head(url) {
  try {
    const r = await fetch(url, { method: "GET", headers: { "User-Agent": UA } });
    return r.status;
  } catch (e) {
    return `error: ${e.message}`;
  }
}

export async function checkLink(url) {
  const out = { url, live: null, checks: {} };
  const yt = url.match(/^https?:\/\/(?:youtu\.be\/|(?:www\.)?youtube\.com\/watch\?v=)([\w-]{11})/);
  if (yt) {
    const id = yt[1];
    const enc = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=${enc}&format=json`, { headers: { "User-Agent": UA } });
      out.checks.oembed = r.status;
      if (r.ok) out.title = (await r.json()).title;
    } catch (e) { out.checks.oembed = `error: ${e.message}`; }
    out.checks.thumbnail = await head(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    // a real id serves a real thumbnail; a dead one 404s
    out.live = out.checks.thumbnail === 200 || out.checks.oembed === 200;
  } else {
    out.checks.get = await head(url);
    out.live = out.checks.get >= 200 && out.checks.get < 400;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const urls = process.argv.slice(2);
  let bad = 0;
  for (const u of urls) {
    const r = await checkLink(u);
    console.log(`${r.live ? "live " : "DEAD "} ${u}  ${r.title ? `— ${r.title}` : ""} ${JSON.stringify(r.checks)}`);
    if (!r.live) bad++;
  }
  process.exit(bad ? 1 : 0);
}
