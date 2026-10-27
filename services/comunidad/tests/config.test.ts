import {afterEach,describe,it,expect,vi} from 'vitest';
import {loadConfig} from '../src/config.js';
afterEach(()=>vi.unstubAllEnvs());
describe('comunidad configuration',()=>{it('rejects malformed CORS origins and SSL flags',()=>{vi.stubEnv('POSTGRES_HOST','localhost');vi.stubEnv('POSTGRES_PORT','5432');vi.stubEnv('POSTGRES_DB','community_db');vi.stubEnv('POSTGRES_USER','community_app');vi.stubEnv('POSTGRES_PASSWORD','fixture_not_a_secret');vi.stubEnv('CORS_ORIGINS','https://lab.example.test/path');expect(()=>loadConfig()).toThrow('exact origins');vi.stubEnv('CORS_ORIGINS','https://lab.example.test');vi.stubEnv('POSTGRES_SSL','yes');expect(()=>loadConfig()).toThrow('POSTGRES_SSL is invalid')})});
