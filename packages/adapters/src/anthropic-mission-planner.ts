import {parseClaudeStructuredText} from './claude.js';
import {buildMissionPlannerPrompt,normalizeMissionPlannerOutput} from './mission-planner.js';

export interface AnthropicMissionPlannerConfig{model:string;apiKey?:string;baseUrl?:string;timeoutMs?:number;maxTokens?:number;fetchImpl?:typeof fetch;}
export interface AnthropicPlannerUsage{inputTokens:number;outputTokens:number;}

const fail=(message:string,kind:string)=>Object.assign(new Error(message),{kind});

/**
 * Planner de missão pela API Messages da Anthropic (sem Claude Code): uma única chamada com ~1–2 mil tokens, em vez de uma sessão
 * do CLI com ~50 mil tokens de cache (≈ US$ 0,0005 contra ≈ US$ 0,012 no Haiku 5.5). Exige ANTHROPIC_API_KEY.
 */
export class AnthropicMissionPlanner{
  readonly model:string;lastUsage?:AnthropicPlannerUsage;
  private readonly apiKey?:string;private readonly baseUrl:string;private readonly timeoutMs:number;private readonly maxTokens:number;private readonly fetchImpl:typeof fetch;
  constructor(config:AnthropicMissionPlannerConfig){
    this.model=config.model;this.apiKey=config.apiKey;this.baseUrl=(config.baseUrl||'https://api.anthropic.com').replace(/\/$/,'');
    this.timeoutMs=config.timeoutMs||60000;this.maxTokens=config.maxTokens||4096;this.fetchImpl=config.fetchImpl||fetch;
  }
  async plan(input:any){
    if(!this.apiKey)throw fail('ANTHROPIC_API_KEY não configurada: o Planner de missão via API precisa de uma chave.','configuration_error');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const response=await this.fetchImpl(`${this.baseUrl}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','x-api-key':this.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:this.model,max_tokens:this.maxTokens,messages:[{role:'user',content:buildMissionPlannerPrompt(input)}]}),signal:controller.signal});
      if(response.status===401||response.status===403)throw fail('A chave da API da Anthropic foi recusada (401/403). Confira a ANTHROPIC_API_KEY.','configuration_error');
      if(!response.ok)throw fail(`A API da Anthropic respondeu HTTP ${response.status}.`,'provider_error');
      const payload:any=await response.json();
      this.lastUsage={inputTokens:Number(payload?.usage?.input_tokens)||0,outputTokens:Number(payload?.usage?.output_tokens)||0};
      const text=Array.isArray(payload?.content)?payload.content.filter((block:any)=>block?.type==='text'&&typeof block.text==='string').map((block:any)=>block.text).join(''):'';
      if(!text.trim())throw fail('A resposta da Anthropic não trouxe texto.','validation_error');
      try{return normalizeMissionPlannerOutput(parseClaudeStructuredText(text));}
      catch(error){throw Object.assign(new Error('Não foi possível interpretar a resposta estruturada do Planner (API).'),{kind:(error as any)?.kind||'validation_error'});}
    }catch(error){
      if((error as Error)?.name==='AbortError')throw fail(`O Planner (API) excedeu ${this.timeoutMs}ms.`,'timeout');
      throw error;
    }finally{clearTimeout(timer);}
  }
}
