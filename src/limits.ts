export const LIMITS = Object.freeze({envelopeBytes:131072,responseBytes:5*1024*1024,receiptBytes:8192,plainBytes:65536,commandMs:300000,enrollmentMs:600000,snapshotMs:600000,futureMs:120000,retentionMs:86400000,tasks:100,operations:1000,attention:1000,revocations:4096,pollMs:3000,maxBackoffMs:30000});
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_OBJECT');return value as Record<string,unknown>}
export function exact(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).some(k=>!keys.includes(k)))throw Error('UNKNOWN_FIELD')}
export function text(value:unknown,max=256):string{if(typeof value!=='string'||!value.length||Buffer.byteLength(value)>max)throw Error('INVALID_TEXT');return value}
