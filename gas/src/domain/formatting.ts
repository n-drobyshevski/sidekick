// Human-friendly duration and size formatting — the port of domain/formatting.py.

export function formatBytes(n: number | null | undefined): string {
  let v = n === null || n === undefined ? 0 : Math.max(0, Number(n));
  for (const unit of ["B", "KB", "MB", "GB"] as const) {
    if (v < 1024 || unit === "GB") {
      return unit === "B" ? `${Math.trunc(v)} ${unit}` : `${v.toFixed(1)} ${unit}`;
    }
    v /= 1024;
  }
  return `${v.toFixed(1)} GB`;
}

export function formatDuration(days: number | null | undefined): string {
  if (days === null || days === undefined || Number.isNaN(days)) return "—";
  if (days < 1 / 24) return "<1h";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${days.toFixed(1)}d`;
  if (days < 365) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
