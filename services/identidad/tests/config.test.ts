import {afterEach,describe,it,expect,vi} from 'vitest';
import {loadConfig} from '../src/config.js';

afterEach(()=>vi.unstubAllEnvs());
function database(){
  vi.stubEnv('POSTGRES_HOST','localhost');vi.stubEnv('POSTGRES_PORT','5432');vi.stubEnv('POSTGRES_DB','identity_db');vi.stubEnv('POSTGRES_USER','identity_app');vi.stubEnv('POSTGRES_PASSWORD','fixture_not_a_secret');vi.stubEnv('IDENTITY_DEVELOPMENT_INBOX_URL','');
}

describe('identidad configuration',()=>{
  it('rejects malformed CORS origins and SSL flags',()=>{
    database();vi.stubEnv('CORS_ORIGINS','https://lab.example.test/path');expect(()=>loadConfig()).toThrow('exact origins');vi.stubEnv('CORS_ORIGINS','https://lab.example.test');vi.stubEnv('POSTGRES_SSL','yes');expect(()=>loadConfig()).toThrow('POSTGRES_SSL is invalid');
  });
  it('requires secure production cookies, SMTP, and the internal token',()=>{
    database();vi.stubEnv('IDENTITY_INTERNAL_TOKEN','');vi.stubEnv('NODE_ENV','production');vi.stubEnv('IDENTITY_WEB_BASE_URL','https://lab.example.test');vi.stubEnv('IDENTITY_COOKIE_SECURE','true');vi.stubEnv('IDENTITY_COOKIE_SAME_SITE','none');vi.stubEnv('IDENTITY_SMTP_URL','');vi.stubEnv('IDENTITY_SMTP_FROM','');expect(()=>loadConfig()).toThrow('requires IDENTITY_SMTP_URL');vi.stubEnv('IDENTITY_SMTP_URL','http://smtp.example.test');vi.stubEnv('IDENTITY_SMTP_FROM','noreply@example.test');expect(()=>loadConfig()).toThrow('must use smtp or smtps');vi.stubEnv('IDENTITY_SMTP_URL','smtps://smtp.example.test');expect(()=>loadConfig()).toThrow('production requires IDENTITY_INTERNAL_TOKEN');vi.stubEnv('IDENTITY_INTERNAL_TOKEN','test-only-internal-token');expect(loadConfig()).toMatchObject({sameSite:'none',identityInternalToken:'test-only-internal-token'});
  });
  it('selects local SMTP delivery and rejects non-loopback development inbox URLs',()=>{
    database();vi.stubEnv('NODE_ENV','development');vi.stubEnv('IDENTITY_SMTP_URL','smtp://mailpit:1025');vi.stubEnv('IDENTITY_SMTP_FROM','HCI Lab IA <lab@hci.local>');expect(loadConfig()).toMatchObject({mailTransport:'smtp',developmentInboxUrl:'http://127.0.0.1:8025'});vi.stubEnv('IDENTITY_DEVELOPMENT_INBOX_URL','http://mailpit:8025');expect(()=>loadConfig()).toThrow('loopback HTTP URL');
  });
  it('rejects a local SMTP placeholder in production',()=>{
    database();vi.stubEnv('NODE_ENV','production');vi.stubEnv('IDENTITY_COOKIE_SECURE','true');vi.stubEnv('IDENTITY_WEB_BASE_URL','https://lab.example.test');vi.stubEnv('IDENTITY_SMTP_URL','smtp://mailpit:1025');vi.stubEnv('IDENTITY_SMTP_FROM','lab@hci.local');expect(()=>loadConfig()).toThrow('production cannot use a local SMTP');
  });
});
