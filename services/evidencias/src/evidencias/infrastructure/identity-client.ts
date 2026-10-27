import type { Principal, SessionPort } from '../application/session.js';
import { IdentityUnavailable } from '../application/session.js';

export class IdentityHttpClient implements SessionPort {
  constructor(private readonly baseUrl: string, private readonly internalToken?: string) {}

  async resolve(sessionToken: string, csrfToken?: string): Promise<Principal | null> {
    if (!this.internalToken) throw new IdentityUnavailable();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/v1/sessions/introspect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-identity-internal-token': this.internalToken },
        body: JSON.stringify({ sessionToken, ...(csrfToken ? { csrfToken } : {}) }),
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      throw new IdentityUnavailable();
    }
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new IdentityUnavailable();
    const payload = await response.json() as { principal?: Principal };
    const principal = payload.principal;
    if (!principal || !/^[0-9a-f-]{36}$/i.test(principal.id) || principal.status !== 'active' || !Array.isArray(principal.globalRoles) || !Array.isArray(principal.permissions)) return null;
    return principal;
  }
}


