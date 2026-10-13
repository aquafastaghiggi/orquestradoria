export interface ClaudeModelUsage{
  model:string;
  inputTokens:number;
  cacheWriteTokens:number;
  cacheWrite1hTokens:number;
  cacheWrite5mTokens:number;
  cacheReadTokens:number;
  outputTokens:number;
  reportedUsd?:number;
  /** 'list' = o CLI conhece o preço do modelo; 'unknown' = o CLI estimou sem saber (valor NÃO confiável). */
  costBasis?:string;
}

export interface ClaudeUsage{
  costUsd?:number;
  /** Tokens "novos" processados: entrada + criação de cache + saída (leitura de cache fica à parte). */
  tokenUsage:number;
  inputTokens?:number;
  cachedInputTokens?:number;
  outputTokens?:number;
  reasoningTokens?:number;
  numTurns?:number;
  /** Uso por modelo (o Claude Code chama mais de um modelo por sessão, ex.: Haiku 4.5 para tarefas auxiliares). */
  models:ClaudeModelUsage[];
}

const num=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:0;

/**
 * Lê o envelope JSON do `claude -p --output-format json` (total_cost_usd, usage e modelUsage).
 * Nunca lança: se a saída não for o envelope esperado devolve undefined e o chamador mantém 0.
 */
export function extractClaudeUsage(stdout:string):ClaudeUsage|undefined{
  const text=String(stdout||'').trim();
  if(!text.startsWith('{')&&!text.startsWith('['))return undefined;
  let parsed:any;
  try{parsed=JSON.parse(text);}catch{return undefined;}
  const envelope=Array.isArray(parsed)?[...parsed].reverse().find((item:any)=>item&&typeof item==='object'&&('total_cost_usd' in item||'usage' in item)):parsed;
  if(!envelope||typeof envelope!=='object')return undefined;
  const usage=envelope.usage||{};
  const input=num(usage.input_tokens),creation=num(usage.cache_creation_input_tokens),cached=num(usage.cache_read_input_tokens),output=num(usage.output_tokens);
  const reasoning=num(usage.output_tokens_details?.thinking_tokens);
  const cost=typeof envelope.total_cost_usd==='number'&&Number.isFinite(envelope.total_cost_usd)?envelope.total_cost_usd:undefined;

  // A divisão 5m/1h só vem no total; aplica-se a mesma proporção a cada modelo.
  const write1h=num(usage.cache_creation?.ephemeral_1h_input_tokens),write5m=num(usage.cache_creation?.ephemeral_5m_input_tokens);
  const share1h=write1h+write5m>0?write1h/(write1h+write5m):creation>0?1:0;

  const models:ClaudeModelUsage[]=Object.entries((envelope.modelUsage||{}) as Record<string,any>).map(([model,value])=>{
    const write=num(value?.cacheCreationInputTokens);
    return{model,inputTokens:num(value?.inputTokens),cacheWriteTokens:write,cacheWrite1hTokens:Math.round(write*share1h),cacheWrite5mTokens:write-Math.round(write*share1h),cacheReadTokens:num(value?.cacheReadInputTokens),outputTokens:num(value?.outputTokens),reportedUsd:typeof value?.costUSD==='number'?value.costUSD:undefined,costBasis:typeof value?.costBasis==='string'?value.costBasis:undefined};
  });

  if(cost===undefined&&!input&&!creation&&!output&&!models.length)return undefined;
  return{costUsd:cost,tokenUsage:input+creation+output,inputTokens:input+creation,cachedInputTokens:cached,outputTokens:output,reasoningTokens:reasoning||undefined,numTurns:num(envelope.num_turns)||undefined,models};
}

/** Converte o uso por modelo no formato que o cálculo de custo entende (mesma regra usada pelo Developer). */
export function claudeUsageDetails(usage:ClaudeUsage){
  return usage.models.map(item=>({model:item.model,reportedUsd:item.reportedUsd,costBasis:item.costBasis,breakdown:{inputTokens:item.inputTokens,cacheWrite5mTokens:item.cacheWrite5mTokens,cacheWrite1hTokens:item.cacheWrite1hTokens,cacheReadTokens:item.cacheReadTokens,outputTokens:item.outputTokens,requests:usage.numTurns}}));
}