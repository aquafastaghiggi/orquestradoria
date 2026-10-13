import type {NextFunction,Request,Response} from 'express';

/**
 * A API é local: escuta só em 127.0.0.1 e recusa qualquer outro Host/Origin. Sem isso, qualquer máquina da rede
 * (ou qualquer site aberto no navegador) poderia disparar tasks (gastando créditos), aplicar mudanças ou abrir o
 * seletor de pastas. Exceção explícita: ORQ_ALLOW_LAN=1 (não recomendado, a API não tem autenticação).
 */
const LOCAL_HOSTNAMES=new Set(['localhost','127.0.0.1','::1']);

export const lanAllowed=(env:NodeJS.ProcessEnv=process.env)=>env.ORQ_ALLOW_LAN==='1';

export function bindHost(env:NodeJS.ProcessEnv=process.env){return lanAllowed(env)?(env.HOST||'0.0.0.0'):'127.0.0.1';}

export function allowedOrigins(env:NodeJS.ProcessEnv=process.env){
  const ports=[...new Set(['5173','4173',String(env.PORT||4000),String(env.WEB_PORT||5173)])];
  const set=new Set<string>();
  for(const host of ['localhost','127.0.0.1'])for(const port of ports)set.add(`http://${host}:${port}`);
  for(const extra of String(env.ORQ_ALLOWED_ORIGINS||'').split(',').map(item=>item.trim()).filter(Boolean))set.add(extra);
  return set;
}

/** Requisições sem Origin (curl, scripts, o proxy do Vite em chamadas diretas) passam; navegadores sempre enviam Origin em POST/PUT/DELETE. */
export const isAllowedOrigin=(origin:string|undefined,env:NodeJS.ProcessEnv=process.env)=>!origin||allowedOrigins(env).has(origin)||lanAllowed(env);

export function hostnameOf(hostHeader:string|undefined){
  const value=String(hostHeader||'').trim().toLowerCase();
  if(value.startsWith('['))return value.slice(1,value.indexOf(']')); // [::1]:4000
  return value.split(':')[0];
}

export const isAllowedHost=(hostHeader:string|undefined,env:NodeJS.ProcessEnv=process.env)=>lanAllowed(env)||LOCAL_HOSTNAMES.has(hostnameOf(hostHeader));

export function securityMiddleware(env:NodeJS.ProcessEnv=process.env){
  return(req:Request,res:Response,next:NextFunction)=>{
    if(!isAllowedHost(req.headers.host,env))return res.status(403).json({code:'forbidden_host',error:'Acesso negado: esta API só aceita conexões locais (localhost).'});
    const origin=typeof req.headers.origin==='string'?req.headers.origin:undefined;
    if(origin!==undefined&&!isAllowedOrigin(origin,env))return res.status(403).json({code:'forbidden_origin',error:'Acesso negado: origem não permitida.'});
    next();
  };
}

export const corsOptions=(env:NodeJS.ProcessEnv=process.env)=>({origin:(origin:string|undefined,callback:(error:Error|null,allow?:boolean)=>void)=>callback(null,isAllowedOrigin(origin,env))});
