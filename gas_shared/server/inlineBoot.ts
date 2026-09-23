// The bootstrap payload, rendered into the page doGet serves instead of fetched after it.
//
// WHY. `appShell.js` awaits `bootstrap()` before it paints any route, and every page then
// awaits its own RPC — so a cold open paid two `google.script.run` round trips in SERIES after
// the page had already arrived (~0.4–1.5 s each on a published web app). doGet is already a
// server execution that has passed the access gate, so computing the same payload there and
// shipping it inside the HTML removes the first of the two round trips outright. Nothing is
// stored anywhere new: the payload lives in the served page, exactly as long as the tab does.
//
// WHY AN ENVELOPE, AND WHY "" ON ANY FAILURE. The client (`gas_shared/store.js`) treats the
// inline block as an optional head start: a missing, empty or unparseable block — or an
// `{ok:false}` envelope — sends it down the ordinary `api_bootstrap` RPC, which surfaces the
// error through the same path it always has. So a bootstrap that throws here must never cost
// the user the page; it only costs them the head start.
//
// THE ESCAPING IS THE SECURITY BOUNDARY. The JSON lands inside
// `<script type="application/json">`, and it carries user-controlled strings (domain names,
// settings, tag values). Escaping `<`, `>` and `&` makes a `</script>` or `<!--` breakout
// impossible whatever the data says. `/`, `'` and the backtick are escaped for the middlebox
// instead: an SSL-inspecting proxy has been seen stripping "comments" from served pages with a
// tokenizer that knows quotes but not much else (see esbuild.config.mjs), and a payload with no
// `/`, no `'` and no backtick in it gives that tokenizer nothing to misread. U+2028/U+2029 are
// escaped because older engines treat them as line terminators. Every one of these is a legal
// JSON escape, so `JSON.parse` on the client reads the original value back unchanged.

type Envelope = { ok: boolean };

const UNSAFE = /[<>&/'`\u2028\u2029]/g;

/** JSON that is inert inside an HTML `<script>` block and opaque to the middlebox. */
export function inlineJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) return "";
  return json.replace(UNSAFE, (c) => (c === "/" ? "\\/" : "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")));
}

/**
 * Run the app's own `api.bootstrap` inside doGet and render its envelope for the template's
 * `bootJson` slot. Only an `{ok:true}` envelope is inlined; anything else — a thrown error, a
 * failed envelope — renders "" and the client falls back to the RPC.
 */
export function inlineBootJson(bootstrap: () => Envelope): string {
  const t0 = Date.now();
  try {
    const res = bootstrap();
    if (!res || res.ok !== true) return "";
    return inlineJson(res);
  } catch (_e) {
    return "";
  } finally {
    // Same line shape as entry.js's timedApi_, so the inline cost reads beside the RPC's.
    console.log(JSON.stringify({ api: "bootstrap", inline: true, ms: Date.now() - t0 }));
  }
}
