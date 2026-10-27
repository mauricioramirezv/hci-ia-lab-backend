import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';

const config={port:3002,host:'127.0.0.1',logLevel:'silent',corsOrigins:[],database:{host:'localhost',port:5432,database:'learning_db',user:'learning_app',password:'fixture_only_not_a_secret',max:1,connectionTimeoutMillis:100,ssl:false}};
async function withServer(run,ready=true) {
  const app=await createApp(config,{check:async()=>ready});
  const base=await app.listen({port:0,host:'127.0.0.1'});
  try {await run(base);} finally {await app.close();}
}
function assertError(body,code,response) {
  assert.equal(body.code,code);
  assert.equal(typeof body.requestId,'string');
  assert.equal(body.requestId,response.headers.get('x-request-id'));
  assert.deepEqual(Object.keys(body).sort(),['code','requestId']);
}

test('salud pública sin identidad ni cookies, sin revelar dependencias',()=>withServer(async base=>{
  const response=await fetch(base+'/health/live');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:'ok',service:'aprendizaje'});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
}));
test('contrato publicado describe las rutas del servidor actual y su respuesta real',()=>withServer(async base=>{
  const response=await fetch(base+'/openapi.json');
  assert.equal(response.status,200);
  const api=await response.json();
  assert.equal(api.openapi,'3.1.0');
  assert.deepEqual(api.security,[]);
  const actual=await (await fetch(base+'/health/live')).json(),schema=api.components.schemas.Liveness;
  assert.deepEqual(Object.keys(actual).sort(),schema.required.toSorted());
  for(const key of schema.required){
    const property=schema.properties[key];
    if(Object.hasOwn(property,'const'))assert.equal(actual[key],property.const);
    else {assert.equal(typeof actual[key],'string');assert.deepEqual(property.enum,[actual[key]]);}
  }
  assert.ok(Object.hasOwn(api.paths,'/health/ready'));
  for(const path of Object.keys(api.paths))assert.equal((await fetch(base+path)).status,200);
}));
test('rutas privadas inexistentes no exponen datos ni reflejan entradas',()=>withServer(async base=>{
  for(const path of ['/v1/accounts','/v1/groups/other/work','/unknown?token=private']){
    const response=await fetch(base+path);
    assert.equal(response.status,404);
    const body=await response.json();assertError(body,'ROUTE_NOT_FOUND',response);
    assert.ok(!JSON.stringify(body).includes('private'));
  }
}));
test('disponibilidad falla cerrada cuando PostgreSQL no está disponible',()=>withServer(async base=>{
  const response=await fetch(base+'/health/ready');
  assert.equal(response.status,503);
  assertError(await response.json(),'DEPENDENCY_UNAVAILABLE',response);
},false));
test('métodos no admitidos devuelven código traducible y Allow; HEAD funciona',()=>withServer(async base=>{
  for(const path of ['/health/live','/health/ready','/openapi.json']){
    for(const method of ['POST','PUT','DELETE','OPTIONS']){
      const response=await fetch(base+path,{method});
      assert.equal(response.status,405);
      assert.equal(response.headers.get('allow'),'GET, HEAD');
      assertError(await response.json(),'METHOD_NOT_ALLOWED',response);
    }
    const head=await fetch(base+path,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
  }
}));
