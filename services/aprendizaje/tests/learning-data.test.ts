import { describe,expect,it } from 'vitest';
import { LearningDataError,normalizePersona,normalizeResults,normalizeScenario,type PersonaInput } from '../src/aprendizaje/domain/learning-data.js';

const persona:PersonaInput={name:'Ana',age:'58',context:'context',goal:'goal',barrier:'barrier',device:'tablet',
  empathy:{says:'',thinks:'',does:'',feels:''},basis:'assumed'};
describe('learning data domain validation',()=>{
  it('preserves independent empathy fields and explicitly marked assumptions',()=>{
    expect(normalizePersona(persona)).toMatchObject({empathy:persona.empathy,basis:'assumed'});
  });
  it('rejects invalid required fields and unsupported epistemic values',()=>{
    expect(()=>normalizePersona({...persona,name:' '})).toThrowError(LearningDataError);
    expect(()=>normalizePersona({...persona,basis:'invented' as never})).toThrowError(LearningDataError);
  });
  it('keeps fictional scenarios independent from a persona',()=>{
    expect(normalizeScenario({title:'t',actor:'a',context:'c',task:'t',constraint:'c',success:'s',fictional:true}).personaId).toBeUndefined();
  });
  it('requires eight ordered measurement trials and paired Fitts distance/index values',()=>{
    const trials=Array.from({length:8},(_,i)=>({number:i+1,seconds:.4,errors:0,input:'pointer' as const,distance:20,indexDifficulty:1.2}));
    expect(normalizeResults({metrics:[],trials} ).trials).toHaveLength(8);
    expect(()=>normalizeResults({metrics:[],trials:trials.map(t=>({...t,indexDifficulty:undefined}))})).toThrowError(LearningDataError);
    expect(()=>normalizeResults({metrics:[],trials:trials.slice(0,7)})).toThrowError(LearningDataError);
  });
  it('accepts only unique, typed scalar metrics with positive repetition numbers',()=>{
    expect(()=>normalizeResults({metrics:[{code:'errors',repetition:1,value:1},{code:'errors',repetition:1,value:2}]})).toThrowError(LearningDataError);
    expect(()=>normalizeResults({metrics:[{code:'bad',repetition:0,value:{x:1} as never}]})).toThrowError(LearningDataError);
  });
  it('rejects malformed concept and pattern values without relying on HTTP validation',()=>{
    expect(()=>normalizeResults({metrics:[],concept:{code:'fake' as never,outcome:'completed'}})).toThrowError(LearningDataError);
    expect(()=>normalizeResults({metrics:[],pattern:{code:'form',problem:'',principle:'p',correction:'c'}})).toThrowError(LearningDataError);
  });
});
