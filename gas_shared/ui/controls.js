// Interactive and labelled chrome: status pills, KPI tiles, stat rows, toggle groups,
// labelled fields, and the applied-filter chip row.

import { appConfig } from "../appConfig.js";
import { absent } from "./cells.js";
import { clear, el } from "./dom.js";
import { meter } from "./data.js";
import { absentText } from "./figures.js";
import { glossaryTip, tip, tipAnchor, tipLabel, tipMark } from "./tip.js";

/**
 * The one promotion `dataTable` already does for a cell (`ui/data.js`), missing here until
 * P8: `statRow`, `kpiCard` and `heroStat` all put `value` straight into a bold, full-ink
 * `.mini-value`/`.kpi-value`/`.hero-value` div with no colour rule of its own — none of the
 * three sets one, by design, because a MEASURED figure is supposed to read at full weight.
 * The absent case never got the exception `dataTable`'s own cells did, so a page that had not
 * yet wrapped its own "—" in a nested `absent()` span rendered the dash in exactly the ink
 * CLAUDE.md's rule warns about: "the same weight as a value" — bold, unmuted, indistinguishable
 * from a real number at the one size on the page built to be looked at first.
 *
 * `value === absentText` catches it whether that string arrived as the imported constant or
 * as a hand-typed `"—"` literal — they are the same primitive, which is exactly how
 * `dataTable`'s own check already works and why no page call site has to change to benefit.
 * Anything else — a number, a further string, an already-built Node (a page that composed its
 * own muted span, or the rare figure that is itself interactive) — passes through unchanged.
 */
function valueOrAbsent(value) {
  return value === absentText ? absent() : value;
}

/**
 * OK / warn / bad / neutral, with a dot the colour never carries alone.
 *
 * `help` is optional and takes any of tipLabel's three shapes. A pill says a state in one or
 * two words ("Failing", "Auto-remediable", "IaC × 3") and those words are rarely the whole
 * story, so this is where a reader finds out what the state actually means.
 */
export function statusPill(kind, text, help) {
  const pill = el("span", { class: `pill ${kind}` }, text);
  return help ? tipLabel(pill, help) : pill;
}

/**
 * One cell of a `.stat-list` strip: an uppercase name, the figure (optionally with a meter
 * beside it), and a muted sub-line saying what the figure counts.
 *
 * Borderless by design — a stat strip is the third level of a posture header, not a row of
 * cards, so it takes its emphasis from position and hairlines rather than from surfaces.
 * `meterPct` is a 0-100 number or null/undefined for no meter.
 */
export function statRow(name, value, sub, meterPct, help) {
  const hasMeter = meterPct !== null && meterPct !== undefined;
  return el("div", { class: "stat-row" },
    el("div", { class: "stat-name" }, tipLabel(name, help)),
    el("div", { class: "stat-figure" },
      el("div", { class: "mini-value num" }, valueOrAbsent(value)),
      hasMeter ? meter(meterPct, {
        className: "meter--stat",
        label: `${name}, ${meterPct} percent`,
      }) : null),
    el("div", { class: "stat-sub" }, sub),
  );
}

/**
 * One joined group of aria-pressed buttons — the exclusive-choice recipe, shared by the
 * Graph|Table view toggle, the Depth stops and the zoom capsule.
 *
 * aria-pressed rather than role=radiogroup on purpose: a conformant radiogroup needs a
 * roving tabindex plus arrow cycling, and running two keyboard patterns for one visual
 * recipe on one page is exactly the invented-control problem.
 *
 * The returned node carries `.set(value)`, so a caller reflecting external state does not
 * rebuild the group and knock focus off the button that was just pressed.
 */
export function segmented({ options, value, onChange, ariaLabel = "", className = "" }) {
  const btns = new Map();
  const group = el("div", {
    class: `segmented${className ? " " + className : ""}`,
    role: "group",
    "aria-label": ariaLabel || null,
  });
  for (const opt of options) {
    const btn = el("button", {
      type: "button",
      "aria-pressed": opt.value === value ? "true" : "false",
      "aria-label": opt.ariaLabel || null,
      onclick: () => onChange(opt.value),
    }, opt.label);
    btns.set(opt.value, btn);
    group.append(btn);
    // `describeIn` is the group, not the button: a description parked inside the button would
    // be swept into its own accessible name, so "Matrix" would announce as "Matrix, every
    // rule on one grid" and then say it again as the description.
    if (opt.title) tip(btn, opt.title, { describeIn: group });
  }
  group.set = (v) => {
    for (const [key, btn] of btns) btn.setAttribute("aria-pressed", key === v ? "true" : "false");
  };
  return group;
}

/**
 * A row of aria-pressed toggle pills over a set of values — the graph's severity and
 * node-type filters and the combos page's severity filter were three copies of this.
 *
 * `mode: "multi"` toggles membership in a set; `"single"` selects one value and pressing
 * the selected one clears it. `pillClass` keeps each row's own vocabulary: severity pills
 * take the level's tint, node-type pills stay neutral and go crimson when selected, so a
 * chosen "AI Agent" and a chosen "LOW" never look like the same thing.
 *
 * Carries `.set(selected)` for reflecting state without a rebuild, for the same
 * focus-preserving reason as segmented() above.
 */
export function togglePills({
  options, selected, onToggle, ariaLabel = "", pillClass = "sev-pill", sevClass = true,
}) {
  const chosen = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
  const btns = new Map();
  const row = el("div", { class: "pill-row", role: "group", "aria-label": ariaLabel || null });
  for (const opt of options) {
    const value = typeof opt === "string" ? opt : opt.value;
    const label = typeof opt === "string" ? opt : opt.label;
    const btn = el("button", {
      type: "button",
      class: pillClass + (sevClass ? ` sev-${value}` : ""),
      "aria-pressed": chosen.has(value) ? "true" : "false",
      onclick: () => onToggle(value),
    }, label);
    btns.set(value, btn);
    row.append(btn);
  }
  row.set = (next) => {
    const set = new Set(Array.isArray(next) ? next : [next].filter(Boolean));
    for (const [value, btn] of btns) {
      btn.setAttribute("aria-pressed", set.has(value) ? "true" : "false");
    }
  };
  row.buttons = btns;
  return row;
}

/**
 * A native select with its dimension named beside it. Arrange and Order were the only
 * OS-chromed controls on a hand-styled page and their only name was an aria-label, so a
 * sighted user saw "Rows" and "Smart order" floating with nothing attached.
 */
export function selectField(labelText, control) {
  return el("div", { class: "select-field" },
    el("span", { class: "select-field-label", "aria-hidden": "true" }, labelText),
    control,
  );
}

/** The `<select>` itself: options as strings or {value,label}, with `value` preselected. */
export function select({ options, value, onChange, ariaLabel, placeholder }) {
  const sel = el("select", {
    "aria-label": ariaLabel || null,
    onchange: () => onChange(sel.value),
  });
  if (placeholder !== undefined) sel.append(el("option", { value: "" }, placeholder));
  for (const opt of options) {
    const v = typeof opt === "string" ? opt : opt.value;
    const label = typeof opt === "string" ? opt : opt.label;
    sel.append(el("option", { value: v }, label));
  }
  sel.value = value || "";
  return sel;
}

/**
 * A labelled field. The visible label IS the accessible name (a real `<label for>`), and
 * the explanation rides along as aria-describedby — so voice control can address the field
 * by the words next to it, which an aria-label override would break.
 *
 * Returns { node, label, err, setError(msg), setChanged(changed, savedValue) }.
 */
export function field(id, labelText, control, hintText) {
  const hintId = hintText ? `${id}-hint` : null;
  if (hintId) control.setAttribute("aria-describedby", hintId);
  const label = el("label", { class: "field-label", for: id }, labelText);
  // Set by setChanged() below, read at reveal time. The label wraps the control, so focus
  // bubbling out of the input opens the card too — a keyboard user gets the saved value the
  // native title never gave them.
  let changedNote = null;
  tipAnchor(label, () => (changedNote ? [changedNote] : null));
  const errId = `${id}-err`;
  const err = el("span", { class: "field-error", id: errId, hidden: true });
  return {
    node: el(
      "div",
      { class: "field" },
      label,
      control,
      hintText ? el("span", { class: "field-hint small muted", id: hintId }, hintText) : null,
      err,
    ),
    label,
    err,
    /** Show or clear an inline error, wiring aria-invalid and describedby together. */
    setError(msg) {
      if (msg) {
        err.textContent = msg;
        err.hidden = false;
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", [hintId, errId].filter(Boolean).join(" "));
      } else {
        err.hidden = true;
        control.removeAttribute("aria-invalid");
        if (hintId) control.setAttribute("aria-describedby", hintId);
        else control.removeAttribute("aria-describedby");
      }
    },
    /** Mark the field as differing from what is saved, and say so in words. */
    setChanged(changed, savedValue) {
      label.classList.toggle("field--changed", !!changed);
      // The saved value is the reason the field is marked, so it belongs on hover AND on focus
      // — a native title gave a keyboard user the mark with no way to read the reason.
      changedNote = changed ? "Saved value: " + savedValue : null;
    },
  };
}

/**
 * The applied-filter chips: what is narrowing the view right now, each dismissible.
 *
 * Two of these existed. The inventory's made the WHOLE chip one destructive button, so the
 * natural move — click the thing you want to change — deleted it; the graph's split the
 * chip into a label that opens the panel at that filter and a ✕ that clears it. This is
 * the graph's, and the inventory gets it too.
 *
 * `entries` are `{key, label, value, sev?, isDefault?, patch}`. `isDefault` marks a filter
 * the page seeded itself rather than one anybody chose: still a chip, still clearable, but
 * prefixed "Default ·" so the row does not claim the reader applied it.
 *
 * The returned node carries `.sync(entries)`. Removal hands focus to the neighbouring ✕
 * by position — the row is rebuilt, so a captured node would be detached.
 */
export function filterChipRow({
  onPatch, onEdit = null, onClearAll = null, emptyText = "", className = "",
  ariaLabel = "Applied filters", fallbackFocus = null,
}) {
  const row = el("div", {
    class: `filter-chips${className ? " " + className : ""}`,
    role: "group",
    "aria-label": ariaLabel,
  });
  // Read at click time, not captured: the trigger button a caller wants focus to fall back
  // to is often built after the row it belongs to.
  row.fallbackFocus = fallbackFocus;

  row.sync = (entries) => {
    const list = entries || [];
    clear(row);
    // The band keeps its height either way where an emptyText is given: on the graph it
    // sits between the bar and the canvas, and showing/hiding it moved the whole picture
    // the first time a filter was applied.
    if (!list.length) {
      if (emptyText) row.append(el("span", { class: "filter-chips-empty" }, emptyText));
      else row.hidden = true;
      return;
    }
    row.hidden = false;

    for (const e of list) {
      const text = `${e.label} · ${e.value}`;
      const close = el("button", {
        class: "filter-chip-x",
        "aria-label": "Clear filter: " + text,
        onclick: () => {
          const others = [...row.querySelectorAll(".filter-chip-x")];
          const at = others.indexOf(close);
          const next = others[at + 1] || others[at - 1];
          onPatch(e.patch);
          // onPatch rebuilt the row, so the captured node is detached; re-find by
          // position rather than holding a reference across the rebuild.
          const fresh = [...row.querySelectorAll(".filter-chip-x")];
          const idx = next ? Math.min(others.indexOf(next), fresh.length - 1) : -1;
          const target = fresh[idx] || row.fallbackFocus;
          if (target && target.focus) target.focus();
        },
      }, "✕");

      const body = [
        e.sev ? el("span", { class: "sev-dot", "aria-hidden": "true" }) : null,
        el("span", { class: "filter-chip-key" }, e.isDefault ? `Default · ${e.label}` : e.label),
        el("span", { class: "filter-chip-value" }, e.value),
      ];
      // Two hit targets only where the label leads somewhere; otherwise the label is
      // static text and the ✕ is the only control, which is still two things, not one
      // ambiguous one.
      const labelPart = onEdit
        ? el("button", {
            class: "filter-chip-body",
            "aria-label": `Edit filter: ${text}`,
            onclick: () => onEdit(e),
          }, ...body)
        : el("span", { class: "filter-chip-body" }, ...body);

      row.append(el("span", {
        class: "filter-chip" + (e.sev ? " sev-" + e.sev : "") + (e.isDefault ? " is-default" : ""),
      }, labelPart, close));
    }

    if (onClearAll) {
      row.append(el("button", {
        class: "link filter-clear-all",
        onclick: () => {
          onClearAll();
          if (row.fallbackFocus && row.fallbackFocus.focus) row.fallbackFocus.focus();
        },
      }, "Clear all"));
    }
  };

  return row;
}

/**
 * DESIGN.md's Hero Stat: the one headline figure a page exists to state.
 *
 * Borderless on purpose — dominance comes from size, position and the whitespace around it,
 * never from a card, a gradient or an accent stripe. At most ONE per page: a second hero
 * means neither is.
 *
 * Wiz Scans, AI Inventory, Help and Compliance had each hand-rolled this block before it had
 * a name (.cov-hero, .inv-hero, .help-hero, the .comp-header hero). This is that block, so
 * the next page does not make a fifth.
 *
 * THIS IS A METRIC, AND NOTHING IN IT IS A HEADING ANY MORE. P4b made the LABEL the page's
 * `<h1>`, which closed a real defect — 24 of the three apps' 30 routes rendered this block and
 * NO heading element at all, so the first heading a screen reader met was the rail's `h2` or a
 * section's `h3`, and `ui/sheet.js:230` reached for `document.querySelector("h1")` and found
 * nothing in two of the three apps — by putting the wrong string in it.
 *
 * WHY THE LABEL WAS WRONG, measured across all 32 call sites: it is used two ways. On some
 * pages it is a LANE kicker ("Data", "Landscape", "Assurance", "Registers · Code"); on others a
 * METRIC name ("Remediation half-life", "Failing controls", "Open problems"). Neither is the
 * page's NAME. After F3, three gas_ai routes all announced "Risk" as their primary heading, so
 * a reader navigating by heading could not tell Priorities from Toxic Combinations from Cloud
 * Configuration. And the workaround for the pages whose label is a metric was to put the page
 * TITLE in the 2rem `hero-value` slot instead, against DESIGN.md's own hierarchy: "only ever a
 * data value, never a heading; headings keep the 1.5rem display ceiling."
 *
 * The page's name is `pageHeader`'s job now (see below), and this component went back to being
 * what its doc comment always said it was: one figure, its name, and the line saying what it
 * counts. `opts.heading` IS GONE WITH THE REASON FOR IT — there is no heading here to opt out
 * of, so the four `{ heading: "div" }` escape hatches (combos, config, problems ×2) are
 * deleted rather than left as a knob that no longer switches anything.
 *
 * `label` IS OPTIONAL. A register page whose h1 already names the figure ("Code" over the
 * count of open weaknesses, with the sub-line saying "open weaknesses of 1,234 in the
 * register") would only restate itself, so passing null draws the value with no eyebrow above
 * it. `help` needs a label to hang from — DESIGN.md: "a definition is a control", and the
 * control is the label — so asking for one without the other throws rather than silently
 * dropping the definition. A term that defines the PAGE goes on `pageHeader({ help })`.
 */
export function heroStat(label, value, sub, help) {
  if (help && !label) {
    // NO BACKTICKS IN A RUNTIME STRING. `esbuild.config.mjs`'s middlebox guard throws on a
    // backtick surviving minification in the client bundle, and a quoted one in a thrown
    // message survives just as well as a template literal does.
    throw new Error("heroStat(): help needs a label to hang from — a definition is a control, "
      + "and with no label there is no control for a reader to reach it through. If the term "
      + "defines the PAGE rather than this figure, pass it as pageHeader({ help }).");
  }
  return el("div", { class: "page-hero" },
    label ? el("div", { class: "kpi-label" }, tipLabel(label, help)) : null,
    el("div", { class: "hero-value num" }, valueOrAbsent(value)),
    sub ? el("div", { class: "page-hero-sub" }, sub) : null,
  );
}

/**
 * A sub-line carrying more than one sentence, as blocks rather than as a wrap.
 *
 * `secrets` built this inline for the two lines its alarm needs — the figure's own sentence,
 * then the validity split it sits inside — and the six pages whose old hero VALUE was a
 * subtitle rather than a figure ("Scan scope, risk, attribution, retention", over Settings)
 * need the same shape now that the subtitle has moved under the h1. `.hero-line`
 * (components.css) is what makes the second line read as a second statement rather than as a
 * continuation of the first. No copy was rewritten to move it; it is the same string, one
 * level down.
 */
export function heroLines(...lines) {
  return el("span", {},
    ...lines.filter(Boolean).map((line) => el("span", { class: "hero-line" }, line)));
}

/**
 * THE PAGE HEADER, and the page's `<h1>` is here because the page's NAME is here.
 *
 * A borderless grid closed by a hairline, reading in levels rather than as a row of equal
 * tiles. `hero` is the subject figure, `aside` is the one thing that qualifies it (a
 * distribution strip, a small curve), and `stats` are the supporting facts as a full-width
 * strip divided by hairlines. Every slot is optional and el() drops the empty ones, so a page
 * that only has a hero gets a hero.
 *
 * `route` IS THE PAGES KEY, NOT A TITLE STRING, and that is the whole point. The title and the
 * lane are read out of `appConfig().PAGES[route]` — the route table CLAUDE.md already names as
 * the only IA list — so a page cannot keep a second copy of its own name, and cannot drift
 * from the name the rail draws, the one `document.title` sets, or the one
 * `test/contracts/pageHeader.js` asserts. A route key is an identifier; a title is copy. Only
 * the identifier is repeated.
 *
 * THE THREE LEVELS, and which one is a heading:
 *
 *   .kpi-label      the LANE, from PAGES `group`. Orientation at the 12px label step, and a
 *                   `div`, never an h*: "Registers" is where the page lives, not what it is,
 *                   and three pages in one lane sharing one heading string is the defect P4b
 *                   shipped. Omitted for the chrome tail (`group: null`), which has no lane.
 *   h1.page-title   the PAGE, from PAGES `title`, at the 1.5rem display step `base.css`
 *                   already gives a bare `h1` — DESIGN.md's stated heading ceiling, and
 *                   gas_ai/DESIGN.md's "h1 at the display step, and nothing else at that
 *                   step". A page title is not a data value, so it never takes the 2rem hero
 *                   step again: that is what left `compliance` rendering its own name and its
 *                   posture percentage at the same 32px, and `combos` with two 32px values
 *                   ninety pixels apart.
 *   .page-hero-sub  the LEDE, the page's own sentence, carried word for word from the `sub`
 *                   each of those heroes already passed. `heroLines` is how a page that also
 *                   had a subtitle keeps both.
 *
 * `help` puts a definition BESIDE the h1, never inside it, for a register page whose glossary
 * term defines the PAGE rather than a figure on it (`sast`, `sca`). Inside was measured and it
 * is wrong: `tip()` renders its spoken copy as an `.sr-only` sibling of the trigger, so a
 * `tipLabel(page.title, help)` folds the whole definition into the HEADING's accessible name —
 * `<h1>` textContent on `sast` came back as "Code" followed by fifty words about CWEs, which is
 * what a screen reader's heading list would then read out. The heading is the name; the `?` is a
 * control beside it, which is exactly DESIGN.md's "a definition is a control; a value is not".
 * A term defining the FIGURE belongs on `heroStat`'s label instead — `secrets` puts
 * "secret-resolved" on "Removed, not rotated", which is the metric it actually defines.
 *
 * NO `route` MEANS NO h1, and that is what replaced `{ heading: "div" }`. gas_ai's `problems`,
 * `combos` and `config` each draw a second header further down the page carrying a figure and
 * its stat strip; those pass no `route`, so they get no heading and the page keeps exactly one
 * h1. The opt-out is the absence of an input rather than a flag, so there is nothing to forget.
 *
 * `test/contracts/pageHeader.js` holds all of it: only a `fullBleed` route may render its own
 * `el("h1")`, every other route's module passes its OWN route key here, and no `heroStat`
 * value slot anywhere in the app carries a string that is a PAGES title.
 */
export function pageHeader({ route, help, lede, hero, aside, stats } = {}) {
  // Without an aside the two-column grid leaves the hero in a narrow column with a thousand
  // empty pixels beside it, which is where its sub-line starts wrapping for no reason. The
  // modifier widens the one column that is actually carrying anything.
  return el("div", { class: "page-header" + (aside ? "" : " page-header--solo") },
    route ? pageTitles(route, help, lede) : null,
    hero || null,
    aside || null,
    stats && stats.length ? el("div", { class: "stat-list" }, ...stats) : null,
  );
}

/**
 * The lane / name / lede block, read from the app's own route table.
 *
 * `appConfig()` is called INSIDE the function, never at module top level — appConfig.js's rule
 * 2. A top-level read executes during import, which under esbuild's bundling order happens
 * before app.js's body has handed the manifest over, and throws on a correctly wired app.
 *
 * Both throws are deliberate and neither is defensive coding. A route this table does not hold
 * would otherwise render a header with no heading in it at all — the exact defect this
 * component exists to end — and would do it silently, which is the failure mode CLAUDE.md's
 * "a zero has to prove it looked" is about.
 */
function pageTitles(route, help, lede) {
  const pages = appConfig().PAGES;
  if (!pages) {
    throw new Error("pageHeader({ route }): this app's manifest carries no PAGES — hand it to "
      + "configureApp() so the header can read the route's own title and lane.");
  }
  const page = pages[route];
  if (!page || !page.title) {
    throw new Error('pageHeader({ route: "' + route + '" }): no such route in PAGES, or it '
      + "carries no title. The h1 IS the PAGES title; there is no second place to keep it.");
  }
  const heading = el("h1", { class: "page-title" }, page.title);
  return el("div", { class: "page-titles" },
    page.group ? el("div", { class: "kpi-label" }, page.group) : null,
    help ? el("div", { class: "page-title-row" }, heading, titleTip(page, help)) : heading,
    lede ? el("div", { class: "page-hero-sub" }, lede) : null,
  );
}

/**
 * The page's definition as a `?` control beside its name.
 *
 * A bare `?` is `aria-hidden`, so without an explicit `label` the button `tip()` builds around
 * it has NO accessible name at all — `problems.js`'s own `glossaryTip(tipMark(), …)` in a hero
 * sub-line has carried that hole since it was written. Named from the page here, so the control
 * announces what it is about rather than announcing nothing and hoping the description carries.
 */
function titleTip(page, help) {
  const label = "About " + page.title;
  if (help.term && !help.lines) return glossaryTip(tipMark(), help.term, { label });
  return tip(tipMark(), help.lines || help, { label, term: help.term || null });
}

export function kpiCard(label, value, sub, chip, help) {
  return el(
    "div",
    { class: "kpi-card" },
    el("div", { class: "kpi-label" }, tipLabel(label, help)),
    el("div", { class: "kpi-value num" }, valueOrAbsent(value), chip || null),
    sub ? el("div", { class: "kpi-sub" }, sub) : null,
  );
}
