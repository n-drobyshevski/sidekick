// One execution-log line per request stage, in the `{"stage": …}` shape every timing line in
// this app shares (sheetsDb "sheet", archiveStore "drive", serverCache "cache", …) so a page's
// cost can be read off its own Executions transcript.

/**
 * Consecutive laps of one request, logged as a single `{"stage": <stage>, <lap>: ms, …}` line.
 * Laps rather than a wrapper around each block so the timed code keeps its shape: each
 * `lap(label)` records the time since the previous one (or since creation).
 */
export function stageLaps(stage: string): { lap: (label: string) => void; log: () => void } {
  let t = Date.now();
  const ms: Record<string, number> = {};
  return {
    lap(label) {
      const now = Date.now();
      ms[label] = now - t;
      t = now;
    },
    log() {
      console.log(JSON.stringify({ stage, ...ms }));
    },
  };
}
