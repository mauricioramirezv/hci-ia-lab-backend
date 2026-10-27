import type { WorkspaceAccessPort } from '../application/use-cases.js';
import { CommunityError } from '../application/use-cases.js';

export class LearningWorkspaceHttpClient implements WorkspaceAccessPort {
  constructor(private readonly baseUrl: string, private readonly serviceToken?: string) {}
  async ownsWorkspace(accountId: string, workspaceId: string) {
    if (!this.serviceToken) throw new CommunityError('DEPENDENCY_UNAVAILABLE');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/v1/workspaces/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-identity-internal-token': this.serviceToken },
        body: JSON.stringify({ accountId, workspaceId }),
        signal: AbortSignal.timeout(1500),
      });
    } catch { throw new CommunityError('DEPENDENCY_UNAVAILABLE'); }
    if (!response.ok) throw new CommunityError('DEPENDENCY_UNAVAILABLE');
    const data = await response.json() as { allowed?: boolean };
    if (typeof data.allowed !== 'boolean') throw new CommunityError('DEPENDENCY_UNAVAILABLE');
    return data.allowed;
  }
}
