import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedOrigins,bindHost,hostnameOf,isAllowedHost,isAllowedOrigin,securityMiddleware} from './security.js';

const env=(extra:Record<string,string>={})=>({...extra}) as NodeJS.ProcessEnv;

test('API binds to loopback only unless LAN is explicitly allowed',()=>{
  assert.equal(bindHost(env()),'127.0.0.1');
  assert.equal(bindHost(env({ORQ_ALLOW_LAN:'1'})),'0.0.0.0');
  assert.equal(bindHost(env({ORQ_ALLOW_LAN:'1',HOST:'192.168.0.5'})),'192.168.0.5');
});

test('only localhost hosts are accepted (blocks LAN access and DNS rebinding)',()=>{
  for(const host of ['localhost:4000','127.0.0.1:4000','[::1]:4000','LOCALHOST:5173','localhost'])assert.equal(isAllowedHost(host,env()),true,host);
  for(const host of ['192.168.0.20:4000','evil.com','evil.com:4000','localhost.evil.com:4000','attacker.localtest.me','',undefined])assert.equal(isAllowedHost(host as any,env()),false,String(host));
  assert.equal(hostnameOf('[::1]:4000'),'::1');
  assert.equal(isAllowedHost('192.168.0.20:4000',env({ORQ_ALLOW_LAN:'1'})),true);
});

test('browser origins are limited to the local web app; requests without Origin are allowed',()=>{
  assert.equal(isAllowedOrigin(undefined,env()),true);
  assert.equal(isAllowedOrigin('http://localhost:5173',env()),true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173',env()),true);
  assert.equal(isAllowedOrigin('http://localhost:4000',env()),true);
  for(const origin of ['https://evil.com','http://localhost:9999','http://192.168.0.20:5173','null','http://localhost.evil.com:5173'])assert.equal(isAllowedOrigin(origin,env()),false,origin);
  assert.equal(allowedOrigins(env({ORQ_ALLOWED_ORIGINS:'http://localhost:9999, https://x.dev'})).has('http://localhost:9999'),true);
  assert.equal(isAllowedOrigin('http://localhost:9999',env({ORQ_ALLOWED_ORIGINS:'http://localhost:9999'})),true);
});

test('middleware answers 403 for foreign hosts/origins and calls next for local ones',()=>{
  const run=(headers:Record<string,string>)=>{
    let status=0,body:any,nexted=false;
    const res:any={status(code:number){status=code;return res;},json(value:any){body=value;return res;}};
    securityMiddleware(env())({headers} as any,res,()=>{nexted=true;});
    return{status,body,nexted};
  };
  assert.equal(run({host:'localhost:4000'}).nexted,true);
  assert.equal(run({host:'localhost:4000',origin:'http://localhost:5173'}).nexted,true);
  const lan=run({host:'192.168.0.20:4000'});assert.equal(lan.status,403);assert.equal(lan.body.code,'forbidden_host');assert.equal(lan.nexted,false);
  const csrf=run({host:'localhost:4000',origin:'https://evil.com'});assert.equal(csrf.status,403);assert.equal(csrf.body.code,'forbidden_origin');
});
