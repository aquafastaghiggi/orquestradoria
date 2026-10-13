/** Providers que não consomem créditos. Qualquer outro (claude-code, codex-cli, anthropic, ...) é "real". */
const FREE_PROVIDERS=['mock','command-tester'];

export const isCostlyProvider=(provider?:string|null)=>Boolean(provider)&&!FREE_PROVIDERS.includes(String(provider));
export const isForceMock=(env:NodeJS.ProcessEnv=process.env)=>env.ORQ_FORCE_MOCK==='1';

export const PROVIDER_LABEL:Record<string,string>={'claude-code':'Claude Code','codex-cli':'Codex CLI',anthropic:'Anthropic API',mock:'Mock','command-tester':'Command Tester'};
const ROLE_LABEL:Record<string,string>={planner:'Planner',developer:'Developer',tester:'Tester',reviewer:'Reviewer',analyst:'Analyst'};

export interface ModeEntry{key:string;label:string;provider:string;model:string;costly:boolean;origin?:string;}
export interface RunMode{mode:'mock'|'real';forced:boolean;entries:ModeEntry[];costly:ModeEntry[];summary:string;}

/** Troca, só em memória, os providers pagos de um snapshot de task por mock (usado com ORQ_FORCE_MOCK=1). */
export function forceMockSnapshot<T extends {agentConfigs?:any[];providerSelection?:string}>(snapshot:T):T{
  const agentConfigs=(snapshot.agentConfigs||[]).map((config:any)=>isCostlyProvider(config.provider)?{...config,provider:'mock',model:'mock-fast',forcedMock:true}:config);
  const providerSelection=agentConfigs.length?agentConfigs.map((config:any)=>`${config.role}:${config.provider}/${config.model}`).join(','):snapshot.providerSelection;
  return{...snapshot,agentConfigs,providerSelection};
}

export function summarizeMode(input:{
  roles:{role:string;provider:string;model:string;origin?:string}[];
  missionPlanner:{provider:string;model:string};
  promptRefiner:{provider:string;model:string};
  forced:boolean;
}):RunMode{
  const entries:ModeEntry[]=[
    ...input.roles.map(item=>({key:item.role,label:ROLE_LABEL[item.role]||item.role,provider:item.provider,model:item.model,origin:item.origin,costly:isCostlyProvider(item.provider)})),
    {key:'missionPlanner',label:'Planner de missão',provider:input.missionPlanner.provider,model:input.missionPlanner.model,costly:isCostlyProvider(input.missionPlanner.provider)},
    {key:'promptRefiner',label:'Refinador de prompt',provider:input.promptRefiner.provider,model:input.promptRefiner.model,costly:isCostlyProvider(input.promptRefiner.provider)},
  ];
  const costly=entries.filter(entry=>entry.costly);
  const summary=costly.length?costly.map(entry=>`${entry.label}: ${PROVIDER_LABEL[entry.provider]||entry.provider} (${entry.model})`).join(' · '):'Nenhum provider pago em uso';
  return{mode:costly.length?'real':'mock',forced:input.forced,entries,costly,summary};
}
