// Open portaled popovers — controls that mount on <body> so a scrolling panel cannot clip
// them (today: the combobox listbox).
//
// A sheet's focus trap stands down while any is open: their rows are outside the sheet
// subtree by design, and the branch that pulls stray focus back in would otherwise yank
// Tab out of the list being navigated. The popover runs its own Escape and outside-click
// dismissal, so nothing is left untrapped.
//
// This lives in its own module because it is the one piece of state the sheet and the
// combobox genuinely share; when they were in one file it was a bare `let`.

let openPortals = 0;

export function portalOpened() {
  openPortals += 1;
}

export function portalClosed() {
  openPortals = Math.max(0, openPortals - 1);
}

export function portalsOpen() {
  return openPortals;
}
