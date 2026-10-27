import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp} from '../src/app.js';
import {loadConfig,type Config} from '../src/config.js';
import {AuthApplication,type Account} from '../src/identidad/application/auth.js';

const account:Account={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid',displayName:'Synthetic',platformRole:'participant',globalRoles:['participant','teacher'],permissions:[],emailVerified:true,status:'active',version:1};
const config:Config={port:3001,host:'127.0.0.1',logLevel:'silent',corsOrigins:['https://lab.example.test'],nodeEnv:'test',cookieSecure:true,sameSite:'none',sessionHours:24,webBaseUrl:'https://lab.example.test/hci-lab-ia',database:{host:'localhost',port:5432,database:'identity_db',user:'identity_app',password:'fixture-not-a-secret',max:1,connectionTimeoutMillis:100,ssl:false}};
afterEach(()=>vi.unstubAllEnvs());
describe('browser session contract',()=>{
  it('returns only a session-bound CSRF value and preserves the HttpOnly access cookie',async()=>{
    let expectedCsrf='';
    const auth={login:vi.fn(async(_email:string,_password:string,csrf:string)=>{expectedCsrf=csrf;return{account,token:'opaque-session-secret',expires:new Date(Date.now()+3600000)};}),current:vi.fn(async(token:string)=>token==='opaque-session-secret'?account:null),sessionValid:vi.fn(async(token:string,csrf:string)=>token==='opaque-session-secret'&&csrf===expectedCsrf)} as unknown as AuthApplication;
    const app=await createApp(config,{check:async()=>true},auth);
    try {
      const login=await app.inject({method:'POST',url:'/v1/sessions',headers:{origin:config.corsOrigins[0]},payload:{email:account.email,password:'synthetic-password'}});
      expect(login.statusCode).toBe(200);expect(login.json()).toMatchObject({account,csrfToken:expectedCsrf,expiresAt:expect.any(String)});expect(login.json()).not.toHaveProperty('token');
      const cookies=login.headers['set-cookie'] as string[], sessionCookie=cookies.find(value=>value.startsWith('hci_identity_session='))!, csrfCookie=cookies.find(value=>value.startsWith('hci_identity_csrf='))!;
      expect(sessionCookie).toContain('HttpOnly');expect(sessionCookie).toContain('Secure');expect(csrfCookie.split(';')[0]).toBe(`hci_identity_csrf=${encodeURIComponent(expectedCsrf)}`);
      const cookie=`${sessionCookie.split(';')[0]}; ${csrfCookie.split(';')[0]}`;
      const profile=await app.inject({url:'/v1/accounts/me',headers:{origin:config.corsOrigins[0],cookie}});
      expect(profile.statusCode).toBe(200);expect(profile.json()).toEqual({account,csrfToken:expectedCsrf});expect(profile.headers['cache-control']).toBe('no-store');
      const forged=await app.inject({url:'/v1/accounts/me',headers:{cookie:`${sessionCookie.split(';')[0]}; hci_identity_csrf=forged`}});expect(forged.statusCode).toBe(403);expect(forged.json()).toMatchObject({code:'CSRF_INVALID'});expect(forged.json()).not.toHaveProperty('csrfToken');
      const foreign=await app.inject({url:'/v1/accounts/me',headers:{origin:'https://foreign.example.test',cookie}});expect(foreign.statusCode).toBe(403);expect(foreign.json()).not.toHaveProperty('csrfToken');
      const visitor=await app.inject('/v1/accounts/me');expect(visitor.statusCode).toBe(401);expect(visitor.json()).not.toHaveProperty('csrfToken');
      const spec=(await app.inject('/openapi.json')).json();expect(spec.components.schemas.BrowserSession.required).toContain('csrfToken');expect(spec.components.schemas.CurrentSession.required).toContain('csrfToken');
    }finally{await app.close();}
  });
  it('keeps the Pages base path and produces usable HashRouter verification links',async()=>{
    for(const [key,value] of Object.entries({POSTGRES_HOST:'localhost',POSTGRES_PORT:'5432',POSTGRES_DB:'identity_db',POSTGRES_USER:'identity_app',POSTGRES_PASSWORD:'fixture',POSTGRES_SSL:'false',NODE_ENV:'test',IDENTITY_COOKIE_SECURE:'false',IDENTITY_COOKIE_SAME_SITE:'lax',IDENTITY_WEB_BASE_URL:'https://lab.example.test/hci-lab-ia/',IDENTITY_DEVELOPMENT_INBOX_URL:''}))vi.stubEnv(key,value);
    const loaded=loadConfig();expect(loaded.webBaseUrl).toBe('https://lab.example.test/hci-lab-ia');
    const query=vi.fn().mockResolvedValue({rows:[{id:account.id,email:account.email}],rowCount:1});const db={query,transaction:async<T>(work:(client:{query:typeof query})=>Promise<T>)=>work({query})};
    const send=vi.fn();const auth=new AuthApplication(db,{hashPassword:async()=> 'synthetic-hash',verifyPassword:async()=>false,newToken:()=> 'one-use+token',tokenHash:()=> 'synthetic-token-hash',dummyPasswordHash:'synthetic'}, {send},loaded.webBaseUrl,24);
    await auth.register(account.email,'Synthetic safe password 2026','Synthetic');
    const link=new URL(send.mock.calls[0][0].link);expect(link.pathname).toBe('/hci-lab-ia/');expect(link.hash.startsWith('#/cuenta?')).toBe(true);expect(new URLSearchParams(link.hash.split('?')[1]).get('verify')).toBe('one-use+token');
  });
});
