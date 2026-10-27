import type { CommunityAccessPort } from '../application/use-cases.js';
import { EvidenceError } from '../application/use-cases.js';

export class CommunityAccessHttpClient implements CommunityAccessPort {
  constructor(private readonly baseUrl: string, private readonly token?: string) {}
  async ownsReservations(accountId: string, workspaceId: string, reservationIds: string[]) {
    if (!reservationIds.length) return true;
    if (!this.token) throw new EvidenceError('DEPENDENCY_UNAVAILABLE');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/v1/reservations/authorize`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-identity-internal-token': this.token }, body: JSON.stringify({ accountId, workspaceId, reservationIds }), signal: AbortSignal.timeout(1500) });
    } catch { throw new EvidenceError('DEPENDENCY_UNAVAILABLE'); }
    if (!response.ok) throw new EvidenceError('DEPENDENCY_UNAVAILABLE');
    const result = await response.json() as { allowed?: boolean };
    return result.allowed === true;
  }
}
