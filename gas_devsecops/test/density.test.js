// The DOM-free half of dev/density.mjs — see dev/densityModel.mjs's own header for why the
// walker's word-counting, number-token, table-formatting and diff logic all live there rather
// than inline in the Playwright script: NO JSDOM here (`vitest.config.ts` sets no
// `environment`), so a function that reaches for `document` cannot be unit-tested at all.
// Every exclusion rule the walker relies on — closed <details>, .sr-only, table cells, a route
// that never moved — is pinned below against a hand-built plain-object tree or JSON snapshot,
// not against a live page, matching the house style (`figures.test.js`, `feedbackShapes.test.js`).

import { describe, expect, it } from "vitest";

import {
  collectProseBlocks, countNumericTokens, countVisible, countVisuals, countWords, diffReport,
  diffRoute, extractText, formatDiffTable, formatTable, isClosedDetails, isHiddenAttr,
  isIconSvg, isSrOnly, isTipSignified, overflowSummary, parsePages, PROSE_MIN_WORDS, tagOf,
} from "../dev/densityModel.mjs";

// ============================================================================================
//  parsePages — the route list, off app.js's own PAGES table, never hand-typed
// ============================================================================================

describe("parsePages() reads the same PAGES table shape test/pagesLit.test.js's own parser reads", () => {
  const FAKE_APP_SRC = [
    "const OTHER = 1;",
    "const PAGES = {",
    '  executive: { title: "Executive", group: "Program", render: renderExecutive },',
    '  mttr: { title: "MTTR & SLA", group: "Program", render: renderMttr },',
    "  settings: { title: \"Settings\", group: null, render: renderSettings },",
    "};",
    "configureApp({ ...MANIFEST, PAGES });",
  ].join("\n");

  it("finds every route key, in order, with its render function", () => {
    expect(parsePages(FAKE_APP_SRC)).toEqual([
      { route: "executive", render: "renderExecutive" },
      { route: "mttr", render: "renderMttr" },
      { route: "settings", render: "renderSettings" },
    ]);
  });

  it("returns [] rather than throwing when the marker is absent — a real regression the "
    + "walker must REFUSE to report as a zero-route measurement", () => {
    expect(parsePages("const NOT_PAGES = {};")).toEqual([]);
  });

  it("a line missing render: still yields the route, with render: null", () => {
    const src = "const PAGES = {\n  help: { title: \"Key sheet\", group: \"Data\" },\n};\n";
    expect(parsePages(src)).toEqual([{ route: "help", render: null }]);
  });
});

// ============================================================================================
//  countWords / countNumericTokens — the two figures every other count in this file leans on
// ============================================================================================

describe("countWords()", () => {
  it("counts space-separated runs that carry a letter or digit", () => {
    expect(countWords("The reader can see 9 of 12 findings today.")).toBe(9);
  });

  it("does not count a bare dash or bullet as a word", () => {
    expect(countWords("— · —")).toBe(0);
  });

  it("keeps an internal apostrophe or hyphen inside one token", () => {
    expect(countWords("the reader's cross-link note")).toBe(4);
  });

  it("null/undefined/empty text is 0 words, not a thrown error", () => {
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords("")).toBe(0);
  });
});

describe("countNumericTokens(): ≥/± attach to an adjacent number as ONE token", () => {
  it("\"≥ 41\" is one token, not ≥ plus 41 separately", () => {
    expect(countNumericTokens("at least ≥ 41 days")).toBe(1);
  });

  it("\"±5\" (no space) is one token", () => {
    expect(countNumericTokens("a margin of ±5 percent")).toBe(1);
  });

  it("a percent sign stays attached to its number", () => {
    expect(countNumericTokens("3.5% of findings")).toBe(1);
  });

  it("counts each bare number separately when there is more than one", () => {
    expect(countNumericTokens("9 of 12 findings, 3 unresolved")).toBe(3);
  });

  it("a detached ± with no adjacent digit does not create a phantom token — only the "
    + "bare number counts", () => {
    expect(countNumericTokens("± nothing to report here, only 5")).toBe(1);
  });

  it("a digit run glued to a trailing letter is not sliced off as its own token", () => {
    expect(countNumericTokens("see AARS4 for the vector")).toBe(0);
  });
});

// ============================================================================================
//  isClosedDetails — the perturbation. Checking `tag === "DETAILS"` alone (forgetting `open`)
//  is the tempting one-line simplification, and it is wrong in the opposite direction from
//  most "cast before refusing" bugs this repo has hit before: it EXCLUDES content that a
//  reader has actually opened.
// ============================================================================================

describe("isClosedDetails() PERTURBATION: a tag-only check over-excludes an OPENED <details>", () => {
  const openDetails = { tag: "DETAILS", classes: [], open: true, children: ["opened text"] };
  const closedDetails = { tag: "DETAILS", classes: [], open: false, children: ["closed text"] };

  function tagOnlyDefective(node) {
    return node.tag === "DETAILS"; // the exact anti-pattern: no `open` check at all
  }

  it("the shipped guard tells the two apart", () => {
    expect(isClosedDetails(openDetails)).toBe(false);
    expect(isClosedDetails(closedDetails)).toBe(true);
  });

  it("PERTURBATION PROOF: the tag-only rewrite reads an OPEN details as closed too", () => {
    expect(tagOnlyDefective(openDetails)).toBe(true); // defective: says "closed"
    expect(isClosedDetails(openDetails)).toBe(false); // shipped: correctly "open"
  });
});

// ============================================================================================
//  extractText — the exclusion rules that feed `words` and `numbers`, fed a fake node tree
// ============================================================================================

describe("extractText(): closed <details> exclusion actually bites", () => {
  const tree = {
    tag: "DIV",
    classes: [],
    children: [
      "A visible lead sentence sits here with plenty of real words in it today.",
      {
        tag: "DETAILS",
        classes: [],
        open: false,
        children: [
          { tag: "SUMMARY", classes: [], children: ["Why the rest are not ranked"] },
          "This whole sentence must never be counted while the details stays closed.",
        ],
      },
    ],
  };

  it("the closed details' text — summary included — is excluded entirely", () => {
    const text = extractText(tree, { excludeTables: true });
    expect(text).not.toMatch(/never be counted/);
    expect(text).not.toMatch(/Why the rest/);
    expect(text).toMatch(/visible lead sentence/);
  });

  it("opening the SAME details (open: true) brings its text back", () => {
    const opened = JSON.parse(JSON.stringify(tree));
    opened.children[1].open = true;
    const text = extractText(opened, { excludeTables: true });
    expect(text).toMatch(/never be counted/);
  });
});

// The bug this app's OWN dev server found on the first live run: an inactive settings TAB
// panel (`hidden: true`, base.css's `[hidden]{display:none!important}`) still has real prose
// and real .tip-trigger buttons in the DOM. A model that only knew about closed <details> and
// .sr-only folded all three tabs into one route's word count.
describe("isHiddenAttr() / [hidden] exclusion — the settings-tabs finding", () => {
  it("a node with hidden: true is excluded; one without it is not", () => {
    expect(isHiddenAttr({ tag: "DIV", hidden: true })).toBe(true);
    expect(isHiddenAttr({ tag: "DIV", hidden: false })).toBe(false);
    expect(isHiddenAttr({ tag: "DIV" })).toBe(false);
  });

  it("PERTURBATION PROOF: a model that only checks closed-<details>/.sr-only counts a hidden "
    + "tab panel's prose as visible — the exact live-run defect", () => {
    const hiddenTabPanel = {
      tag: "DIV",
      classes: [],
      hidden: true,
      children: [
        "Sixteen or more separate words appear right here just to clear the fifteen word floor easily.",
      ],
    };
    function detailsAndSrOnlyOnly(node) {
      return isClosedDetails(node) || isSrOnly(node); // the defective, narrower exclusion
    }
    // Defective: a details/.sr-only-only check does not exclude it — its text leaks through.
    expect(detailsAndSrOnlyOnly(hiddenTabPanel)).toBe(false);
    // Shipped: extractText's real exclusion (isHiddenAttr folded into `excluded()`) drops it.
    expect(extractText(hiddenTabPanel, { excludeTables: true })).toBe("");
  });

  it("countVisible() does not count a <td> inside a hidden ancestor", () => {
    const tree = {
      tag: "DIV", classes: [], hidden: true, children: [
        { tag: "TABLE", classes: [], children: [
          { tag: "TR", classes: [], children: [{ tag: "TD", classes: [], children: ["1"] }] },
        ] },
      ],
    };
    expect(countVisible(tree, (n) => n.tag === "TD")).toBe(0);
  });

  it("collectProseBlocks() does not collect a prose block sitting in a hidden tab panel", () => {
    const tree = {
      tag: "DIV", classes: [], hidden: true, children: [
        { tag: "P", classes: [], children: [
          "Sixteen or more separate words appear right here just to clear the fifteen word floor easily.",
        ] },
      ],
    };
    expect(collectProseBlocks(tree)).toHaveLength(0);
  });
});

describe("extractText(): .sr-only exclusion", () => {
  const tree = {
    tag: "SPAN",
    classes: [],
    children: [
      "Visible words go here in the open for anyone to read right now today.",
      { tag: "SPAN", classes: ["sr-only"], children: ["screen-reader-only prose, never on screen"] },
    ],
  };

  it("sr-only text is excluded from the visible word count", () => {
    const text = extractText(tree, { excludeTables: true });
    expect(text).not.toMatch(/screen-reader-only/);
  });
});

describe("extractText(): table cell text — excluded from words, kept for numbers", () => {
  const tree = {
    tag: "DIV",
    classes: [],
    children: [
      "A short lead outside the table with real words in it here today for good measure.",
      {
        tag: "TABLE",
        classes: [],
        children: [{
          tag: "TR",
          classes: [],
          children: [
            { tag: "TD", classes: [], children: ["42"] },
            { tag: "TD", classes: [], children: ["critical finding text"] },
          ],
        }],
      },
    ],
  };

  it("excludeTables: true drops every cell's text from the word reading", () => {
    const text = extractText(tree, { excludeTables: true });
    expect(text).not.toMatch(/critical finding/);
    expect(countWords(text)).toBe(countWords("A short lead outside the table with real words in it here today for good measure."));
  });

  it("excludeTables: false keeps cell text — the numbers reading only excludes closed details", () => {
    const text = extractText(tree, { excludeTables: false });
    expect(text).toMatch(/42/);
    expect(countNumericTokens(text)).toBe(1);
  });
});

// ============================================================================================
//  countVisible — tableCells/tables/visuals, and the closed-details guard applied to counts
// ============================================================================================

describe("countVisible()", () => {
  const tree = {
    tag: "DIV",
    classes: [],
    children: [
      { tag: "TABLE", classes: [], children: [
        { tag: "TR", classes: [], children: [
          { tag: "TD", classes: [], children: ["1"] },
          { tag: "TD", classes: [], children: ["2"] },
        ] },
      ] },
      {
        tag: "DETAILS", classes: [], open: false, children: [
          { tag: "TABLE", classes: [], children: [
            { tag: "TR", classes: [], children: [{ tag: "TD", classes: [], children: ["hidden"] }] },
          ] },
        ],
      },
    ],
  };

  it("counts visible <td> only — a <td> inside a closed <details> does not count", () => {
    expect(countVisible(tree, (n) => n.tag === "TD")).toBe(2);
  });

  it("counts visible <table> the same way", () => {
    expect(countVisible(tree, (n) => n.tag === "TABLE")).toBe(1);
  });
});

describe("isIconSvg()", () => {
  it("an <svg> at or under 20x20 is an icon", () => {
    expect(isIconSvg({ tag: "SVG", rect: { width: 20, height: 18 } })).toBe(true);
  });

  it("a larger <svg> (a real chart) is not an icon", () => {
    expect(isIconSvg({ tag: "SVG", rect: { width: 320, height: 120 } })).toBe(false);
  });

  it("an <svg> the serializer never measured (no rect) is not treated as an icon either way", () => {
    expect(isIconSvg({ tag: "SVG" })).toBe(false);
  });

  // THE DEFECT THIS FILE MISSED FOR TWO RUNS. Every fixture above spells the tag the way an
  // HTML element reports it. `Element.tagName` PRESERVES CASE for an element in the SVG
  // namespace, so a real `<svg>` serialises as "svg" — and this predicate, written against
  // the HTML spelling, returned false for every SVG on every page the walker has ever
  // measured. The tests passed the whole time, because every fixture was hand-typed in the
  // spelling the code expected.
  it("reads a live page's lower-case svg tag, not only a hand-typed \"SVG\"", () => {
    expect(isIconSvg({ tag: "svg", rect: { width: 16, height: 16 } })).toBe(true);
    expect(isIconSvg({ tag: "svg", rect: { width: 220, height: 40 } })).toBe(false);
  });
});

describe("tagOf() — the normalisation the SVG namespace forces", () => {
  it("upper-cases whatever the serializer handed over", () => {
    expect(tagOf({ tag: "svg" })).toBe("SVG");
    expect(tagOf({ tag: "DIV" })).toBe("DIV");
  });

  it("answers an empty string rather than throwing for a text node or a missing tag", () => {
    expect(tagOf("some text")).toBe("");
    expect(tagOf(null)).toBe("");
    expect(tagOf({})).toBe("");
  });

  // PERTURBATION: the pre-fix comparison, reproduced inline against the shape a live page
  // actually produces.
  it("is not a vacuous guard — the bare === comparison misses every real SVG", () => {
    const live = { tag: "svg", classes: ["sparkline"], rect: { width: 220, height: 40 } };
    expect(live.tag === "SVG").toBe(false);
    expect(tagOf(live) === "SVG").toBe(true);
  });
});

// ============================================================================================
//  countVisuals — what counts as a PICTURE, and the rule that keeps the total honest
// ============================================================================================

describe("countVisuals() counts every picture once, and the right ones", () => {
  const wrap = (...children) => ({ tag: "MAIN", classes: [], children });
  const node = (tag, classes, rect) => ({ tag, classes, rect, children: [] });

  it("counts a canvas, a meter, a sevbar, an axis bar, an isotype and a quad", () => {
    const v = countVisuals(wrap(
      node("CANVAS", [], { width: 600, height: 240 }),
      node("SPAN", ["meter", "meter--stat"]),
      node("DIV", ["sevbar", "sevbar--lg"]),
      node("DIV", ["axis-bar"]),
      node("SPAN", ["isotype"]),
      node("TABLE", ["quad"]),
    ));
    expect(v).toMatchObject({
      canvas: 1, meter: 1, sevbar: 1, axisBar: 1, isotype: 1, quad: 1, spark: 0, svg: 0,
    });
    expect(v.total).toBe(6);
  });

  // THE SECOND DEAD PREDICATE. It read `classes.includes("spark")`, and the shared component
  // is `.sparkline` — a rename `gas_shared/ui/sparkline.js` documents at length, because
  // `gas` already owns `.spark` for a bordered card. So the bucket asked for a class that by
  // design does not exist, and answered 0 on a page that draws one.
  it("counts the shared sparkline by the class it actually carries", () => {
    const spark = node("svg", ["sparkline"], { width: 220, height: 40 });
    expect(countVisuals(wrap(spark)).spark).toBe(1);
    // PERTURBATION: the pre-fix predicate, inline.
    expect(spark.classes.includes("spark")).toBe(false);
  });

  it("counts a sparkline ONCE — as a spark, not also as an svg", () => {
    // A sparkline is both an `<svg>` and a named visual, and it is the first thing in this
    // register that is both. Independent buckets summed into `total` would report two
    // pictures where a reader sees one.
    const v = countVisuals(wrap(node("svg", ["sparkline"], { width: 220, height: 40 })));
    expect(v.spark).toBe(1);
    expect(v.svg).toBe(0);
    expect(v.total).toBe(1);
  });

  it("counts a bare large svg (history's quarterly spiral) as a picture", () => {
    const v = countVisuals(wrap(node("svg", ["spiral"], { width: 360, height: 360 })));
    expect(v.svg).toBe(1);
    expect(v.total).toBe(1);
  });

  it("does not count an icon-sized svg", () => {
    const v = countVisuals(wrap(node("svg", ["ui-icon"], { width: 16, height: 16 })));
    expect(v.total).toBe(0);
  });

  it("skips a picture inside a closed <details> or an .sr-only, like every other count", () => {
    const hiddenChart = {
      tag: "DETAILS", classes: [], open: false,
      children: [node("CANVAS", [], { width: 600, height: 240 })],
    };
    expect(countVisuals(wrap(hiddenChart)).total).toBe(0);
  });

  it("answers an all-zero shape for a route that never settled", () => {
    const v = countVisuals(null);
    expect(v.total).toBe(0);
    // Every bucket present, so a failed route's row lines up with a measured one's.
    for (const key of ["canvas", "svg", "meter", "sevbar", "axisBar", "isotype", "quad", "spark"]) {
      expect(v[key], key).toBe(0);
    }
  });
});

// ============================================================================================
//  isTipSignified — DESIGN.md's "visible before anything is hovered" rule, made measurable.
//  Fed the plain record density.mjs's browser-side reader builds per trigger, never a real
//  DOM node — see densityModel.mjs's own header on why every decision that can be made
//  without a `document` lives here.
// ============================================================================================

describe("isTipSignified(): a resting affordance, by EITHER of the two routes DESIGN.md draws", () => {
  it("neither an underline nor an affordance child answers false — the bare-tip-on-a-word "
    + "defect this walker exists to catch", () => {
    expect(isTipSignified({ decoration: "none", childClasses: [] })).toBe(false);
  });

  it("a resting underline alone answers true", () => {
    expect(isTipSignified({ decoration: "underline", childClasses: [] })).toBe(true);
  });

  it("a multi-value text-decoration-line that INCLUDES underline still answers true — the "
    + "computed value can list more than one line", () => {
    expect(isTipSignified({ decoration: "underline overline", childClasses: [] })).toBe(true);
  });

  it("a pill child with NO underline answers true — the pill is already its own affordance, "
    + "and components.css's own comment is why: an atomic inline box does not take a "
    + "parent's text-decoration in the first place, so this is not something to fix", () => {
    expect(isTipSignified({ decoration: "none", childClasses: ["pill", "pill--ok"] })).toBe(true);
  });

  it("every named affordance-child class answers true on its own", () => {
    for (const cls of ["tip-mark", "pill", "sev-badge", "domain-chip", "quad-label", "sevkey"]) {
      expect(isTipSignified({ decoration: "none", childClasses: [cls] }), cls).toBe(true);
    }
  });

  it("an underline AND a pill child (either would be enough) still answers true", () => {
    expect(isTipSignified({ decoration: "underline", childClasses: ["pill"] })).toBe(true);
  });

  it("a child class that merely CONTAINS an affordance name is not a match — the check is "
    + "exact class membership, not a substring", () => {
    expect(isTipSignified({ decoration: "none", childClasses: ["pillow", "not-a-pill"] })).toBe(false);
  });

  it("null/undefined/non-object records answer false rather than throwing", () => {
    expect(isTipSignified(null)).toBe(false);
    expect(isTipSignified(undefined)).toBe(false);
    expect(isTipSignified("nope")).toBe(false);
  });

  it("a missing/non-string decoration and a missing childClasses array degrade to false, "
    + "not a thrown error", () => {
    expect(isTipSignified({})).toBe(false);
    expect(isTipSignified({ decoration: null, childClasses: null })).toBe(false);
  });

  // PERTURBATION: the tempting one-line simplification — "has any child classes at all" —
  // would count a plain wrapper span (no affordance, just structure) as signified. The
  // shipped guard checks the class NAME, not merely that children exist.
  it("PERTURBATION PROOF: a child with unrelated classes (no affordance) does not signify", () => {
    function anyChildDefective(record) {
      return (record.childClasses || []).length > 0; // the exact anti-pattern
    }
    const record = { decoration: "none", childClasses: ["kpi-value", "num"] };
    expect(anyChildDefective(record)).toBe(true); // defective: says "signified"
    expect(isTipSignified(record)).toBe(false); // shipped: correctly "not signified"
  });
});

describe("isSrOnly()", () => {
  it("requires the literal .sr-only class, not just any single-letter class", () => {
    expect(isSrOnly({ tag: "SPAN", classes: ["sr-only"] })).toBe(true);
    expect(isSrOnly({ tag: "SPAN", classes: ["small"] })).toBe(false);
  });
});

// ============================================================================================
//  collectProseBlocks — the >=15-word threshold, and that it is a THRESHOLD, not "any text"
// ============================================================================================

describe("collectProseBlocks()", () => {
  const shortSub = { tag: "P", classes: ["kpi-sub"], children: ["9 of 12 findings measured."] };
  const longNote = {
    tag: "P",
    classes: ["small", "muted"],
    children: [
      "This method note runs on well past the fifteen word threshold on purpose so the "
      + "test can tell the two blocks apart cleanly.",
    ],
  };
  const chipNoClass = { tag: "SPAN", classes: ["small"], children: ["not muted, so not prose"] };
  const tree = { tag: "DIV", classes: [], children: [shortSub, longNote, chipNoClass] };

  it("only the block AT OR ABOVE the threshold is collected", () => {
    const blocks = collectProseBlocks(tree, PROSE_MIN_WORDS);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].words).toBeGreaterThanOrEqual(PROSE_MIN_WORDS);
  });

  it("`.small` without `.muted` is not a prose candidate, however long", () => {
    const soloSmall = { tag: "SPAN", classes: ["small"], children: [
      "Sixteen or more separate words appear right here just to clear the fifteen word floor easily.",
    ] };
    expect(collectProseBlocks({ tag: "DIV", classes: [], children: [soloSmall] })).toHaveLength(0);
  });

  it("a prose block inside a closed <details> is not collected", () => {
    const hidden = {
      tag: "DETAILS", classes: [], open: false, children: [
        { tag: "P", classes: [], children: [
          "Sixteen or more separate words appear right here just to clear the fifteen word floor easily.",
        ] },
      ],
    };
    expect(collectProseBlocks(hidden)).toHaveLength(0);
  });
});

// ============================================================================================
//  formatTable — the one aligned-column renderer both the density table and the diff share
// ============================================================================================

describe("formatTable()", () => {
  it("pads every column to its widest cell, header included", () => {
    const out = formatTable(["route", "words"], [["executive", 120], ["mttr", 45]]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("route      words");
    expect(lines[2]).toBe("executive  120  ");
    expect(lines[3]).toBe("mttr       45   ");
  });

  it("a missing cell renders as an empty column, not \"undefined\"", () => {
    const out = formatTable(["a", "b"], [["x"]]);
    expect(out).not.toMatch(/undefined/);
  });
});

// ============================================================================================
//  diffRoute / diffReport / formatDiffTable — a zero delta prints as 0, never omitted
// ============================================================================================

describe("diffRoute() and formatDiffTable(): the zero-delta guard", () => {
  const same = { words: 400, proseBlocks: 6, proseWords: 90, numbers: 20, tableCells: 12, visuals: { total: 3 }, tips: 4, tipsReachable: 4, tipsSignified: 4, scrollWidth: 1280 };

  it("a route that moved on NOTHING still reports every delta explicitly as 0", () => {
    const diff = diffRoute(same, same);
    for (const key of Object.keys(diff)) {
      expect(diff[key].delta, key).toBe(0);
    }
    const table = formatDiffTable([{ route: "repos", diff }]);
    // Never silently blank: every metric column shows "(0)", not an omitted parenthetical.
    expect((table.match(/\(0\)/g) || []).length).toBe(Object.keys(diff).length);
  });

  it("a real drop in words prints a negative delta, not a dash", () => {
    const before = { ...same, words: 400 };
    const after = { ...same, words: 250 };
    const diff = diffRoute(before, after);
    expect(diff.words).toEqual({ before: 400, after: 250, delta: -150 });
    expect(formatDiffTable([{ route: "mttr", diff }])).toMatch(/400→250 \(-150\)/);
  });

  it("a route present only in ONE snapshot reports before/after with no fabricated delta", () => {
    const diff = diffRoute(same, undefined);
    expect(diff.words.after).toBeNull();
    expect(diff.words.delta).toBeNull();
    expect(formatDiffTable([{ route: "help", diff }])).not.toMatch(/\(0\)/);
  });

  it("diffReport() lists a route ADDED after the before snapshot, not just the intersection", () => {
    const before = { routes: { executive: { 1280: same } } };
    const after = { routes: { executive: { 1280: same }, sast: { 1280: same } } };
    const rows = diffReport(before, after, "1280");
    expect(rows.map((r) => r.route)).toEqual(["executive", "sast"]);
    expect(rows.find((r) => r.route === "sast").diff.words.before).toBeNull();
  });
});

// ============================================================================================
//  overflowSummary — honest about a viewport with nothing wrong, and names the ones that are
// ============================================================================================

describe("overflowSummary()", () => {
  it("says so explicitly when nothing exceeds the viewport", () => {
    expect(overflowSummary([{ route: "a", scrollWidth: 640 }], 640)).toBe("no route exceeds 640px");
  });

  it("names every route that overflows, with its own scrollWidth", () => {
    const rows = [{ route: "secrets", scrollWidth: 416 }, { route: "repos", scrollWidth: 360 }];
    const out = overflowSummary(rows, 360);
    expect(out).toMatch(/1 route\(s\) exceed 360px/);
    expect(out).toMatch(/secrets \(416px\)/);
    expect(out).not.toMatch(/repos/);
  });
});
