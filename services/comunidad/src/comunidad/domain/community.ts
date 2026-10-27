export type GroupRole = 'leader' | 'participant';
export type SuggestionState = 'received' | 'reviewing' | 'accepted' | 'implemented' | 'rejected';
export type ServiceCode = 'advice' | 'workshop' | 'health' | 'visit' | 'culture';
export type ReservationCondition = 'good' | 'bad';
export type ReservationInput = {
  workspaceId: string;
  serviceCode?: ServiceCode;
  serviceLabel?: string;
  date: string;
  time: string;
  condition?: ReservationCondition;
};
export type ReservationItem = {
  id: string; workspaceId: string; createdBy: string; serviceCode: ServiceCode | null;
  serviceLabel: string; date: string; time: string; status: 'confirmed' | 'cancelled';
  condition: ReservationCondition | null; version: number; createdAt: string; updatedAt: string;
};
export type ReservationService = { code: ServiceCode; context: 'university' | 'healthcare' | 'culture'; active: boolean };

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const serviceContexts: Record<ServiceCode, ReservationService['context']> = {
  advice: 'university', workshop: 'university', health: 'healthcare', visit: 'culture', culture: 'culture',
};

const localDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const localTime = (date: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date);

export function reservationValidation(input: ReservationInput, now = new Date()): string | null {
  if (!uuidPattern.test(input.workspaceId)) return 'INVALID_INPUT';
  if (input.serviceCode && !Object.hasOwn(serviceContexts, input.serviceCode)) return 'INVALID_INPUT';
  if (!input.serviceCode && (!input.serviceLabel?.trim() || input.serviceLabel.trim().length > 160)) return 'INVALID_INPUT';
  if (input.serviceLabel !== undefined && (input.serviceLabel.trim().length < 1 || input.serviceLabel.trim().length > 160)) return 'INVALID_INPUT';
  if (input.condition !== undefined && !['good', 'bad'].includes(input.condition)) return 'INVALID_INPUT';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'INVALID_INPUT';
  const parsed = new Date(`${input.date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.date || input.date < localDate(now)) return 'INVALID_INPUT';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return 'INVALID_INPUT';
  if (input.date === localDate(now) && input.time <= localTime(now)) return 'INVALID_INPUT';
  return null;
}

const suggestionTransitions: Record<SuggestionState, readonly SuggestionState[]> = {
  received: ['reviewing', 'rejected'],
  reviewing: ['accepted', 'rejected'],
  accepted: ['implemented', 'rejected'],
  implemented: [],
  rejected: [],
};
export const canTransitionSuggestion = (from: SuggestionState, to: SuggestionState) => suggestionTransitions[from].includes(to);
