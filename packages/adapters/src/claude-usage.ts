export interface ClaudeUsage{
  costUsd?:number;
  /** Tokens "novos" processados: entrada + criação de cache + saída (leitura de cache fica à parte). */
  tokenUsage:number;
  inputTokens?:number;
  cachedInputTokens?:number;
  outputTokens?:number;
  reasoningTokens?:number;
}

const num=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:0;

/**
 * Lê o envelope JSON do `claude -p --output-format json` (campos total_cost_usd e usage).
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
  if(cost===undefined&&!input&&!creation&&!output)return undefined;
  return{costUsd:cost,tokenUsage:input+creation+output,inputTokens:input+creation,cachedInputTokens:cached,outputTokens:output,reasoningTokens:reasoning||undefined};
}
