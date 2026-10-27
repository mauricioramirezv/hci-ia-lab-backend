import type {Pool,PoolClient} from 'pg';
import type {DbClient,DbPool,DbResult} from '../application/auth.js';
class ClientAdapter implements DbClient{constructor(private readonly client:Pick<PoolClient,'query'>){}async query<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<DbResult<T>>{const result=await this.client.query(sql,values);return {rows:result.rows as T[],rowCount:result.rowCount};}}
export class AuthDatabase implements DbPool{
 constructor(private readonly pool:Pool){}
 async query<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<DbResult<T>>{const result=await this.pool.query(sql,values);return {rows:result.rows as T[],rowCount:result.rowCount};}
 async transaction<T>(work:(client:DbClient)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query('BEGIN');const result=await work(new ClientAdapter(client));await client.query('COMMIT');return result}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
}
