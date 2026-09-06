# Wiz Sidekick — the hub

A launcher for the three sidekick web apps, as a Google Apps Script web app of its own.
Sibling to the OS-vulnerabilities tool in [`../gas/`](../gas/), the AI-asset tool in
[`../gas_ai/`](../gas_ai/) and the code-side tool in [`../gas_devsecops/`](../gas_devsecops/).

Each of those three is deployed separately, with its own `/exec` URL, and nothing linked them:
a reader with one bookmark had one register. This app is one page — a 2×2 grid of large
coloured tiles — whose whole job is to open the right one.

Same chassis as all three (`gas_shared/` component base, the same shell, the same token
contract, the same test contracts), with a **graphite `#0a0a0a`** brand rather than a fourth
saturated hue: the hub belongs to no register, so it wears the neutral every sibling's primary
button already does instead of borrowing one register's colour. The severity palette ships
identical to the other three, as it does everywhere — even though this app draws no severity.

## Status: built, never deployed

Everything below the deploy step is real and tested. Nothing has ever run inside Apps Script:
there is no `.clasp.json` in this repo (the `scriptId` belongs to whoever deploys), so the
Setup section is untested in that sense, and one behaviour **cannot** be tested outside a real
deployment — see "The one thing only a deployment can prove" below.

## What this app deliberately does not have

Every absence here is a decision, written down so it is not read as an unfinished port. All of
them are asserted by tests rather than left to prose — `test/entryPoints.test.js` for the
entry points, `test/shared.test.js` for the contracts, `test/manifestScopes.test.js` for the
scopes.

- **No welcome gate.** The registers run a "signed in as X — Continue" interstitial before
  they draw. This app's whole purpose is to send a reader onward to one of them, so a gate here
  would put two interstitials in one journey to answer the same question twice.
  `src/server/welcome.ts` is not forked into this project at all, so there is nothing to
  re-enable by accident. A refused visitor still gets the identity story: `deniedPage()` names
  the account it actually saw and offers the account chooser.
- **No scan, no sync, no ledger, no spreadsheet, no Drive folder.** It reads no register's
  data. There is no `sheetsDb`, no `ledgerStore`, no job runner, no `serverCache` — and no
  `setup()` to provision any of it, because its entire state is five Script Properties an
  operator sets by hand.
- **No triggers.** Nothing runs on a schedule. A trigger handler is the one entry point whose
  failure is completely silent (it runs with no user, no page and nobody waiting), so "there
  are none" is worth stating rather than assuming; `test/entryPoints.test.js` fails if one
  appears, which is where the argument for it would have to be made.
- **No charts.** `src/client/js/charts.js` is four lines: a single `ACCENT` constant the shared
  token contract reads. There is no chart bundle and no `js_charts.html` partial.
- **No help route.** This app defines no vocabulary of its own — its copy is four tile
  headlines and three scope lines, every word of which names a *sibling's* register — so a
  glossary here would be a second place for another app's terms to drift. `findHelpEntry`
  answers `null`, and the shared `help.js` contract is deliberately not registered.
- **No scope dimension.** It measures no population, so there is nothing for a scope control to
  narrow. `createAppShell` is called with `pages` alone: no `appbarScope`, no `railFooter`, no
  `navContext`.
- **No `mutate()` and no script lock.** There is no multi-row write to serialize, and a lock
  wrapper nobody needs is one somebody will later assume is doing something. `api.ts` mints one
  error kind, `"error"`, for the same reason.
- **No table, no pager, no first-run notice.** One page of four tiles and one settings form.
- **Two OAuth scopes and no third.** `script.scriptapp` (the account chooser a refused visitor
  is offered) and `userinfo.email` (the identity every access check rests on). In particular
  there is **no "test this URL" button** on the Settings panel: it would drag
  `script.external_request` into a launcher that fetches nothing.
  `test/manifestScopes.test.js` demands the scope the moment `UrlFetchApp.` appears in the
  bundle, which is the right place for that argument to happen.

## Setup

1. `npm install`
2. `clasp login`, then `clasp create --type webapp --rootDir dist` (`.clasp.json` is
   git-ignored — the `scriptId` belongs to whoever deploys, not to the repo).
3. `npm run push` — this runs `npm run check:exact` first and refuses to push a red tree.
4. **The easy step to miss: paste the three sibling URLs.** In Project Settings → Script
   Properties, set

   | property | value |
   |---|---|
   | `URL_OS` | the OS Patching sidekick's `/exec` URL |
   | `URL_AI` | the AI sidekick's `/exec` URL |
   | `URL_DEVSECOPS` | the DevSecOps sidekick's `/exec` URL |

   Each comes from **that sibling's own** Apps Script project: Deploy → Manage deployments →
   the active Web app deployment → copy the URL. **The `/exec` form, never `/dev`** — the
   `/dev` URL only works for someone with edit access to that project and is not a link you
   can hand a reader.

   These cannot be derived. `ScriptApp.getService().getUrl()` answers for the deployment it is
   called in and nothing else, it has flipped between the `/dev` and `/exec` forms across Apps
   Script runtime changes, and no API hands one project another project's web-app URL. So they
   are pasted, once — and `src/server/urls.ts` is the one place that reads, writes and vets
   them.

   **A blank or missing property is legal** and means "not configured": that tile keeps its
   register's colour and headline and says the URL has not been set, rather than rendering as a
   link to nowhere. A hub with one sibling deployed is a normal state.

   The same three can be edited later from **Settings → Sidekick URLs** in the app itself, by
   the owner or an admin, without touching Project Settings or redeploying.

5. Optionally set `ALLOWED_USERS` and `ALLOWED_ADMINS` (comma/semicolon/newline-separated
   addresses). Access fails **closed**: an unset `ALLOWED_USERS` means owner-only, and the
   owner is allowed by identity rather than by membership. Admins may edit the people list and
   the sidekick URLs; only the owner may edit the admins list — an admin who could promote
   admins is not a second tier.
6. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone within
   \<your domain\>*. Accept the two-scope consent prompt.
7. Open the `/exec` URL and click each tile.

### The one thing only a deployment can prove

The tiles must open the sibling **in the same tab**, not inside a blank
`googleusercontent.com` frame. HtmlService's iframe sandbox does not grant
`allow-top-navigation`, so a JS `location = url` fails silently; only a real `<a href>` is
rescued by the `<base target="_top">` the shared page template already carries — and only if
the anchor sets **no `target` of its own**. `gas_shared/shell/navRail.js` sets
`target="_self"` on the rail's *internal* hash links precisely so those stay in the sandbox;
copying that convention onto an outbound tile link traps the navigation and renders a blank
frame. `src/client/js/ui/tile.js` says so above the anchor. This behaviour exists only inside
the real sandbox and cannot be reproduced locally.

## Development

```
npm run dev          # http://localhost:8790, rebuilds on every page load
npm run check        # typecheck + lint + test + check-dist-fresh
npm run check:exact  # the same, with every test file fully isolated
npm run build        # writes dist/ (entry.js and appsscript.json are hand-maintained)
```

Dev-harness query flags: `?unset` renders every tile as not-configured, `?unset=ai` (or
`?unset=os,devsecops`) does a subset, `?slow=<ms>` adds artificial RPC latency so the loading
states are exercisable.

### Running everything locally

The hub is only interesting beside the apps it opens, so the four dev harnesses take a port
each. Four terminals:

```
cd gas            && npm run dev              # http://localhost:8787
cd gas_ai         && PORT=8788 npm run dev    # http://localhost:8788
cd gas_devsecops  && PORT=8789 npm run dev    # http://localhost:8789
cd gas_hub        && npm run dev              # http://localhost:8790
```

Then open <http://localhost:8790/>. `dev/boot.js` seeds the three URL properties to exactly
those addresses, so the tiles are real links to the real local apps — click one and you land in
that sibling's harness. **Each sibling needs its own `npm install` first**; none of them shares
this package's `node_modules`.

`http://localhost:<port>/` is a legal sidekick URL for this reason, alongside the deployed
`https://script.google.com/` form — so Settings → Sidekick URLs can repoint a tile at a
different local port without restarting anything. In a real deployment a localhost URL is a
visible misconfiguration (the tile points somewhere only the person who set it can reach)
rather than a hole; `javascript:`, `http:` to any other host, protocol-relative `//…` and
scheme-less strings all stay refused, on both the server boundary and the Settings field. The
one rule is stated twice on purpose — `src/server/urls.ts` is the boundary, and
`src/client/js/pages/urlsModel.js` is the field message — and both are pinned by one case table
in `test/urlCases.ts`.

## Layout

```
src/server/     main, access, api, urls, props, buildInfo, pageShell, index — no ledger, no jobs
src/domain/     config.ts only: the six severity fills, byte-identical to all three registers
src/client/js/  app.js (manifest + 2-route PAGES), pages/, ui/tile.js, routeIcons, charts stub
src/client/styles/  tokens.css (graphite + the tile vocabulary) and pages.css (the grid)
dist/           entry.js and appsscript.json are HAND-MAINTAINED; the rest is built and tracked
dev/            serve.mjs, gas-shims.js, boot.js — the local harness
test/           9 files; test/shared.test.js registers ten of the twelve shared contracts
```

`dist/` is committed on purpose (it is what `clasp push` uploads), and
`npm run check-dist-fresh` rebuilds it and diffs the result against `HEAD` — a `gas_shared/`
change that never triggered a rebuild here is exactly the defect it exists to catch, and it has
bitten this repo twice.
