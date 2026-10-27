export type Principal = {
  id: string;
  email: string;
  globalRoles: string[];
  permissions: string[];
  status: 'active';
};

export interface SessionPort {
  resolve(sessionToken: string, csrfToken?: string): Promise<Principal | null>;
  isAccountActive?(accountId: string): Promise<boolean>;
}

export class IdentityUnavailable extends Error {
  constructor() { super('DEPENDENCY_UNAVAILABLE'); this.name = 'IdentityUnavailable'; }
}

