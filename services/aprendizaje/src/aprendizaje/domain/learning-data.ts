export const locales = ['es-CO', 'en-US', 'pt-BR', 'fr-FR', 'it-IT', 'ca-ES'] as const;
export const conceptCodes = ['ux','usability','accessibility','awareness','engagement','emotions','ergonomics','cognition','information','universal','responsibleAI'] as const;
export const patternCodes = ['form','navigation','feedback','choice','content','privacy'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LearningDataErrorCode = 'INVALID_INPUT'|'NOT_FOUND'|'VERSION_CONFLICT'|'STATE_CONFLICT'|'IDEMPOTENCY_KEY_REUSED';
export class LearningDataError extends Error {
  constructor(readonly code: LearningDataErrorCode) { super(code); this.name = 'LearningDataError'; }
}
export class IdempotencyKeyConflict extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED' as const;
  constructor() { super('IDEMPOTENCY_KEY_REUSED'); this.name = 'IdempotencyKeyConflict'; }
}
export const isUuid = (value: string) => uuid.test(value);
export type PersonaInput = { name:string; age:string; context:string; goal:string; barrier:string; device:string; empathy:{says:string;thinks:string;does:string;feels:string}; basis?:'observed'|'assumed'|'mixed'; observed?:string; assumptions?:string; emotionSource?:'observed'|'declared' };
export type ScenarioInput = { title:string; actor:string; context:string; task:string; constraint:string; success:string; personaId?:string; fictional?:boolean };
export type MetricInput = { code:string; repetition:number; value:number|string|boolean };
export type TrialInput = { number:number; seconds:number; errors:number; input:'keyboard'|'pointer'; distance?:number; indexDifficulty?:number };
export type ConceptResultInput = { code:typeof conceptCodes[number]; outcome:'completed'|'cancelled'; text?:string; reason?:string; edit?:string; decision?:string; emotionBefore?:number; emotionAfter?:number; confidenceBefore?:number; confidenceAfter?:number };
export type PatternResultInput = { code:typeof patternCodes[number]; problem:string; principle:string; correction:string };
export type ResultInput = { metrics:MetricInput[]; concept?:ConceptResultInput; pattern?:PatternResultInput; trials?:TrialInput[]; notes?:string };

const invalid = (): never => { throw new LearningDataError('INVALID_INPUT'); };
const text = (value:unknown, max:number, required=true):string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return invalid();
  return value.trim();
};
const optionalScale = (value:unknown):number|undefined => {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) return invalid();
  return value as number;
};
export function normalizePersona(value:PersonaInput):PersonaInput {
  if (!value || typeof value !== 'object' || !value.empathy || typeof value.empathy !== 'object' ||
    !['observed','assumed','mixed',undefined].includes(value.basis) ||
    !['observed','declared',undefined].includes(value.emotionSource)) return invalid();
  return {
    name:text(value.name,120), age:text(value.age,80,false), context:text(value.context,5000), goal:text(value.goal,2000),
    barrier:text(value.barrier,2000), device:text(value.device,500),
    empathy:{says:text(value.empathy.says,2000,false),thinks:text(value.empathy.thinks,2000,false),does:text(value.empathy.does,2000,false),feels:text(value.empathy.feels,2000,false)},
    basis:value.basis, observed:value.observed===undefined?undefined:text(value.observed,5000,false),
    assumptions:value.assumptions===undefined?undefined:text(value.assumptions,5000,false), emotionSource:value.emotionSource,
  };
}
export function normalizeScenario(value:ScenarioInput):ScenarioInput {
  if (!value || typeof value !== 'object' || (value.personaId !== undefined && (typeof value.personaId !== 'string' || !isUuid(value.personaId))) ||
    (value.fictional !== undefined && typeof value.fictional !== 'boolean')) return invalid();
  return {title:text(value.title,200),actor:text(value.actor,200),context:text(value.context,5000),task:text(value.task,2000),
    constraint:text(value.constraint,2000),success:text(value.success,2000),personaId:value.personaId,fictional:value.fictional};
}
export function normalizeResults(value:ResultInput):ResultInput {
  if (!value || typeof value !== 'object' || !Array.isArray(value.metrics) || value.metrics.length > 200) return invalid();
  const keys = new Set<string>();
  const metrics = value.metrics.map(item => {
    if (!item || typeof item !== 'object' || typeof item.code !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(item.code) ||
      !Number.isInteger(item.repetition) || item.repetition < 1 || item.repetition > 10000 ||
      !(typeof item.value === 'boolean' || (typeof item.value === 'string' && item.value.length <= 5000) ||
      (typeof item.value === 'number' && Number.isFinite(item.value)))) return invalid();
    const key = item.code + ':' + item.repetition;
    if (keys.has(key)) return invalid();
    keys.add(key);
    return {code:item.code,repetition:item.repetition,value:item.value};
  });
  const detailCount = Number(value.concept !== undefined) + Number(value.pattern !== undefined) + Number(value.trials !== undefined);
  if (detailCount > 1 || (!detailCount && !metrics.length)) return invalid();
  let concept:ConceptResultInput|undefined;
  if (value.concept !== undefined) {
    const c = value.concept;
    if (!c || typeof c !== 'object' || !conceptCodes.includes(c.code) || !['completed','cancelled'].includes(c.outcome)) return invalid();
    concept = {code:c.code,outcome:c.outcome};
    for (const field of ['text','reason','edit','decision'] as const) {
      const item = c[field];
      if (item !== undefined) concept[field] = text(item,5000,false);
    }
    for (const field of ['emotionBefore','emotionAfter','confidenceBefore','confidenceAfter'] as const) {
      const item = optionalScale(c[field]);
      if (item !== undefined) concept[field] = item;
    }
  }
  let pattern:PatternResultInput|undefined;
  if (value.pattern !== undefined) {
    const p = value.pattern;
    if (!p || typeof p !== 'object' || !patternCodes.includes(p.code)) return invalid();
    pattern = {code:p.code,problem:text(p.problem,5000),principle:text(p.principle,5000),correction:text(p.correction,5000)};
  }
  let trials:TrialInput[]|undefined;
  if (value.trials !== undefined) {
    if (!Array.isArray(value.trials) || value.trials.length !== 8) return invalid();
    trials = value.trials.map((trial,index) => {
      if (!trial || typeof trial !== 'object' || !Number.isInteger(trial.number) || trial.number !== index + 1 ||
        !Number.isFinite(trial.seconds) || trial.seconds < 0 || !Number.isInteger(trial.errors) || trial.errors < 0 ||
        !['keyboard','pointer'].includes(trial.input) ||
        ((trial.distance === undefined) !== (trial.indexDifficulty === undefined)) ||
        (trial.distance !== undefined && (!Number.isFinite(trial.distance) || trial.distance < 0 ||
          !Number.isFinite(trial.indexDifficulty) || trial.indexDifficulty! < 0))) return invalid();
      return {number:trial.number,seconds:trial.seconds,errors:trial.errors,input:trial.input,
        distance:trial.distance,indexDifficulty:trial.indexDifficulty};
    });
  }
  return {metrics,concept,pattern,trials,notes:value.notes===undefined?undefined:text(value.notes,5000,false)};
}
