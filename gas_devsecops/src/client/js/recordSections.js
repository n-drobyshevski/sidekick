// Record-sheet geometry. The AI sibling also builds per-kind section lists here; this
// register's sheets are built by their own pages, so only the two DOM-free helpers the
// shared sheet needs survive the fork — which is why they were written DOM-free.

/**
 * Prev/next/position for stepping through a record list (an inventory row, an issue table
 * row, ...) one detail sheet at a time. "index" is 0-based; "position" is 1-based and 0
 * when the cursor does not land on a real row at all.
 */
export function recordCursor(ids, index) {
  var list = ids || [];
  var total = list.length;
  var i = Number(index);
  var valid = total > 0 && Number.isFinite(i) && i >= 0 && i < total;
  if (!valid) {
    return { prevId: null, nextId: null, position: 0, total: total };
  }
  return {
    prevId: i > 0 ? list[i - 1] : null,
    nextId: i < total - 1 ? list[i + 1] : null,
    position: i + 1,
    total: total,
  };
}

/**
 * The resize floor/ceiling for the detail sheet's draggable width, clamped to an integer
 * pixel count. The floor is applied before the ceiling, so on a viewport too narrow for
 * minPx to fit under maxVwPct — where the ceiling comes out below the floor — that same
 * ordering makes the ceiling win rather than forcing a width the viewport can't hold.
 */
export function clampSheetWidth(px, minPx, maxVwPct, viewportW) {
  var floor = Number(minPx);
  if (!Number.isFinite(floor)) floor = 0;
  var p = Number(px);
  var vw = Number(viewportW);
  var pct = Number(maxVwPct);
  if (!Number.isFinite(p) || !Number.isFinite(vw) || !Number.isFinite(pct)) {
    return Math.round(floor);
  }
  var ceiling = (vw * pct) / 100;
  if (!Number.isFinite(ceiling)) return Math.round(floor);
  return Math.round(Math.min(ceiling, Math.max(floor, p)));
}
