import {describe,it,expect} from 'vitest';
import {normalizePersona,normalizeScenario,normalizeResults,LearningDataError} from '../src/aprendizaje/domain/learning-data.js';
const persona={name:'Ana',age:'58',context:'context',goal:'goal',barrier:'barrier',device:'tablet',empathy:{says:'',thinks:'',does:'',feels:''},basis:'assumed' as const};
describe('learning data domain validation',()=>{
 it('normalizes persona and retains the four independent empathy fields',()=>{expect(normalizePersona(persona).empathy).toEqual(persona.empathy);});
 it('rejects empty required persona fields',()=>{expect(()=>normalizePersona({...persona,name:' '})).toThrowError(LearningDataError);});
 it('preserves fictional scenarios without inferring a persona',()=>{expect(normalizeScenario({title:'t',actor:'a',context:'c',task:'t',constraint:'c',success:'s',fictional:true}).personaId).toBeUndefined();});
 it('requires eight ordered measured experiment trials and paired Fitts fields',()=>{
  const trials=Array.from({length:8},(_,i)=>({number:i+1,seconds:.4,errors:0,input:'pointer' as const,distance:20,indexDifficulty:1.2}));
  expect(normalizeResults({metrics:[],trials} ).trials).toHaveLength(8);
  expect(()=>normalizeResults({metrics:[],trials:trials.map(t=>({...t,indexDifficulty:undefined}))})).toThrowError(LearningDataError);
 });
 it('accepts only scalar typed metric values and stable repetitions',()=>{expect(()=>normalizeResults({metrics:[{code:'errors',repetition:1,value:1},{code:'errors',repetition:1,value:2}]})).toThrowError(LearningDataError);});
});
