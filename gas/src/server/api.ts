// google.script.run API surface. Every endpoint returns {ok, data} | {ok:false, error}
// so the client wrapper can promisify uniformly. Implementations land in Phases 2-6.

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function notImplemented(name: string): ApiResult {
  return { ok: false, error: `${name}: not yet implemented` };
}

export function bootstrap(_p?: unknown): ApiResult { return notImplemented("bootstrap"); }
export function getFindings(_p?: unknown): ApiResult { return notImplemented("getFindings"); }
export function getFindingDetail(_p?: unknown): ApiResult { return notImplemented("getFindingDetail"); }
export function getMttr(_p?: unknown): ApiResult { return notImplemented("getMttr"); }
export function getMttrTrend(_p?: unknown): ApiResult { return notImplemented("getMttrTrend"); }
export function getScanHistory(_p?: unknown): ApiResult { return notImplemented("getScanHistory"); }
export function getBaseRows(_p?: unknown): ApiResult { return notImplemented("getBaseRows"); }
export function runScan(_p?: unknown): ApiResult { return notImplemented("runScan"); }
export function getJobStatus(_p?: unknown): ApiResult { return notImplemented("getJobStatus"); }
export function deleteScans(_p?: unknown): ApiResult { return notImplemented("deleteScans"); }
export function getReport(_p?: unknown): ApiResult { return notImplemented("getReport"); }
export function getExportCsv(_p?: unknown): ApiResult { return notImplemented("getExportCsv"); }
export function getExportRawUrl(_p?: unknown): ApiResult { return notImplemented("getExportRawUrl"); }
export function getSettings(_p?: unknown): ApiResult { return notImplemented("getSettings"); }
export function setSeverities(_p?: unknown): ApiResult { return notImplemented("setSeverities"); }
export function setRetention(_p?: unknown): ApiResult { return notImplemented("setRetention"); }
export function setAutoCompact(_p?: unknown): ApiResult { return notImplemented("setAutoCompact"); }
export function getDomains(_p?: unknown): ApiResult { return notImplemented("getDomains"); }
export function saveDomains(_p?: unknown): ApiResult { return notImplemented("saveDomains"); }
export function previewDomains(_p?: unknown): ApiResult { return notImplemented("previewDomains"); }
export function compact(_p?: unknown): ApiResult { return notImplemented("compact"); }
export function getStorageStats(_p?: unknown): ApiResult { return notImplemented("getStorageStats"); }
