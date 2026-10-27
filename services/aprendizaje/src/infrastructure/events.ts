import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const services = ['identidad', 'aprendizaje', 'comunidad', 'evidencias'] as const;
export type EventSource = typeof services[number];
export type EventEnvelope = { id: string; source: EventSource; sequence: string; type: string; aggregateType: string; aggregateId: string; version: string; occurredAt: string; correlationId: string; payload: Record<string, unknown> };
export type EventOptions = { schema: 'identity' | 'learning' | 'community' | 'evidence'; source: EventSource; token?: string; targets: Partial<Record<EventSource, string>>; fetch?: typeof fetch; maxAttempts?: number; retryBaseMs?: number; leaseMs?: number; timeoutMs?: number; onEvent?: (client: PoolClient, event: EventEnvelope) => Promise<void> };
const context = new AsyncLocalStorage<string>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeSchema = (options: EventOptions) => { if (!['identity', 'learning', 'community', 'evidence'].includes(options.schema)) throw new Error('INVALID_EVENT_SCHEMA'); return options.schema; };
const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export function validEvent(input: unknown): input is EventEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const event = input as EventEnvelope;
  return uuid.test(event.id) && services.includes(event.source) && typeof event.sequence === 'string' && /^[1-9][0-9]{0,19}$/.test(event.sequence) && typeof event.type === 'string' && /^[a-z][a-z0-9_.]{1,99}$/.test(event.type) && typeof event.aggregateType === 'string' && /^[a-z_]{1,60}$/.test(event.aggregateType) && uuid.test(event.aggregateId) && typeof event.version === 'string' && event.version.length > 0 && event.version.length <= 100 && typeof event.correlationId === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(event.correlationId) && Number.isFinite(Date.parse(event.occurredAt)) && !!event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && JSON.stringify(event.payload).length <= 16000;
}

/** Promise API used by repositories. Correlation is transaction-local, never connection-global. */
export function instrumentEventPool(pool: Pool): Pool {
  const connect = async () => {
    const client = await pool.connect();
    const query = client.query.bind(client);
    const proxy = new Proxy(client, { get(target, property) {
      if (property === 'query') return async <R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> => {
        const result = await query<R>(text, values);
        if (typeof text === 'string' && /^\s*BEGIN\s*;?\s*$/i.test(text)) await query("SELECT set_config('app.correlation_id',$1,true)", [context.getStore() ?? randomUUID()]);
        return result;
      };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    return proxy;
  };
  return new Proxy(pool, { get(target, property) {
    if (property === 'connect') return connect;
    if (property === 'query') return async <R extends QueryResultRow>(text: string, values?: unknown[]) => {
      const client = await connect();
      try { await client.query('BEGIN'); const result = await client.query<R>(text, values); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } }) as Pool;
}

export async function receiveEvent(pool: Pool, options: EventOptions, event: EventEnvelope) {
  const schema = safeSchema(options), client = await pool.connect(), requestHash = hash(event);
  try {
    await client.query('BEGIN');
    const claim = await client.query(`INSERT INTO ${schema}.event_inbox(source,event_id,source_sequence,event_type,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source,event_id) DO NOTHING RETURNING event_id`, [event.source,event.id,event.sequence,event.type,requestHash,event.correlationId]);
    if (!claim.rowCount) {
      const prior = await client.query(`SELECT request_hash FROM ${schema}.event_inbox WHERE source=$1 AND event_id=$2 FOR UPDATE`, [event.source,event.id]);
      if (prior.rows[0]?.request_hash !== requestHash) throw Object.assign(new Error('EVENT_ID_REUSED'), { code: 'EVENT_ID_REUSED' });
      await client.query('COMMIT'); return { duplicate: true };
    }
    const applied = await client.query(`INSERT INTO ${schema}.event_projection(source,aggregate_type,aggregate_id,source_sequence,aggregate_version,event_type,payload,occurred_at,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source,aggregate_type,aggregate_id) DO UPDATE SET source_sequence=EXCLUDED.source_sequence,aggregate_version=EXCLUDED.aggregate_version,event_type=EXCLUDED.event_type,payload=EXCLUDED.payload,occurred_at=EXCLUDED.occurred_at,correlation_id=EXCLUDED.correlation_id WHERE ${schema}.event_projection.source_sequence<EXCLUDED.source_sequence RETURNING aggregate_id`, [event.source,event.aggregateType,event.aggregateId,event.sequence,event.version,event.type,JSON.stringify(event.payload),event.occurredAt,event.correlationId]);
    if (applied.rowCount && options.onEvent) await options.onEvent(client,event);
    await client.query(`UPDATE ${schema}.event_inbox SET processed_at=now() WHERE source=$1 AND event_id=$2`, [event.source,event.id]);
    await client.query('COMMIT'); return { duplicate: false, applied: !!applied.rowCount };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
type Delivery = { event_id: string; target: EventSource; attempts: number; lease_token: string; event_type: string; aggregate_type: string; aggregate_id: string; aggregate_version: string; payload: Record<string, unknown>; occurred_at: Date; correlation_id: string; source_sequence: string };
export const retryDelay = (attempt: number, base = 1000) => Math.min(3600000, base * 2 ** Math.min(Math.max(0, attempt - 1), 20));
export async function deliverEvents(pool: Pool, options: EventOptions, limit = 20, eventIds?: string[]) {
  const schema = safeSchema(options), lease = randomUUID();
  if (!options.token) return { claimed: 0, delivered: 0, failed: 0, disabled: true };
  const claimed = await pool.query<Delivery>(`WITH candidates AS (SELECT event_id,target FROM ${schema}.event_outbox_delivery WHERE ((status IN ('pending','retry') AND available_at<=now()) OR (status='processing' AND lease_until<now())) AND ($4::uuid[] IS NULL OR event_id=ANY($4::uuid[])) ORDER BY available_at,event_id LIMIT $1 FOR UPDATE SKIP LOCKED), acquired AS (UPDATE ${schema}.event_outbox_delivery d SET status='processing',attempts=attempts+1,lease_until=now()+($2::int*interval '1 millisecond'),lease_token=$3 FROM candidates c WHERE d.event_id=c.event_id AND d.target=c.target RETURNING d.*) SELECT d.event_id,d.target,d.attempts,d.lease_token,e.event_type,e.aggregate_type,e.aggregate_id,e.aggregate_version,e.payload,e.occurred_at,e.correlation_id,e.source_sequence::text FROM acquired d JOIN ${schema}.event_outbox e ON e.event_id=d.event_id`, [Math.min(Math.max(limit,1),100),options.leaseMs ?? 120000,lease,eventIds??null]);
  let delivered = 0, failed = 0;
  for (const row of claimed.rows) {
    let failure = 'TARGET_UNCONFIGURED', permanent = false;
    const origin = options.targets[row.target];
    try {
      if (!origin) throw new Error(failure);
      failure='DELIVERY_FAILED';
      const event: EventEnvelope = { id: row.event_id, source: options.source, sequence: row.source_sequence, type: row.event_type, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, version: row.aggregate_version, payload: row.payload, occurredAt: row.occurred_at.toISOString(), correlationId: row.correlation_id };
      const result = await (options.fetch ?? fetch)(`${origin}/internal/v1/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-identity-internal-token': options.token, 'x-request-id': event.correlationId }, body: JSON.stringify(event), signal: AbortSignal.timeout(options.timeoutMs ?? 3000) });
      if (!result.ok) { failure = 'HTTP_' + result.status; permanent = result.status >= 400 && result.status < 500 && result.status !== 429; throw new Error(failure); }
      const ack = await result.json() as { accepted?: boolean };
      if (ack.accepted !== true) { failure = 'INVALID_ACK'; throw new Error(failure); }
      await pool.query(`UPDATE ${schema}.event_outbox_delivery SET status='delivered',delivered_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL WHERE event_id=$1 AND target=$2 AND lease_token=$3`, [row.event_id,row.target,row.lease_token]); delivered++; continue;
    } catch { failed++; }
    const dead = permanent || row.attempts >= (options.maxAttempts ?? 8);
    await pool.query(`UPDATE ${schema}.event_outbox_delivery SET status=$4,available_at=now()+($5::int*interval '1 millisecond'),lease_until=NULL,lease_token=NULL,last_error=$6 WHERE event_id=$1 AND target=$2 AND lease_token=$3`, [row.event_id,row.target,row.lease_token,dead ? 'deadletter' : 'retry',retryDelay(row.attempts,options.retryBaseMs),failure]);
  }
  return { claimed: claimed.rowCount ?? 0, delivered, failed, disabled: false };
}

export function registerEventRoutes(app: FastifyInstance, pool: Pool, options: EventOptions) {
  const schema = safeSchema(options);
  // Register on the service root before business routes to retain x-request-id in transactions.
  app.addHook('onRequest', (request, _reply, done) => context.run(request.id, done));
  const allowed = (received: unknown) => { if (typeof received !== 'string' || !options.token) return false; const a=Buffer.from(received), b=Buffer.from(options.token); return a.length===b.length && timingSafeEqual(a,b); };
  app.post('/internal/v1/events', { bodyLimit: 32768, schema: { operationId: 'receiveDomainEvent', tags: ['internal'], security: [{ identityInternalToken: [] }], body: { type: 'object', additionalProperties: false, required: ['id','source','sequence','type','aggregateType','aggregateId','version','occurredAt','correlationId','payload'], properties: { id: {type:'string',format:'uuid'}, source: {type:'string',enum:services}, sequence:{type:'string',pattern:'^[1-9][0-9]{0,19}$'}, type:{type:'string',maxLength:100}, aggregateType:{type:'string',maxLength:60}, aggregateId:{type:'string',format:'uuid'}, version:{type:'string',maxLength:100}, occurredAt:{type:'string',format:'date-time'}, correlationId:{type:'string',maxLength:100}, payload:{type:'object',additionalProperties:true} } } } }, async (request,reply) => {
    if (!allowed(request.headers['x-identity-internal-token'])) return reply.code(401).send({code:'UNAUTHENTICATED',requestId:request.id});
    if (!validEvent(request.body) || request.body.source===options.source) return reply.code(400).send({code:'INVALID_EVENT',requestId:request.id});
    try { return { accepted: true, ...await receiveEvent(pool,options,request.body) }; }
    catch(error) { if ((error as {code?:string}).code==='EVENT_ID_REUSED') return reply.code(409).send({code:'EVENT_ID_REUSED',requestId:request.id}); throw error; }
  });
  app.get('/internal/v1/events/status', {schema:{operationId:'domainEventStatus',tags:['internal'],security:[{identityInternalToken:[]}]}}, async(request,reply)=> {
    if (!allowed(request.headers['x-identity-internal-token'])) return reply.code(401).send({code:'UNAUTHENTICATED',requestId:request.id});
    return {items:(await pool.query(`SELECT target,status,count(*)::int AS count FROM ${schema}.event_outbox_delivery GROUP BY target,status ORDER BY target,status`)).rows};
  });
  app.post('/internal/v1/events/retry', {schema:{operationId:'retryDeadletterEvents',tags:['internal'],security:[{identityInternalToken:[]}],body:{type:'object',additionalProperties:false,required:['eventId','target'],properties:{eventId:{type:'string',format:'uuid'},target:{type:'string',enum:services}}}}}, async(request,reply)=>{
    if (!allowed(request.headers['x-identity-internal-token'])) return reply.code(401).send({code:'UNAUTHENTICATED',requestId:request.id});
    const input=request.body as {eventId:string;target:string};
    const updated=await pool.query(`UPDATE ${schema}.event_outbox_delivery SET status='retry',attempts=0,available_at=now(),last_error=NULL WHERE event_id=$1 AND target=$2 AND status='deadletter' RETURNING event_id`,[input.eventId,input.target]);
    return {requeued:!!updated.rowCount};
  });
}
export function startEventWorker(pool: Pool, options: EventOptions) {
  let running: Promise<unknown> | undefined, stopped = false;
  const tick = () => { if (running || stopped) return; running=deliverEvents(pool,options).catch(()=>undefined).finally(()=>{running=undefined;}); };
  const timer = setInterval(tick,2000); timer.unref(); tick();
  return { async stop() { stopped=true; clearInterval(timer); await running; } };
}
