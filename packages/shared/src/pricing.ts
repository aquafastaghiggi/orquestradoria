/**
 * Tabela de preços por modelo (USD por 1 milhão de tokens) e motor de cálculo de custo.
 *
 * Fontes oficiais (conferidas em 2026-10-13):
 *  - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *  - OpenAI:    https://developers.openai.com/api/docs/pricing
 *  - Cursor:    https://cursor.com/docs/account/pricing
 *
 * Os preços mudam. Um arquivo JSON apontado por PRICING_FILE pode sobrescrever/estender esta tabela
 * (ver `mergePricing`) sem alterar código.
 */

export type PricingVendor='anthropic'|'openai'|'cursor';
export type PriceTier='economy'|'balanced'|'premium';

export interface LongContextRates{thresholdTokens:number;input:number;cacheWrite5m?:number;cacheWrite1h?:number;cacheRead?:number;output:number;}
export interface ModelPrice{
  id:string;
  vendor:PricingVendor;
  displayName:string;
  tier:PriceTier;
  status:'current'|'legacy';
  /** USD por 1M de tokens. */
  input:number;
  cacheWrite5m?:number;
  cacheWrite1h?:number;
  cacheRead?:number;
  output:number;
  longContext?:LongContextRates;
  /** Nomes alternativos aceitos pelos CLIs/APIs. */
  aliases?:string[];
  /** Papéis para os quais o modelo é uma opção razoável. */
  suitableFor?:('planner'|'developer'|'reviewer')[];
  /** Se o orquestrador consegue executar este modelo hoje (Cursor ainda não tem adapter). */
  executable:boolean;
  /** Foi confirmado com uma chamada real em 2026-10-13. */
  verified?:boolean;
  note?:string;
}

export const PRICING_AS_OF='2026-10-13';
export const PRICING_SOURCES:{vendor:PricingVendor;label:string;url:string}[]=[
  {vendor:'anthropic',label:'Anthropic API pricing',url:'https://platform.claude.com/docs/en/about-claude/pricing'},
  {vendor:'openai',label:'OpenAI API pricing',url:'https://developers.openai.com/api/docs/pricing'},
  {vendor:'cursor',label:'Cursor models & pricing',url:'https://cursor.com/docs/account/pricing'},
];

const A=(id:string,displayName:string,tier:PriceTier,input:number,w5:number,w1:number,read:number,output:number,extra:Partial<ModelPrice>={}):ModelPrice=>({id,vendor:'anthropic',displayName,tier,status:'current',input,cacheWrite5m:w5,cacheWrite1h:w1,cacheRead:read,output,executable:true,suitableFor:['planner','developer','reviewer'],...extra});
const O=(id:string,displayName:string,tier:PriceTier,input:number,cached:number,output:number,extra:Partial<ModelPrice>={}):ModelPrice=>({id,vendor:'openai',displayName,tier,status:'current',input,cacheRead:cached,output,executable:true,suitableFor:['planner','developer','reviewer'],...extra});

export const DEFAULT_PRICING:ModelPrice[]=[
  // ── Anthropic (Claude Code CLI / Messages API) ──
  A('claude-haiku-5-5','Claude Haiku 5.5','economy',0.10,0.125,0.20,0.01,0.50,{longContext:{thresholdTokens:100_000,input:0.50,cacheWrite5m:0.625,cacheWrite1h:1,cacheRead:0.05,output:2.50},verified:true,note:'Mais barato da Anthropic. Prompts acima de 100 mil tokens custam 5x.'}),
  A('claude-haiku-4-5','Claude Haiku 4.5','balanced',1,1.25,2,0.10,5,{aliases:['haiku','claude-haiku-4-5-20251001'],note:'O alias "haiku" do CLI resolveu para este modelo em 2026-10-13 (10x mais caro que o Haiku 5.5).'}),
  A('claude-sonnet-5-5','Claude Sonnet 5.5','balanced',2,2.5,4,0.10,10),
  A('claude-sonnet-5','Claude Sonnet 5','balanced',2,2.5,4,0.20,10),
  A('claude-sonnet-4-6','Claude Sonnet 4.6','balanced',3,3.75,6,0.30,15,{aliases:['sonnet']}),
  A('claude-sonnet-4-5','Claude Sonnet 4.5','balanced',3,3.75,6,0.30,15,{status:'legacy'}),
  A('claude-opus-5-5','Claude Opus 5.5','premium',4,5,8,0.20,20),
  A('claude-opus-5','Claude Opus 5','premium',5,6.25,10,0.50,25),
  A('claude-opus-4-8','Claude Opus 4.8','premium',5,6.25,10,0.50,25,{status:'legacy'}),
  A('claude-fable-5-1','Claude Fable 5.1','premium',10,12.5,20,0.25,50),
  // ── OpenAI (Codex CLI / Responses API) ──
  O('gpt-5.6-luna','GPT-5.6 Luna','economy',0.20,0.02,1.20,{longContext:{thresholdTokens:272_000,input:0.40,cacheRead:0.04,output:1.80},verified:true,note:'Mais barato da família GPT-5.6; é o modelo configurado hoje para o Reviewer.'}),
  O('gpt-5.6-terra','GPT-5.6 Terra','balanced',2,0.20,12,{longContext:{thresholdTokens:272_000,input:4,cacheRead:0.40,output:18}}),
  O('gpt-5.6-sol','GPT-5.6 Sol','premium',4,0.40,20,{longContext:{thresholdTokens:272_000,input:8,cacheRead:0.80,output:30}}),
  O('gpt-5.5','GPT-5.5','premium',5,0.50,30,{longContext:{thresholdTokens:272_000,input:10,cacheRead:1,output:45}}),
  O('gpt-5.4','GPT-5.4','balanced',2.5,0.25,15,{longContext:{thresholdTokens:272_000,input:5,cacheRead:0.50,output:22.5}}),
  O('gpt-5.4-mini','GPT-5.4 mini','economy',0.75,0.075,4.5),
  O('gpt-5.4-nano','GPT-5.4 nano','economy',0.20,0.02,1.25,{suitableFor:['reviewer']}),
  O('gpt-5.3-codex','GPT-5.3 Codex','balanced',1.75,0.175,14),
  O('gpt-5-mini','GPT-5 mini','economy',0.25,0.025,2,{status:'legacy'}),
  O('gpt-5-nano','GPT-5 nano','economy',0.05,0.005,0.40,{status:'legacy',suitableFor:['reviewer'],note:'Mais barato por token, mas modelo antigo e pouco capaz para código.'}),
  // ── Cursor (informativo: o orquestrador ainda não tem adapter do Cursor) ──
  {id:'cursor/composer-2.5',vendor:'cursor',displayName:'Cursor Composer 2.5',tier:'economy',status:'current',input:0.5,cacheRead:0.2,output:2.5,executable:false,suitableFor:['developer'],note:'Modelo próprio do Cursor. Modelos de terceiros no Cursor são cobrados ao preço da API (tabelas Anthropic/OpenAI acima).'},
  {id:'cursor/composer-2.5-fast',vendor:'cursor',displayName:'Cursor Composer 2.5 (Fast)',tier:'balanced',status:'current',input:3,cacheRead:0.5,output:15,executable:false,suitableFor:['developer']},
  {id:'cursor/grok-4.7',vendor:'cursor',displayName:'Grok 4.7 (Cursor)',tier:'balanced',status:'current',input:2,cacheRead:0.5,output:6,executable:false,suitableFor:['developer']},
];

export const CURSOR_PLANS:{name:string;usdPerMonth:number|null;note:string}[]=[
  {name:'Pro',usdPerMonth:20,note:'Pools de uso incluídos (Cursor Models e Other Models); excedente a preço de API.'},
  {name:'Pro Plus',usdPerMonth:60,note:'Mesmos recursos do Pro com mais uso incluído.'},
  {name:'Ultra',usdPerMonth:200,note:'Maior uso incluído.'},
  {name:'Teams Standard',usdPerMonth:40,note:'Por usuário/mês. Taxa extra de US$ 0,25/M tokens em modelos de terceiros.'},
  {name:'Teams Premium',usdPerMonth:120,note:'Por usuário/mês (5x os limites do Standard).'},
];

/** Mescla um override (ex.: PRICING_FILE) sobre a tabela padrão, por `id`. Entradas inválidas são ignoradas. */
export function mergePricing(base:ModelPrice[],override:unknown):ModelPrice[]{
  if(!Array.isArray(override))return base;
  const map=new Map(base.map(item=>[item.id,item]));
  for(const item of override){
    if(!item||typeof item!=='object')continue;
    const entry=item as Partial<ModelPrice>;
    if(typeof entry.id!=='string'||!entry.id)continue;
    const current=map.get(entry.id);
    const merged={...(current||{vendor:'anthropic',displayName:entry.id,tier:'balanced',status:'current',executable:false,input:NaN,output:NaN}),...entry} as ModelPrice;
    if(!Number.isFinite(merged.input)||!Number.isFinite(merged.output)||merged.input<0||merged.output<0)continue;
    map.set(entry.id,merged);
  }
  return [...map.values()];
}

export function findPrice(table:ModelPrice[],model:string|undefined|null):ModelPrice|undefined{
  const wanted=String(model||'').trim().toLowerCase();
  if(!wanted)return undefined;
  return table.find(item=>item.id.toLowerCase()===wanted)
    ||table.find(item=>(item.aliases||[]).some(alias=>alias.toLowerCase()===wanted))
    // ids com sufixo de data, ex.: claude-haiku-4-5-20251001
    ||table.find(item=>wanted.startsWith(item.id.toLowerCase()+'-'));
}

/** Uso normalizado: `inputTokens` é só o que NÃO veio de cache (nas duas convenções, Anthropic e OpenAI). */
export interface TokenBreakdown{
  inputTokens:number;
  cacheWrite5mTokens?:number;
  cacheWrite1hTokens?:number;
  cacheReadTokens?:number;
  outputTokens:number;
  /** Maior prompt de uma única requisição, quando conhecido; ativa a faixa de contexto longo. */
  maxPromptTokens?:number;
  /** Número de requisições (turnos) que geraram estes totais; sem `maxPromptTokens`, o prompt médio = total de entrada / requests. */
  requests?:number;
}

export interface CostLine{label:string;tokens:number;ratePerMillion:number;usd:number;}
export interface CostResult{usd:number;lines:CostLine[];longContextApplied:boolean;}

const n=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:0;

export function computeCost(price:ModelPrice,usage:TokenBreakdown):CostResult{
  const totalInput=n(usage.inputTokens)+n(usage.cacheWrite5mTokens)+n(usage.cacheWrite1hTokens)+n(usage.cacheReadTokens);
  const prompt=n(usage.maxPromptTokens)||totalInput/Math.max(1,n(usage.requests)||1);
  const long=price.longContext&&prompt>price.longContext.thresholdTokens?price.longContext:undefined;
  const rate=(key:'input'|'cacheWrite5m'|'cacheWrite1h'|'cacheRead'|'output')=>{
    const longValue=long?(long as any)[key]:undefined;
    if(typeof longValue==='number')return longValue;
    const base=(price as any)[key];
    if(typeof base==='number')return base;
    // sem taxa própria de escrita de cache: cobra como entrada normal
    return key==='cacheWrite5m'||key==='cacheWrite1h'?(long?long.input:price.input):key==='cacheRead'?(long?long.input:price.input):price.output;
  };
  const rows:[string,number,number][]=[
    ['Entrada (sem cache)',n(usage.inputTokens),rate('input')],
    ['Escrita de cache (5 min)',n(usage.cacheWrite5mTokens),rate('cacheWrite5m')],
    ['Escrita de cache (1 h)',n(usage.cacheWrite1hTokens),rate('cacheWrite1h')],
    ['Leitura de cache',n(usage.cacheReadTokens),rate('cacheRead')],
    ['Saída',n(usage.outputTokens),rate('output')],
  ];
  const lines=rows.filter(row=>row[1]>0).map(([label,tokens,ratePerMillion])=>({label,tokens,ratePerMillion,usd:tokens*ratePerMillion/1_000_000}));
  return{usd:lines.reduce((sum,line)=>sum+line.usd,0),lines,longContextApplied:Boolean(long)};
}

/** Converte o `usage` do Codex/OpenAI (input_tokens inclui o cache) para o formato normalizado. */
export function openAiUsageToBreakdown(usage:{input_tokens?:number;cached_input_tokens?:number;output_tokens?:number}):TokenBreakdown{
  const input=n(usage.input_tokens),cached=Math.min(n(usage.cached_input_tokens),input);
  return{inputTokens:input-cached,cacheReadTokens:cached,outputTokens:n(usage.output_tokens),maxPromptTokens:input};
}
