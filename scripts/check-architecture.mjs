import {readdir,readFile} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../services/',import.meta.url));
const services=(await readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory());
const violations=[];
async function scan(dir,service,layer){
 for(const ent of await readdir(dir,{withFileTypes:true})){
  const file=join(dir,ent.name);
  if(ent.isDirectory()){await scan(file,service,layer);continue;}
  if(!file.endsWith('.ts'))continue;
  const text=await readFile(file,'utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['\"]([^'\"]+)['\"]/g)){
   const spec=match[1];
   if(spec.startsWith('.')){
    const target=resolve(dirname(file),spec);
    const rel=relative(join(root,service,'src'),target);
    if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))violations.push(`${file}: import leaves service ${spec}`);
    const parts=rel.split(sep);
    if(layer==='domain'&&parts.some(x=>['application','infrastructure','presentation'].includes(x)))violations.push(`${file}: domain crosses into ${rel}`);
    if(layer==='application'&&parts.some(x=>['infrastructure','presentation'].includes(x)))violations.push(`${file}: application crosses into ${rel}`);
   } else if(/^(fastify|pg|@fastify\/|node:http|node:https)$/.test(spec)||spec.startsWith('@hci-ia-lab/')){
    violations.push(`${file}: forbidden framework, database or service dependency ${spec}`);
   }
  }
 }
}
for(const service of services)for(const layer of ['domain','application'])await scan(join(root,service.name,'src',service.name,layer),service.name,layer);
if(violations.length){console.error(violations.join('\n'));process.exitCode=1;}else console.log('Layer and service boundaries verified.');
