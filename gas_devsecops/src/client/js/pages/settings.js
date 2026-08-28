// Settings — one real section so far, and three named honestly.
//
// NO TAB BAR YET, deliberately. `ui/settings.js` has `tabList` ready and the composition this
// page was drafted against is four tabs over one save bar — but a tab list with one working
// tab and three placeholders is worse than none: it invites a click that leads nowhere, and it
// dresses an unbuilt page as a built one. The tabs arrive when there are two real ones.
//
// Access is first because it is the section with no workaround. Severities, SLA targets and
// the project id are all reachable through the settings store; the allowlist was only ever
// editable by hand in the Apps Script editor's Script Properties, which is not a thing an
// owner should have to do to admit a colleague.

import { clear, el } from "../ui.js";
import { heroStat, pageHeader } from "../ui/controls.js";
import { errorState, skeletonStack } from "../ui/feedback.js";
import { renderAccessPanel } from "./accessEditor.js";

/** What the other three sections will hold, said plainly rather than drawn as empty controls. */
const PENDING = [
  "Register: which scopes to collect (sca, sast, secrets), which severities to request, "
  + "the Wiz project id.",
  "Deadlines: SLA targets by severity.",
  "System: credentials, schedule, deployment diagnostic.",
];

export function renderSettings(host) {
  // The header is drawn AFTER the panel resolves, because the figure it states — how many
  // people can open this dashboard — is the thing the one built section is about, and
  // heroStat's slot is for a number rather than a restatement of the panel's own heading.
  const head = el("div", {});
  const slot = el("section", { class: "card" }, skeletonStack(3));
  host.append(head, slot);

  renderAccessPanel()
    .then(({ panel, roster }) => {
      head.append(pageHeader({
        hero: roster
          ? heroStat("Settings", String(roster.people),
              `${roster.people === 1 ? "person" : "people"} can open this dashboard`
              + (roster.admins ? `, ${roster.admins} of them able to admit others` : ""))
          : heroStat("Settings", "Access",
              "Who can open this dashboard, and who can change that list."),
      }));
      slot.replaceWith(panel ?? el("section", { class: "card" },
        el("p", { class: "muted" },
          "You can open this dashboard, but not change who else can. Ask the owner or an "
          + "admin.")));

      host.append(el("section", { class: "card" },
        el("h2", { class: "section-label" }, "Not built yet"),
        el("ul", { class: "stub-list" }, ...PENDING.map((line) => el("li", {}, line))),
        el("p", { class: "stub-note" },
          "Until these land, the severity gate and SLA targets come from their defaults "
          + "(src/domain/config.ts) and the Wiz credentials from Script Properties.")));
    })
    .catch((err) => {
      clear(host);
      host.append(errorState(String(err && err.message ? err.message : err)));
    });
}
