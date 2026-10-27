import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
export const DUMMY_PASSWORD_HASH='scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$utaCGRVd9gOnaV8xbEIA4vBRF8ypbtIQDWRpZU2FBFaHwk7Wwsu1uFGRVGyvXblM1xqseTANdolqaWaidL4GqA';
const derive=(password:string,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>scryptCb(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024},(error,key)=>error?reject(error):resolve(key as Buffer)));
export async function hashPassword(password:string):Promise<string>{
 const salt=randomBytes(16),key=await derive(password,salt);
 return `scrypt$131072$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password:string,encoded:string):Promise<boolean>{
 const parts=encoded.split('$');if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='131072'||parts[2]!=='8'||parts[3]!=='1')return false;
 try{const salt=Buffer.from(parts[4],'base64url'),expected=Buffer.from(parts[5],'base64url'),actual=await derive(password,salt);return expected.length===actual.length&&timingSafeEqual(expected,actual)}catch{return false}
}
export const newToken=()=>randomBytes(32).toString('base64url');
export const tokenHash=(value:string)=>createHash('sha256').update(value).digest('hex');
