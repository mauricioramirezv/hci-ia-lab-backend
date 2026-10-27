export type WorkErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'STATE_CONFLICT' | 'FORBIDDEN' | 'DEPENDENCY_UNAVAILABLE' | 'IDEMPOTENCY_KEY_REUSED';
export class WorkError extends Error { constructor(readonly code: WorkErrorCode) { super(code); this.name = 'WorkError'; } }
export type ExecutionInput = {
  workspaceId: string; activityVersionId: string; assignmentId?: string; source: 'measured' | 'declared' | 'simulated' | 'mixed' | 'derived';
  idempotencyKey: string; alias?: string; condition?: string; prototype?: string;
};
export type AssignmentInput = { activityVersionId: string; title: string; instructions: string; opensAt?: Date; dueAt?: Date; criteria?: { code: string; name: string; description?: string; maxScore?: number; order: number }[] };
export interface GroupAccessPort { membership(groupId: string, accountId: string): Promise<{ active: boolean; role: 'leader' | 'participant' | null }> }
export interface WorkRepository {
  listActivities(locale: string, limit: number, offset: number): Promise<unknown[]>;
  createWorkspace(ownerId: string, name: string, idempotencyKey: string): Promise<{ item: unknown; replayed: boolean }>;
  listWorkspaces(ownerId: string, limit: number, offset: number): Promise<unknown[]>;
  createExecution(accountId: string, input: ExecutionInput): Promise<{ item: unknown; replayed: boolean }>;
  listExecutions(accountId: string, limit: number, offset: number): Promise<unknown[]>;
  updateExecution(accountId: string, id: string, version: number, state: 'in_progress' | 'completed' | 'cancelled', notes?: string): Promise<unknown | null>;
  createDelivery(accountId: string, executionId: string, idempotencyKey: string, comment?: string): Promise<{ item: unknown; replayed: boolean } | null>;
  executionGroup(executionId: string): Promise<string | null>;
  listDeliveryVersions(accountId: string, executionId: string, limit: number, offset: number): Promise<unknown[] | null>;
  listGroupDeliveryVersions(groupId: string, limit: number, offset: number): Promise<unknown[]>;
  addOwnerFeedback(accountId: string, deliveryId: string, message: string, kind: 'comment' | 'response'): Promise<unknown | null>;
  assignmentGroup(assignmentId: string): Promise<string | null>;
  createAssignment(groupId: string, accountId: string, input: AssignmentInput): Promise<unknown | null>;
  listAssignments(groupId: string): Promise<unknown[]>;
  deliveryGroup(deliveryId: string): Promise<{ groupId: string | null; ownerId: string; state: string } | null>;
  evaluateDelivery(accountId: string, deliveryId: string, criterionId: string, score?: number, comment?: string): Promise<unknown | null>;
  reviewDelivery(accountId: string, deliveryId: string, expectedState: string, state: 'changes_requested' | 'accepted', message: string): Promise<unknown | null>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class WorkApplication {
  constructor(private readonly repo: WorkRepository, private readonly groups: GroupAccessPort) {}
  listActivities(locale: string, limit: number, offset: number) {
    const supported = ['es-CO', 'en-US', 'fr-FR', 'pt-BR', 'it-IT', 'ca-ES'];
    if (!supported.includes(locale)) throw new WorkError('INVALID_INPUT');
    return this.repo.listActivities(locale, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  createWorkspace(ownerId: string, name: string, idempotencyKey: string) {
    const normalized = name.trim();
    if (!normalized || normalized.length > 120 || !uuid.test(idempotencyKey)) throw new WorkError('INVALID_INPUT');
    return this.repo.createWorkspace(ownerId, normalized, idempotencyKey);
  }
  listWorkspaces(ownerId: string, limit: number, offset: number) { return this.repo.listWorkspaces(ownerId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)); }
  async startExecution(accountId: string, input: ExecutionInput) {
    if (![input.workspaceId, input.activityVersionId, input.idempotencyKey].every(value => uuid.test(value))) throw new WorkError('INVALID_INPUT');
    if (input.assignmentId && !uuid.test(input.assignmentId)) throw new WorkError('INVALID_INPUT');
    if (!['measured', 'declared', 'simulated', 'mixed', 'derived'].includes(input.source) || (input.condition !== undefined && (typeof input.condition !== 'string' || input.condition.length > 2000))) throw new WorkError('INVALID_INPUT');
    if (input.assignmentId) {
      const groupId = await this.repo.assignmentGroup(input.assignmentId);
      if (!groupId) throw new WorkError('NOT_FOUND');
      let membership;
      try { membership = await this.groups.membership(groupId, accountId); } catch { throw new WorkError('DEPENDENCY_UNAVAILABLE'); }
      if (!membership.active) throw new WorkError('NOT_FOUND');
    }
    return this.repo.createExecution(accountId, input);
  }
  listExecutions(accountId: string, limit: number, offset: number) { return this.repo.listExecutions(accountId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)); }
  updateExecution(accountId: string, id: string, version: number, state: 'in_progress' | 'completed' | 'cancelled', notes?: string) {
    if (!uuid.test(id) || !Number.isInteger(version) || version < 1 || (notes !== undefined && notes.length > 5000)) throw new WorkError('INVALID_INPUT');
    return this.repo.updateExecution(accountId, id, version, state, notes);
  }
  async createDelivery(accountId: string, executionId: string, idempotencyKey: string, comment?: string) {
    if (!uuid.test(executionId) || !uuid.test(idempotencyKey) || (comment !== undefined && comment.length > 5000)) throw new WorkError('INVALID_INPUT');
    const groupId = await this.repo.executionGroup(executionId);
    if (groupId) {
      let membership;
      try { membership = await this.groups.membership(groupId, accountId); } catch { throw new WorkError('DEPENDENCY_UNAVAILABLE'); }
      if (!membership.active) throw new WorkError('NOT_FOUND');
    }
    return this.repo.createDelivery(accountId, executionId, idempotencyKey, comment);
  }  addOwnerFeedback(accountId: string, deliveryId: string, message: string) {
    if (!uuid.test(deliveryId) || !message.trim() || message.length > 5000) throw new WorkError('INVALID_INPUT');
    return this.repo.addOwnerFeedback(accountId, deliveryId, message.trim(), 'response');
  }
  listDeliveryVersions(accountId: string, executionId: string, limit: number, offset: number) {
    if (!uuid.test(executionId)) throw new WorkError('INVALID_INPUT');
    return this.repo.listDeliveryVersions(accountId, executionId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  async listGroupDeliveryVersions(accountId: string, groupId: string, limit: number, offset: number) {
    if (!uuid.test(groupId)) throw new WorkError('INVALID_INPUT');
    let membership;
    try { membership = await this.groups.membership(groupId, accountId); } catch { throw new WorkError('DEPENDENCY_UNAVAILABLE'); }
    if (!membership.active || membership.role !== 'leader') throw new WorkError('NOT_FOUND');
    return this.repo.listGroupDeliveryVersions(groupId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0));
  }
  async createAssignment(accountId: string, _globalRoles: string[], groupId: string, input: AssignmentInput) {
    if (!uuid.test(groupId) || !uuid.test(input.activityVersionId) || !input.title.trim() || input.title.length > 200 || !input.instructions.trim() || input.instructions.length > 5000) throw new WorkError('INVALID_INPUT');
    if (input.opensAt && Number.isNaN(input.opensAt.getTime()) || input.dueAt && Number.isNaN(input.dueAt.getTime()) || input.opensAt && input.dueAt && input.dueAt < input.opensAt) throw new WorkError('INVALID_INPUT');
    const criteria = input.criteria ?? [];
    if (criteria.length > 30 || new Set(criteria.map(item => item.code)).size !== criteria.length || new Set(criteria.map(item => item.order)).size !== criteria.length || criteria.some(item => !item.code.trim() || item.code.length > 80 || !item.name.trim() || item.name.length > 160 || !Number.isInteger(item.order) || item.order < 1 || item.order > 100 || (item.description?.length ?? 0) > 2000 || (item.maxScore !== undefined && (!Number.isFinite(item.maxScore) || item.maxScore < 0)))) throw new WorkError('INVALID_INPUT');
    let membership;
    try { membership = await this.groups.membership(groupId, accountId); } catch { throw new WorkError('DEPENDENCY_UNAVAILABLE'); }
    if (!membership.active || membership.role !== 'leader') throw new WorkError('FORBIDDEN');
    const item = await this.repo.createAssignment(groupId, accountId, { ...input, criteria, title: input.title.trim(), instructions: input.instructions.trim() });
    if (!item) throw new WorkError('NOT_FOUND');
    return item;
  }
  async listAssignments(accountId: string, groupId: string) {
    if (!uuid.test(groupId)) throw new WorkError('INVALID_INPUT');
    let membership;
    try { membership = await this.groups.membership(groupId, accountId); } catch { throw new WorkError('DEPENDENCY_UNAVAILABLE'); }
    if (!membership.active) throw new WorkError('NOT_FOUND');
    return this.repo.listAssignments(groupId);
  }
  async evaluateDelivery(accountId: string, _globalRoles: string[], deliveryId: string, criterionId: string, score?: number, comment?: string) {
    if (!uuid.test(deliveryId) || !uuid.test(criterionId) || (score !== undefined && (!Number.isFinite(score) || score < 0)) || (comment !== undefined && comment.length > 5000)) throw new WorkError('INVALID_INPUT');
    const scope = await this.repo.deliveryGroup(deliveryId);
    if (!scope || !scope.groupId) throw new WorkError('NOT_FOUND');
    let membership;
    try { membership = await this.groups.membership(scope.groupId, accountId); } catch { throw new WorkError('DEPENDENCY_UNAVAILABLE'); }
    if (!membership.active || membership.role !== 'leader') throw new WorkError('NOT_FOUND');
    const result = await this.repo.evaluateDelivery(accountId, deliveryId, criterionId, score, comment?.trim() || undefined);
    if (!result) throw new WorkError('STATE_CONFLICT');
    return result;
  }  async reviewDelivery(accountId: string, _globalRoles: string[], deliveryId: string, expectedState: string, state: 'changes_requested' | 'accepted', message: string) {
    if (!uuid.test(deliveryId) || !['submitted', 'revision', 'changes_requested'].includes(expectedState) || !message.trim() || message.length > 5000) throw new WorkError('INVALID_INPUT');
    const scope = await this.repo.deliveryGroup(deliveryId);
    if (!scope || !scope.groupId) throw new WorkError('NOT_FOUND');
    let membership;
    try { membership = await this.groups.membership(scope.groupId, accountId); } catch { throw new WorkError('DEPENDENCY_UNAVAILABLE'); }
    if (!membership.active || membership.role !== 'leader') throw new WorkError('NOT_FOUND');
    const result = await this.repo.reviewDelivery(accountId, deliveryId, expectedState, state, message.trim());
    if (!result) throw new WorkError('VERSION_CONFLICT');
    return result;
  }
}





