# Product

## Register

**None — and that is the product.** The three siblings each measure a population: `gas/` host
CVEs, `gas_ai/` the AI estate, `gas_devsecops/` code-side findings. This app measures nothing.
It is the front door to those three, and every design decision in it follows from having no
data of its own to be right or wrong about.

## One job

**Open the right sidekick.** A reader arrives — usually from a bookmark, a Slack link or a
wiki page — knowing which register they want. The app's whole surface is a 2×2 grid of large
tiles: OS Patching, AI, DevSecOps, and a placeholder for a fourth register that does not exist
yet. One click and they are in the register, in the same tab. Success is measured in seconds
and in nothing else.

The problem it solves is small and real: three separately-deployed Apps Script web apps, three
unrelated `/exec` URLs, and nothing linking them. A reader with one bookmark had one register
and no way to discover the other two.

## Users

The same two desks the registers serve, arriving one step earlier:

- **Security analysts / SecOps**, daily, who know exactly which register they want and should
  spend no attention getting there. For them the page is recognition, not reading: each tile
  wears its register's own colour, in a position that never moves.
- **Security leadership**, occasionally, who may not know the three tools exist. For them the
  page is a map — four labels naming what each register measures, so the question "where do I
  look for X" has a visible answer.
- **Whoever deployed the sidekicks** is a third, rarer reader: they use Settings to paste the
  three URLs and to manage who may open the hub.

## What it is not

Stated as decisions rather than left as omissions, because each has been asked for at least
once in the planning of this app:

- **Not a dashboard.** It shows no figure, no count, no severity, no chart. There is nothing on
  this page that could be stale, because there is nothing on this page that was measured.
- **Not a status board.** It does not report whether a sibling has been scanned recently, or is
  reachable, or is healthy. See "The static-first decision" below.
- **Not a second front door for a register's own content.** No deep links into a sibling's
  pages, no search across registers, no aggregated cross-register view. Every one of those
  would need to read another app's data, which is precisely what this app does not do.
- **Not a gate.** Each register runs its own "signed in as X — Continue" interstitial. Adding
  another here would ask the same question twice in one journey.

## The static-first decision, and what would revisit it

The tiles are **static links**. The hub makes no cross-app call: it does not ask a sibling
whether it has data, when it last scanned, or whether the reader has access to it. The three
URLs are Script Properties an operator pastes once, and a blank one renders as "not
configured" rather than as a broken link.

Why: a live status tile is a promise about someone else's app. To keep it, this app would need
an outbound HTTP call per tile — which means the `script.external_request` OAuth scope on a
launcher that currently fetches nothing, an authentication story for calling one Apps Script
web app from another (there isn't a good one; `/exec` returns HTML for a browser session, not
an API answer), a timeout policy, and a rendering for "we asked and could not tell", which is
the state such a call would produce most often. The whole of that buys a green dot. A tile that
opens the register in one click, and a register that then tells the reader its own freshness in
its own words, is the better trade at this size.

**What would revisit it**, in order of likelihood:

1. A sibling growing a genuine machine-readable status endpoint — at which point the cost is a
   scope and a timeout policy rather than an architecture.
2. The fourth register arriving, if "which of these are actually live" stops being obvious at a
   glance.
3. Someone asking the hub to state a fact about a register — anything at all — at which point
   this decision is what has to be reopened, rather than worked around with one special case.

Until then the honest reading of this page is: these are the sidekicks that exist, and this is
where each one lives.

## Brand personality

**Precise, trustworthy, instrument-grade** — inherited from the root `PRODUCT.md`, with one
addition of its own: *the hub belongs to no register.* Its accent is graphite `#0a0a0a`, the
neutral every sibling's primary button already wears, rather than a fourth saturated hue that
would read as a fourth product. The colour on this page belongs to the registers, not to the
hub: three of the four tiles are the siblings' own identity colours, and the chrome around them
is deliberately quiet so that reads as intentional rather than as an unfinished theme.

## Design principles

The five in the root `PRODUCT.md` govern. Three of them decide most of this app:

1. **Honest state.** A tile with no URL says so, in a sentence naming where to set it. It never
   renders as a link that goes nowhere, and it never disappears — a missing tile would read as
   "that register does not exist". The unbuilt fourth register says "coming soon" and is not a
   disabled control: it is a bordered card, plain text, no pointer cursor. **A control that
   fails on click is worse than no control.**
2. **Severity is signal, not theater** — applied to colour generally. The tiles are the only
   saturated surfaces in this app, and they carry the one decision the page exists for.
   Everything else stays quiet, which is what lets four blocks of colour read as a choice
   rather than as noise.
3. **Earned familiarity.** It is the same shell, the same rail, the same settings chrome as
   every sibling. A reader who has used one sidekick has used this one.

And one specific to a launcher:

4. **Never make a claim about another app.** The hub knows four names, three scope lines and
   three URLs. It does not know whether a register has data, when it last ran, or whether this
   reader may open it. Anything on this page that looked like an answer to one of those would
   be a guess wearing an instrument's clothes.

## Accessibility

**WCAG 2.1 AA**, the root document's bar, unchanged — with the tile grid as the one place this
app has to make the argument itself:

- Every tile's ink clears 4.5:1 on its own fill; the DevSecOps yellow carries a mandatory inset
  edge because the fill alone is 1.52:1 on white. The measured table is in
  [DESIGN.md](DESIGN.md) and pinned by `test/shared.test.js`.
- **Colour never carries the meaning alone.** Each tile names its register in words — an
  eyebrow, a headline and a scope line — so the grid is fully legible in greyscale, and the
  three states (configured / not configured / coming soon) are distinguished by a sentence and
  an element type, not by a tint.
- The configured tiles are real anchors, so they are focusable, keyboard-activatable and carry
  a link's own affordances (a status-bar preview, a right-click menu). The two non-link states
  are `<div>`s rather than disabled controls, so nothing focusable does nothing.
- The focus ring, the reduced-motion alternatives and the `forced-colors` survival rules are
  the shared system's and are untouched here.
