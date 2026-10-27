import type {Pool} from 'pg';
import type {HealthPort} from '../application/health.js';
export class PostgresHealth implements HealthPort {
 constructor(private readonly pool:Pool){}
 async check():Promise<boolean>{try{await this.pool.query('SELECT 1');return true;}catch{return false;}}
}
