import {existsSync,readFileSync} from 'node:fs';
import {DEFAULT_PRICING,computeCost,findPrice,mergePricing,type ModelPrice,type UsageDetail} from '@orchestrator/shared';

export type CostSource='computed'|'provider_reported'|'mixed'|'mock'|'unknown';

export interface ResolvedCost{
  usd:number|null;
  reportedUsd:number|null;
  source:CostSource;
  models:string[];
  /** O valor informado pelo provider diverge da tabela ou o provider marcou o preço como desconhecido. */
  mismatch:boolean;
  unknownModels:string[];
}

/** Tabela efetiva: padrão + override opcional (PRICING_FILE aponta para um JSON com entradas por `id`). */
export function loadPricing(env:NodeJS.ProcessEnv=process.env):ModelPrice[]{
  const file=env.PRICING_FILE;
  if(!file||!existsSync(file))return DEFAULT_PRICING;
  try{return mergePricing(DEFAULT_PRICING,JSON.parse(readFileSync(file,'utf8')));}catch{return DEFAULT_PRICING;}
}

/**
 * Custo de uma execução. Prioriza SEMPRE o cálculo por tokens × tabela oficial: o custo informado pelo
 * Claude Code é inexato para modelos que ele não conhece (costBasis "unknown" → observado 40x acima do real).
 */
export function resolveExecutionCost(input:{provider:string;model:string;result:{estimatedCost?:number;usageDetails?:UsageDetail[]}},table:ModelPrice[]):ResolvedCost{
  if(input.provider==='mock')return{usd:0,reportedUsd:0,source:'mock',models:[input.model],mismatch:false,unknownModels:[]};
  const details=input.result.usageDetails||[];
  if(!details.length){
    const reported=typeof input.result.estimatedCost==='number'?input.result.estimatedCost:null;
    return{usd:reported,reportedUsd:reported,source:reported===null?'unknown':'provider_reported',models:[input.model],mismatch:false,unknownModels:[]};
  }
  let computed=0,reportedTotal=0,anyReported=false,fallbackUsed=false,anyComputed=false,mismatch=false,unknownCount=0;
  const models:string[]=[],unknownModels:string[]=[];
  for(const detail of details){
    const model=detail.model||input.model;
    models.push(model);
    const price=findPrice(table,model);
    if(typeof detail.reportedUsd==='number'){reportedTotal+=detail.reportedUsd;anyReported=true;}
    if(price){
      const usd=computeCost(price,detail.breakdown).usd;
      computed+=usd;anyComputed=true;
      if(detail.costBasis&&detail.costBasis!=='list')mismatch=true;
      if(typeof detail.reportedUsd==='number'&&Math.abs(detail.reportedUsd-usd)>Math.max(0.0005,detail.reportedUsd*0.05))mismatch=true;
    }else{
      unknownModels.push(model);
      if(typeof detail.reportedUsd==='number'){computed+=detail.reportedUsd;fallbackUsed=true;}else unknownCount++;
    }
  }
  if(!anyComputed&&!fallbackUsed)return{usd:null,reportedUsd:anyReported?reportedTotal:null,source:'unknown',models,mismatch,unknownModels};
  const source:CostSource=!anyComputed?'provider_reported':fallbackUsed?'mixed':'computed';
  return{usd:computed,reportedUsd:anyReported?reportedTotal:null,source:unknownCount?'mixed':source,models,mismatch,unknownModels};
}
