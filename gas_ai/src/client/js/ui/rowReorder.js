// Dragging a cascade row to a new position — the enhancement, never the mechanism.
//
// Order IS the semantics of a first-match cascade, and all three of this app's cascades
// expressed it with two link-styled arrows in the last column. This adds a grip, and
// nothing else: the `↑ ↓` buttons stay exactly where they were and keep doing the work.
//
// THAT SPLIT IS THE POINT, NOT A CONCESSION. WCAG 2.5.7 requires a single-pointer
// alternative to any dragging movement, so the arrows have to exist regardless — and once
// they do, the honest arrangement is arrows as the control and drag as the shortcut. Hence
// a grip that is `aria-hidden` and out of the tab order: a keyboard or screen-reader user
// is not offered a handle they would then have to operate, they are offered the two buttons
// that already work. `onReorder` is the same splice the arrows call, so there is one
// reorder path, not two that can drift.
//
// WHY `draggable` IS ARMED ON POINTERDOWN AND DISARMED AFTERWARDS. A cascade row is full of
// `<select>`s and text inputs. A row marked `draggable` permanently swallows the drags that
// belong to them — you cannot select the text in a code field, and on some engines opening
// a select becomes a row drag. Arming the attribute only while the pointer is actually on
// the grip scopes the gesture to the grip without giving up native HTML5 drag, which is the
// only drag this app has to ship: no library, no pointer-move bookkeeping, and the browser
// draws the drag image for free.

import { el } from "./dom.js";
import { uiIcon } from "./uiIcons.js";

/**
 * The handle. Decorative by construction — `aria-hidden` and out of the tab order — because
 * the row's reorder buttons are the accessible path, and announcing a second one would only
 * offer assistive tech a gesture it cannot perform.
 */
export function ruleGrip() {
  const grip = el("span", {
    class: "rule-grip",
    "aria-hidden": "true",
    title: "Drag to reorder",
  });
  grip.append(uiIcon("grip", 14));
  return grip;
}

/**
 * Wire one cascade body for drag reordering. Delegated, and called ONCE per table: the rows
 * themselves are rebuilt on every structural change, so per-row listeners would be
 * re-attached (and leak) on every add, remove and move.
 *
 * `onReorder(from, to)` gets indices into the draft's own row array — `to` is already the
 * post-removal index, so the callee is the same two-line splice `move(delta)` does, and
 * owns the re-render and the focus exactly as it already did. A drop that would not move
 * anything never calls it.
 *
 * Returns a dispose function for the one listener that cannot live on the table: a pointer
 * released outside it still has to disarm the row.
 */
export function rowDrag(body, onReorder) {
  let fromIdx = null;

  /** The `tr` an event landed in, if it is a reorderable rule row of THIS table. */
  function rowOf(target) {
    const tr = target && target.closest ? target.closest("tr[data-idx]") : null;
    return tr && body.contains(tr) ? tr : null;
  }

  function disarm() {
    body.querySelectorAll("tr[draggable]").forEach((tr) => { tr.draggable = false; });
  }

  function clearMarks() {
    body.querySelectorAll(".rule-dragging, .rule-drop-before, .rule-drop-after")
      .forEach((tr) => tr.classList.remove("rule-dragging", "rule-drop-before", "rule-drop-after"));
  }

  body.addEventListener("pointerdown", (e) => {
    const tr = rowOf(e.target);
    if (!tr) return;
    tr.draggable = !!(e.target.closest && e.target.closest(".rule-grip"));
  });
  // A press on the grip that never became a drag must not leave the row draggable, and the
  // release can land anywhere — hence the document, and hence the returned dispose.
  const onPointerUp = () => disarm();
  document.addEventListener("pointerup", onPointerUp);

  body.addEventListener("dragstart", (e) => {
    const tr = rowOf(e.target);
    if (!tr || !tr.draggable) return;
    fromIdx = Number(tr.dataset.idx);
    tr.classList.add("rule-dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // Firefox starts no drag at all without a payload. The index rides along rather than
      // being read back out — `fromIdx` above is the authority within this document.
      e.dataTransfer.setData("text/plain", String(fromIdx));
    }
  });

  body.addEventListener("dragover", (e) => {
    if (fromIdx === null) return;
    const tr = rowOf(e.target);
    if (!tr) return;
    e.preventDefault(); // without this, no drop event ever fires
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const box = tr.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    body.querySelectorAll(".rule-drop-before, .rule-drop-after")
      .forEach((n) => n.classList.remove("rule-drop-before", "rule-drop-after"));
    tr.classList.add(after ? "rule-drop-after" : "rule-drop-before");
  });

  body.addEventListener("drop", (e) => {
    if (fromIdx === null) return;
    e.preventDefault();
    const tr = rowOf(e.target);
    const from = fromIdx;
    fromIdx = null;
    clearMarks();
    disarm();
    if (!tr) return;
    const over = Number(tr.dataset.idx);
    const box = tr.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    // `insertAt` is where the row goes in the array AS IT STANDS; splicing the dragged row
    // out first shifts everything below it up by one, so a target below the source loses
    // one. Doing that arithmetic here rather than in three call sites is the whole reason
    // `to` is passed post-removal.
    const insertAt = after ? over + 1 : over;
    const to = insertAt > from ? insertAt - 1 : insertAt;
    if (to !== from) onReorder(from, to);
  });

  body.addEventListener("dragend", () => {
    fromIdx = null;
    clearMarks();
    disarm();
  });

  return () => document.removeEventListener("pointerup", onPointerUp);
}
