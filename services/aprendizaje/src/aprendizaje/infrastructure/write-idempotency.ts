import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { IdempotencyKeyConflict } from '../domain/learning-data.js';
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
export const requestHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export async function claimWrite(client:PoolClient,accountId:string,operation:string,key:string,payload:unknown):Promise<{replayed:boolean;resourceId:string|null}>{
 const hash=requestHash(payload);
 const inserted=await client.query('INSERT INTO learning.write_idempotency(account_id,operation,idempotency_key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,operation,idempotency_key) DO NOTHING RETURNING idempotency_key',[accountId,operation,key,hash]);
 if(inserted.rowCount)return {replayed:false,resourceId:null};
 const existing=await client.query('SELECT request_hash,resource_id FROM learning.write_idempotency WHERE account_id=$1 AND operation=$2 AND idempotency_key=$3 FOR UPDATE',[accountId,operation,key]);
 if(!existing.rowCount||existing.rows[0].request_hash!==hash)throw new IdempotencyKeyConflict();
 if(!existing.rows[0].resource_id)throw new Error('Incomplete idempotency receipt');
 return {replayed:true,resourceId:existing.rows[0].resource_id};
}
export async function completeWrite(client:PoolClient,accountId:string,operation:string,key:string,resourceId:string){
 await client.query('UPDATE learning.write_idempotency SET resource_id=$4 WHERE account_id=$1 AND operation=$2 AND idempotency_key=$3',[accountId,operation,key,resourceId]);
}
