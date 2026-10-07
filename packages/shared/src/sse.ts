export const SSE_EVENT_TYPES=['task.created','task.started','task.resumed','task.completed','task.cancelled','execution.started','execution.progress','execution.heartbeat','execution.completed','execution.failed','execution.stalled','pipeline.integrity_failed','budget.exceeded','workspace.token_limit_exceeded'] as const;
export type SseEventType=typeof SSE_EVENT_TYPES[number];
export interface SseEnvelope<T=Record<string,unknown>>{type:string;taskId?:string;executionId?:string;timestamp:string;data:T;}
export function makeSseEnvelope(type:string,data:Record<string,unknown>,taskId?:string,executionId?:string,timestamp=new Date().toISOString()):SseEnvelope{return{type,taskId,executionId,timestamp,data};}
