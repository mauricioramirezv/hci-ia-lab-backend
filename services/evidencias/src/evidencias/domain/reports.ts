import type { ReportSelection } from './evidence.js';
export type ReportStatus = 'pending' | 'partial' | 'ready' | 'failed';
export type ReportRecordSnapshot = { source: string; id: string; version: string | number; activityVersion?: unknown; instrumentVersion?: unknown; formulaVersion?: unknown; data: Record<string, unknown> };
export type ReportSnapshot = { records: Array<ReportRecordSnapshot & { section: ReportSelection['section'] }>; missingSources: string[]; missingRecords: Array<{ source: string; id: string }>; capturedAt: string };
export type ReportDefinition = { id: string; ownerId: string; workspaceId: string; projectName?: string; objective?: string; method?: string; interpretation?: string; improvements?: string; limitations?: string; conclusions?: string; references?: string; includeComparison: boolean; justification?: string; format: string; records: ReportSelection[]; status: ReportStatus; snapshotVersion: number; snapshot: ReportSnapshot | null; missingSources: string[]; lastError: string | null; generatedAt: string | null; stale: boolean };
export class ReportError extends Error { constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'DEPENDENCY_UNAVAILABLE' | 'SNAPSHOT_NOT_READY' | 'FORMAT_UNSUPPORTED' | 'IDEMPOTENCY_KEY_REUSED') { super(code); this.name='ReportError'; } }
const csv = (value: unknown) => { let text=typeof value==='string'?value:JSON.stringify(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text="'"+text; return '"'+text.replace(/"/g,'""')+'"'; };
export function exportReport(report: ReportDefinition, format: string) {
  if (!report.snapshot || report.snapshotVersion<1) throw new ReportError('SNAPSHOT_NOT_READY');
  if (format==='json') return { mime:'application/json; charset=utf-8',extension:'json',body:JSON.stringify(report,null,2) };
  if (format==='csv') return { mime:'text/csv; charset=utf-8',extension:'csv',body:[['report_id','snapshot_version','status','section','source','id','record_version','activity_version','instrument_version','formula_version','data','missing_sources'].map(csv).join(','), ...report.snapshot.records.map(record=>[report.id,report.snapshotVersion,report.status,record.section,record.source,record.id,record.version,record.activityVersion,record.instrumentVersion,record.formulaVersion,record.data,report.missingSources].map(csv).join(','))].join('\r\n') };
  if (format==='markdown') {
    const safe=(value:unknown)=>String(value??'').replace(/[<>]/g,value=>value==='<'?'&lt;':'&gt;').replace(/`/g,'\\`');
    return { mime:'text/markdown; charset=utf-8',extension:'md',body:[`# ${safe(report.projectName || 'HCI Lab + IA')}`,`Snapshot: ${report.snapshotVersion}; status: ${report.status}`,`Missing sources: ${report.missingSources.map(safe).join(', ') || '[]'}`,...['objective','method','interpretation','improvements','limitations','conclusions','references','justification'].flatMap(key=>[`## ${key}`,safe(report[key as keyof ReportDefinition])]),...report.snapshot.records.flatMap(record=>[`## ${safe(record.section)} / ${safe(record.source)} / ${safe(record.id)}`,`Version: ${safe(record.version)}; activity: ${safe(JSON.stringify(record.activityVersion))}; instrument: ${safe(JSON.stringify(record.instrumentVersion))}; formula: ${safe(record.formulaVersion)}`,safe(JSON.stringify(record.data,null,2))])].join('\n\n') };
  }
  throw new ReportError('FORMAT_UNSUPPORTED');
}
