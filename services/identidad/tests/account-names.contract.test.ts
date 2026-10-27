import {describe,it,expect,vi} from 'vitest';
import {createApp} from '../src/app.js';
import type {AuthApplication} from '../src/identidad/application/auth.js';
const config={port:3001,host:'127.0.0.1',logLevel:'silent' as const,corsOrigins:['https://lab.example.test'],nodeEnv:'test',cookieSecure:true,sameSite:'lax' as const,sessionHours:24,webBaseUrl:'https://lab.example.test',database:{host:'localhost',port:5432,database:'identity_db',user:'identity_app',password:'fixture_only_not_a_secret',max:1,connectionTimeoutMillis:100,ssl:false}};
describe('compatible account name contract',()=>{
 it('accepts separate surname, preserves old requests and rejects unknown privilege fields',async()=>{
   const register=vi.fn().mockResolvedValue(undefined),auth={register} as unknown as AuthApplication;
   const app=await createApp(config,{check:async()=>true},auth);
   try {
     const payload={email:'synthetic@example.invalid',password:'Synthetic password 2026',displayName:'Nombre sintético',lastName:'Apellido sintético'};
     const response=await app.inject({method:'POST',url:'/v1/accounts',payload});
     expect(response.statusCode).toBe(202);
     expect(register).toHaveBeenCalledExactlyOnceWith(payload.email,payload.password,payload.displayName,payload.lastName);
     const legacy={email:payload.email,password:payload.password,displayName:payload.displayName};
     expect((await app.inject({method:'POST',url:'/v1/accounts',payload:legacy})).statusCode).toBe(202);
     expect(register).toHaveBeenLastCalledWith(payload.email,payload.password,payload.displayName,undefined);
     expect((await app.inject({method:'POST',url:'/v1/accounts',payload:{...payload,lastName:'x'.repeat(101)}})).statusCode).toBe(400);
     expect((await app.inject({method:'POST',url:'/v1/accounts',payload:{...payload,globalRoles:['administrator']}})).statusCode).toBe(400);
     expect(register).toHaveBeenCalledTimes(2);
     const spec=(await app.inject('/openapi.json')).json();
     expect(spec.components.schemas.Account.properties.lastName.type).toEqual(['string','null']);
     expect(spec.paths['/v1/accounts'].post.requestBody.content['application/json'].schema.required).toEqual(['email','password','displayName']);
   } finally {await app.close();}
 });
 it('does not call persistence when a visitor checks the current account',async()=>{
   const current=vi.fn(),auth={current} as unknown as AuthApplication;
   const app=await createApp(config,{check:async()=>true},auth);
   try {
     expect((await app.inject('/v1/accounts/me')).statusCode).toBe(401);
     expect(current).not.toHaveBeenCalled();
   } finally {await app.close();}
 });
});
