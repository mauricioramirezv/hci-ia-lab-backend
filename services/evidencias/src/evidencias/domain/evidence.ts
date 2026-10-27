export const consentPurposes = ['aggregate_metrics', 'detailed_telemetry', 'calibration'] as const;
export type ConsentPurpose = typeof consentPurposes[number];
export type UxEvent = {
  channel: 'click' | 'pointer' | 'gaze' | 'simulation' | 'scroll' | 'wheel' | 'mode';
  atMs: number; x?: number; y?: number; weight?: number; area?: string; route?: string;
  scrollTopPx?: number; depthPercent?: number; direction?: string; mode?: 'cursor' | 'F' | 'Gutenberg' | 'none';
  source: 'measured' | 'simulated' | 'mixed';
};
export type CalibrationInput = { medianErrorPx: number; viewportWidth: number; viewportHeight: number; sampleCount: number; validatedAt: string };
export const accessibilityCodes = ['keyboard', 'labels', 'contrast', 'zoom', 'screenReader', 'motion'] as const;
export type AccessibilityCode = typeof accessibilityCodes[number];
export const reportSources = ['execution','persona','scenario','reservation','finding','evaluation_session','ux_session','evidence','demo_user','multimodal_evidence','lab_event','accessibility_check'] as const;
export type ReportSource = typeof reportSources[number];
export type ReportSelection = { section: 'selected' | 'before' | 'after'; source: ReportSource; id: string };
export type UxExposure = { band: string; seconds: number };
export type EvidenceMetadataInput = { executionId: string; name: string; mime: string; bytes: number; sha256: string; location: string };

export function isConsentPurpose(value: string): value is ConsentPurpose { return (consentPurposes as readonly string[]).includes(value); }
export function isAccessibilityCode(value: string): value is AccessibilityCode { return (accessibilityCodes as readonly string[]).includes(value); }
export function isReportSource(value: string): value is ReportSource { return (reportSources as readonly string[]).includes(value); }
export function isValidUxEvent(event: UxEvent) {
  return ['click','pointer','gaze','simulation','scroll','wheel','mode'].includes(event.channel) && Number.isSafeInteger(event.atMs) && event.atMs >= 0 && ['measured','simulated','mixed'].includes(event.source) &&
    [event.x,event.y,event.weight,event.scrollTopPx,event.depthPercent].every(value => value === undefined || Number.isFinite(value)) && (event.scrollTopPx === undefined || event.scrollTopPx >= 0) && (event.depthPercent === undefined || (event.depthPercent >= 0 && event.depthPercent <= 100)) &&
    (event.area === undefined || event.area.length <= 120) && (event.route === undefined || (event.route.length <= 500 && !event.route.startsWith('//'))) && (event.direction === undefined || event.direction.length <= 40);
}
export function isVideoFile(name: string, mime: string) { return mime.toLowerCase().startsWith('video/') || /\.(mp4|mov|webm|avi|mkv)$/i.test(name); }
export function isSafeStorageLocation(location: string, accountId: string, executionId: string) {
  return location.startsWith(`${accountId}/${executionId}/`) && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/.test(location) && !location.includes('..') && !location.includes('//') && !location.includes('\\');
}
