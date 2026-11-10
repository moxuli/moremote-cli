import {isDeepStrictEqual} from 'node:util';
import type {AgentPermissionResponse} from '@getpaseo/protocol/agent-types';
import {object,text} from './limits.js';
interface RequestInput{kind?:string;input?:unknown;suggestions?:unknown[]}
function validSelectedLabels(answer:string,labels:string[],multi:boolean){if(!multi)return labels.includes(answer);let positions=new Set([0]);for(const label of labels){const next=new Set(positions);for(const pos of positions){const prefix=pos===0?label:', '+label;if(answer.startsWith(prefix,pos))next.add(pos+prefix.length)}positions=next}return answer.length>0&&positions.has(answer.length)}
/** Matches PermissionCardRequest.response: copy input, edit original strings, add exact question-header answers. */
export function validatePermissionInput(request:RequestInput,response:AgentPermissionResponse){
 if(response.behavior!=='allow')return;
 if(response.updatedPermissions?.some((grant,index,all)=>!request.suggestions?.some(offered=>isDeepStrictEqual(grant,offered))||all.slice(0,index).some(other=>isDeepStrictEqual(grant,other))))throw Error('UNSUPPORTED_PERMISSION_UPDATE');
 const input=request.input===undefined?{}:object(request.input);let questions:Record<string,unknown>[]=[];
 if(request.kind==='question'){if(!Array.isArray(input.questions)||!input.questions.length)throw Error('UNSUPPORTED_QUESTION_FORM');if(input.questions.length>20)throw Error('QUESTION_LIMIT');questions=input.questions.map(q=>object(q));}
 const headers=new Set<string>();for(const q of questions){text(q.header);text(q.question,8192);if(headers.has(q.header as string)||!Array.isArray(q.options)||q.options.length>32)throw Error('INVALID_QUESTION');headers.add(q.header as string)}
 const updated=response.updatedInput===undefined?input:object(response.updatedInput);
 for(const [key,value] of Object.entries(input)){if(typeof value==='string'){if(typeof updated[key]!=='string')throw Error('INPUT_SHAPE_CHANGED')}else if(!isDeepStrictEqual(value,updated[key]))throw Error('INPUT_SHAPE_CHANGED')}
 for(const key of Object.keys(updated))if(!Object.hasOwn(input,key)&&!(questions.length&&key==='answers'))throw Error('INPUT_SCOPE_CHANGED');
 if(questions.length){const answers=object(updated.answers);if(Object.keys(answers).length!==questions.length||Object.keys(answers).some(k=>!headers.has(k)))throw Error('INCOMPLETE_ANSWERS');for(const q of questions){const answer=answers[q.header as string];if(typeof answer!=='string'||Buffer.byteLength(answer)>8192)throw Error('INVALID_ANSWER');const options=q.options as unknown[];const labels=options.map(o=>text(object(o).label,4096));const allowOther=options.length===0||q.allowOther===true||q.isOther===true;const allowEmpty=q.allowEmpty===true&&allowOther;if(!allowEmpty&&!answer.trim())throw Error('INCOMPLETE_ANSWERS');if(!allowOther&&!validSelectedLabels(answer,labels,q.multiSelect===true))throw Error('INVALID_ANSWER_CHOICE')}}
}
