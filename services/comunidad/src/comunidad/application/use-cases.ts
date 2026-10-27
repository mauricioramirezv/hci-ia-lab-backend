import { canTransitionSuggestion, reservationValidation, uuidPattern, type ReservationInput, type SuggestionState } from '../domain/community.js';

export type CommunityErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVITATION_INVALID_OR_EXPIRED' | 'IDEMPOTENCY_KEY_REUSED' | 'RESERVATION_CONFLICT' | 'VERSION_CONFLICT' | 'STATE_CONFLICT' | 'DEPENDENCY_UNAVAILABLE';
export class CommunityError extends Error {
  constructor(readonly code: CommunityErrorCode) { super(code); this.name = 'CommunityError'; }
}
export type GroupSummary = { id: string; name: string; description: string | null; role: 'leader' | 'participant'; joinedAt: string | null };
export type SuggestionItem = { id: string; category: string; title: string; description: string; anonymous: boolean; authorId: string | null; status: SuggestionState; version: number; createdAt: string; updatedAt: string };
export type Page<T> = { items: T[]; total: number; limit: number; offset: number };
export type ReservationChange = Partial<Pick<ReservationInput, 'serviceCode' | 'serviceLabel' | 'date' | 'time' | 'condition'>>;
export interface WorkspaceAccessPort { ownsWorkspace(accountId: string, workspaceId: string): Promise<boolean> }
export interface CommunityRepository {
  createGroup(accountId: string, name: string, description: string | null, key: string): Promise<{ item: unknown; replayed: boolean }>;
  listGroups(accountId: string, limit: number, offset: number): Promise<Page<GroupSummary>>;
  listMembers(groupId: string, actorId: string, limit: number, offset: number): Promise<Page<unknown> | null>;
  isLeader(groupId: string, accountId: string): Promise<boolean>;
  createInvitation(groupId: string, accountId: string, email: string | null, hash: string, expiresAt: Date): Promise<{ id: string } | null>;
  listInvitations(groupId: string, actorId: string, limit: number, offset: number): Promise<Page<unknown> | null>;
  canReportWorkspace(accountId: string, workspaceId: string): Promise<boolean>;
  snapshotReservations(workspaceId: string, ids: string[]): Promise<Array<{ id: string; version: number; [key: string]: unknown }>>;
  acceptInvitation(accountId: string, email: string, hash: string): Promise<{ groupId: string; replayed: boolean } | null>;
  removeMember(groupId: string, actorId: string, accountId: string): Promise<boolean>;
  revokeInvitation(groupId: string, actorId: string, invitationId: string): Promise<boolean>;
  listSharedWorkspaces(groupId: string, actorId: string, limit: number, offset: number): Promise<Page<unknown> | null>;
  shareWorkspace(groupId: string, actorId: string, workspaceId: string): Promise<boolean>;
  revokeWorkspace(groupId: string, actorId: string, workspaceId: string): Promise<boolean>;
  createSuggestion(accountId: string, category: string, title: string, description: string, anonymous: boolean, key: string): Promise<{ item: SuggestionItem; replayed: boolean }>;
  listSuggestions(accountId: string, moderator: boolean, limit: number, offset: number): Promise<Page<SuggestionItem>>;
  getSuggestion(accountId: string, moderator: boolean, id: string): Promise<SuggestionItem | null>;
  listSuggestionHistory(accountId: string, moderator: boolean, id: string, limit: number, offset: number): Promise<Page<unknown> | null>;
  updateSuggestion(accountId: string, id: string, expectedVersion: number, status: SuggestionState, response: string | null): Promise<SuggestionItem | null>;
  listReservationServices(): Promise<unknown[]>;
  setReservationServiceActive(code: string, active: boolean): Promise<boolean>;
  listReservations(accountId: string, limit: number, offset: number): Promise<Page<unknown>>;
  reservationWorkspace(accountId: string, id: string): Promise<string | null>;
  ownsReservations(accountId: string, workspaceId: string, reservationIds: string[]): Promise<boolean>;
  createReservation(accountId: string, input: ReservationInput, key: string): Promise<{ item: unknown; replayed: boolean } | null>;
  updateReservation(accountId: string, id: string, expectedVersion: number, input: ReservationChange): Promise<unknown | null>;
  cancelReservation(accountId: string, id: string, expectedVersion: number): Promise<unknown | null>;
  membership(groupId: string, accountId: string): Promise<{ active: boolean; role: 'leader' | 'participant' | null }>;
}

const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class CommunityApplication {
  constructor(private readonly repo: CommunityRepository, private readonly workspaces: WorkspaceAccessPort) {}
  async createGroup(accountId: string, name: string, description: string | undefined, key: string) {
    const normalized = name.trim();
    if (!normalized || normalized.length > 120 || (description?.length ?? 0) > 2000 || !keyPattern.test(key)) throw new CommunityError('INVALID_INPUT');
    const result = await this.repo.createGroup(accountId, normalized, description?.trim() || null, key);
    return result;
  }
  listGroups(accountId: string, limit: number, offset: number) { return this.repo.listGroups(accountId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)); }
  async listMembers(groupId: string, accountId: string, limit: number, offset: number) {
    if (!uuidPattern.test(groupId)) throw new CommunityError('INVALID_INPUT');
    const result = await this.repo.listMembers(groupId, accountId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
    if (!result) throw new CommunityError('NOT_FOUND');
    return result;
  }
  async createInvitation(groupId: string, accountId: string, email: string | null, hash: string, expiresAt: Date) {
    if (!uuidPattern.test(groupId) || (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) || expiresAt <= new Date()) throw new CommunityError('INVALID_INPUT');
    const created = await this.repo.createInvitation(groupId, accountId, email?.trim().toLowerCase() ?? null, hash, expiresAt);
    if (!created) throw new CommunityError('FORBIDDEN');
    return created;
  }
  async listInvitations(groupId: string, actorId: string, limit: number, offset: number) {
    if (!uuidPattern.test(groupId)) throw new CommunityError('INVALID_INPUT');
    const result = await this.repo.listInvitations(groupId, actorId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
    if (!result) throw new CommunityError('FORBIDDEN');
    return result;
  }
  canReportWorkspace(accountId: string, workspaceId: string) { return this.repo.canReportWorkspace(accountId, workspaceId); }
  async snapshotReservations(accountId: string, workspaceId: string, ids: string[]) {
    if (!uuidPattern.test(accountId) || !uuidPattern.test(workspaceId) || ids.length > 100 || ids.some(id => !uuidPattern.test(id)) || new Set(ids).size !== ids.length) throw new CommunityError('INVALID_INPUT');
    let allowed: boolean;
    try { allowed = await this.workspaces.ownsWorkspace(accountId, workspaceId) || await this.repo.canReportWorkspace(accountId, workspaceId); }
    catch { throw new CommunityError('DEPENDENCY_UNAVAILABLE'); }
    if (!allowed) throw new CommunityError('NOT_FOUND');
    const rows = await this.repo.snapshotReservations(workspaceId, ids);
    return { items: rows.map(data => ({ source: 'reservation' as const, id: data.id, version: data.version, data })), missing: ids.filter(id => !rows.some(row => row.id === id)).map(id => ({ source: 'reservation' as const, id })) };
  }
  acceptInvitation(accountId: string, email: string, hash: string) { return this.repo.acceptInvitation(accountId, email.trim().toLowerCase(), hash); }
  async removeMember(groupId: string, actorId: string, accountId: string) {
    if (!uuidPattern.test(groupId) || !uuidPattern.test(accountId) || actorId === accountId) throw new CommunityError('FORBIDDEN');
    return this.repo.removeMember(groupId, actorId, accountId);
  }
  async revokeInvitation(groupId: string, actorId: string, invitationId: string) {
    if (!uuidPattern.test(groupId) || !uuidPattern.test(invitationId)) throw new CommunityError('INVALID_INPUT');
    return this.repo.revokeInvitation(groupId, actorId, invitationId);
  }
  async listSharedWorkspaces(groupId: string, accountId: string, limit: number, offset: number) {
    if (!uuidPattern.test(groupId)) throw new CommunityError('INVALID_INPUT');
    const page = await this.repo.listSharedWorkspaces(groupId, accountId, limit, offset);
    if (!page) throw new CommunityError('NOT_FOUND');
    return page;
  }
  async shareWorkspace(groupId: string, accountId: string, workspaceId: string) {
    if (!uuidPattern.test(groupId) || !uuidPattern.test(workspaceId)) throw new CommunityError('INVALID_INPUT');
    if (!await this.repo.isLeader(groupId, accountId)) throw new CommunityError('FORBIDDEN');
    let owns: boolean;
    try { owns = await this.workspaces.ownsWorkspace(accountId, workspaceId); } catch { throw new CommunityError('DEPENDENCY_UNAVAILABLE'); }
    if (!owns) throw new CommunityError('NOT_FOUND');
    const shared = await this.repo.shareWorkspace(groupId, accountId, workspaceId);
    if (!shared) throw new CommunityError('STATE_CONFLICT');
  }
  async revokeWorkspace(groupId: string, accountId: string, workspaceId: string) {
    if (!uuidPattern.test(groupId) || !uuidPattern.test(workspaceId)) throw new CommunityError('INVALID_INPUT');
    if (!await this.repo.revokeWorkspace(groupId, accountId, workspaceId)) throw new CommunityError('FORBIDDEN');
  }
  async createSuggestion(accountId: string, category: string, title: string, description: string, anonymous: boolean, key: string) {
    if (!category.trim() || category.length > 80 || !title.trim() || title.length > 160 || !description.trim() || description.length > 4000 || !keyPattern.test(key)) throw new CommunityError('INVALID_INPUT');
    return this.repo.createSuggestion(accountId, category.trim(), title.trim(), description.trim(), anonymous, key);
  }
  listSuggestions(accountId: string, moderator: boolean, limit: number, offset: number) { return this.repo.listSuggestions(accountId, moderator, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)); }
  getSuggestion(accountId: string, moderator: boolean, id: string) { if (!uuidPattern.test(id)) throw new CommunityError('INVALID_INPUT'); return this.repo.getSuggestion(accountId, moderator, id); }
  listSuggestionHistory(accountId: string, moderator: boolean, id: string, limit: number, offset: number) {
    if (!uuidPattern.test(id)) throw new CommunityError('INVALID_INPUT');
    return this.repo.listSuggestionHistory(accountId, moderator, id, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  async updateSuggestion(accountId: string, moderator: boolean, id: string, expectedVersion: number, status: SuggestionState, response?: string) {
    if (!moderator) throw new CommunityError('FORBIDDEN');
    if (!uuidPattern.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1 || (response?.length ?? 0) > 4000) throw new CommunityError('INVALID_INPUT');
    const current = await this.repo.getSuggestion(accountId, true, id);
    if (!current) throw new CommunityError('NOT_FOUND');
    if (current.version !== expectedVersion) throw new CommunityError('VERSION_CONFLICT');
    if (!canTransitionSuggestion(current.status, status)) throw new CommunityError('STATE_CONFLICT');
    const updated = await this.repo.updateSuggestion(accountId, id, expectedVersion, status, response?.trim() || null);
    if (!updated) throw new CommunityError('VERSION_CONFLICT');
    return updated;
  }
  listReservationServices() { return this.repo.listReservationServices(); }
  async setReservationServiceActive(code: string, active: boolean, moderator: boolean) {
    if (!moderator) throw new CommunityError('FORBIDDEN');
    if (!['advice', 'workshop', 'health', 'visit', 'culture'].includes(code)) throw new CommunityError('INVALID_INPUT');
    if (!await this.repo.setReservationServiceActive(code, active)) throw new CommunityError('NOT_FOUND');
  }
  ownsReservations(accountId: string, workspaceId: string, reservationIds: string[]) { return this.repo.ownsReservations(accountId, workspaceId, reservationIds); }
  listReservations(accountId: string, limit: number, offset: number) { return this.repo.listReservations(accountId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)); }
  async createReservation(accountId: string, input: ReservationInput, key: string) {
    if (!keyPattern.test(key) || reservationValidation(input)) throw new CommunityError('INVALID_INPUT');
    let owns: boolean;
    try { owns = await this.workspaces.ownsWorkspace(accountId, input.workspaceId); } catch { throw new CommunityError('DEPENDENCY_UNAVAILABLE'); }
    if (!owns) throw new CommunityError('NOT_FOUND');
    const created = await this.repo.createReservation(accountId, input, key);
    if (!created) throw new CommunityError('RESERVATION_CONFLICT');
    return created;
  }
  async updateReservation(accountId: string, id: string, expectedVersion: number, input: ReservationChange) {
    if (!uuidPattern.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !input.date || !input.time) throw new CommunityError('INVALID_INPUT');
    if (reservationValidation({ workspaceId: '00000000-0000-4000-8000-000000000001', serviceCode: input.serviceCode, serviceLabel: input.serviceLabel ?? 'Current service', date: input.date, time: input.time, condition: input.condition })) throw new CommunityError('INVALID_INPUT');
    const workspaceId = await this.repo.reservationWorkspace(accountId, id);
    if (!workspaceId) throw new CommunityError('NOT_FOUND');
    let owns: boolean;
    try { owns = await this.workspaces.ownsWorkspace(accountId, workspaceId); } catch { throw new CommunityError('DEPENDENCY_UNAVAILABLE'); }
    if (!owns) throw new CommunityError('NOT_FOUND');
    const updated = await this.repo.updateReservation(accountId, id, expectedVersion, input);
    if (!updated) throw new CommunityError('VERSION_CONFLICT');
    return updated;
  }
  async cancelReservation(accountId: string, id: string, expectedVersion: number) {
    if (!uuidPattern.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new CommunityError('INVALID_INPUT');
    const workspaceId = await this.repo.reservationWorkspace(accountId, id);
    if (!workspaceId) throw new CommunityError('NOT_FOUND');
    let owns: boolean;
    try { owns = await this.workspaces.ownsWorkspace(accountId, workspaceId); } catch { throw new CommunityError('DEPENDENCY_UNAVAILABLE'); }
    if (!owns) throw new CommunityError('NOT_FOUND');
    const result = await this.repo.cancelReservation(accountId, id, expectedVersion);
    if (!result) throw new CommunityError('VERSION_CONFLICT');
    return result;
  }
  membership(groupId: string, accountId: string) { return this.repo.membership(groupId, accountId); }
}
