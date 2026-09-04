// Debouncing, and the teardown hook that makes it safe.
//
// Six hand-rolled `clearTimeout` + `setTimeout` pairs existed across the client — the two
// search boxes, the combos issue filter, the AARS preview and sandbox, and the combobox.
// Only the combobox cancelled its timer when it went away. The other five left a pending
// callback that fired into a page whose DOM `route()` had already discarded: harmless when
// the callback only wrote to a detached node, an RPC and a repaint against the wrong page
// when it did more.
//
// So `debounce` returns a canceller AND registers it, and `route()` runs the registrations
// before it clears main. A page opts out of the bug by using the helper.

/** Cancels registered by the current page, run and dropped on the next navigation. */
let pageCleanups = [];

/**
 * Register work to undo when this page is torn down. Pages rarely call this directly —
 * `debounce` does it for them.
 */
export function onPageTeardown(fn) {
  pageCleanups.push(fn);
}

/** Run and clear every registration. Called by route() immediately before clearing main. */
export function runPageTeardown() {
  const fns = pageCleanups;
  pageCleanups = [];
  for (const fn of fns) {
    try {
      fn();
    } catch (e) {
      // A cleanup that throws must not stop the others or block the navigation.
      console.warn("page teardown failed:", e);
    }
  }
}

/**
 * Call `fn` once the caller has stopped calling for `ms`.
 *
 * The returned function carries `.cancel()`, and is registered for page teardown unless
 * `pageScoped: false` — which the combobox passes, because it manages its own lifetime and
 * outlives no page.
 */
export function debounce(fn, ms, { pageScoped = true } = {}) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  wrapped.pending = () => timer !== null;
  if (pageScoped) onPageTeardown(wrapped.cancel);
  return wrapped;
}
