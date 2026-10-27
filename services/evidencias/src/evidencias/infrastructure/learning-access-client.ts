import type { LearningAccessPort, LearningReportIds } from '../application/use-cases.js';
import { EvidenceError } from '../application/use-cases.js';

export class LearningAccessHttpClient implements LearningAccessPort {
  constructor(private readonly baseUrl: string, private readonly token?: string) {}
  private async call(path: string, body: unknown): Promise<boolean> {
    if (!this.token) throw new EvidenceError('DEPENDENCY_UNAVAILABLE');
    let response: Response;
    try { response = await fetch(this.baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-identity-internal-token': this.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) }); }
    catch { throw new EvidenceError('DEPENDENCY_UNAVAILABLE'); }
    if (!response.ok) throw new EvidenceError('DEPENDENCY_UNAVAILABLE');
    const result = await response.json() as { allowed?: boolean };
    return result.allowed === true;
  }
  ownsExecution(accountId: string, executionId: string) { return this.call('/internal/v1/executions/owner-check', { accountId, executionId }); }
  ownsWorkspace(accountId: string, workspaceId: string) { return this.call('/internal/v1/workspaces/authorize', { accountId, workspaceId }); }
  ownsExecutions(accountId: string, workspaceId: string, executionIds: string[]) { return this.call('/internal/v1/executions/authorize', { accountId, workspaceId, executionIds }); }
  ownsReportRecords(accountId: string, workspaceId: string, records: LearningReportIds) { return this.call('/internal/v1/report-records/authorize', { accountId, workspaceId, records }); }
}
