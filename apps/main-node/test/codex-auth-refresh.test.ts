import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedHarnessCredentials } from "../../../packages/control-plane-node/src/lib/harness-credentials.js";
import { CODEX_REFRESH_INTERVAL_MS, createCodexAuthRefresher } from "../../../packages/control-plane-node/src/lib/codex-auth-refresh.js";
import { createNodeSecrets } from "../../../packages/control-plane-node/src/secrets.js";

class Store {
 rows = new Map<string,string>();
 async get(k:string){return this.rows.get(k)??null;}
 async delete(k:string){this.rows.delete(k);}
 async put(k:string,v:string){this.rows.set(k,v);}
 async list(o?:{prefix?:string}){return {keys:[...this.rows.keys()].filter(k=>k.startsWith(o?.prefix??'')).map(name=>({name})),list_complete:true};}
 async compareAndSwap(k:string,a:string|null,b:string|null){if((this.rows.get(k)??null)!==a)return false;if(b===null)this.rows.delete(k);else this.rows.set(k,b);return true;}
}
const at=Date.parse('2026-11-01T00:00:00Z');
const auth=(token:string,account='account-a')=>JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'synthetic-access-'+token,refresh_token:'synthetic-refresh-'+token,account_id:account},last_refresh:new Date(at).toISOString()});
const record={name:'账户',kind:'codex' as const,content:auth('old'),allowedAgentIds:['agent_a']};
function setup(){const kv=new Store();return {kv,manager:new EncryptedHarnessCredentials(kv,createNodeSecrets('test-only-refresh-root').cipherFor('platform.harness.credentials'))};}
const invoke=(id:string)=>({harness:'acp-sandbox',acp:{agent:{id:'codex-acp',command:'/usr/local/bin/maishu-harness',args:['codex'],env:{MAISHU_AUTH_MODE:'native',MAISHU_CREDENTIAL_REF:id}}}});
it('refreshes after six days, encrypts the result and preserves existing Session pins',async()=>{
 const {kv,manager}=setup(),saved=await manager.save('w',record),received:string[]=[];
 const box={exec:async()=>'',writeFileBytes:async(_p:string,b:Uint8Array)=>{received.push(new TextDecoder().decode(b));}} as never;
 const input={workspaceId:'w',agentId:'agent_a',sessionId:'old-session',agentConfig:invoke(saved.id),sandbox:box};
 await manager.materialize(input);
 const run=vi.fn(async()=>auth('new'));
 expect((await manager.refreshCodexDue(run,{now:at+CODEX_REFRESH_INTERVAL_MS-1}))[0]?.status).toBe('not_due');expect(run).not.toHaveBeenCalled();
 expect((await manager.refreshCodexDue(run,{now:at+CODEX_REFRESH_INTERVAL_MS}))[0]?.status).toBe('refreshed');
 expect(received).toEqual([auth('old')]);
 await manager.materialize(input);await manager.materialize({...input,sessionId:'new-session'});
 expect(received).toEqual([auth('old'),auth('old'),auth('new')]);
 expect(JSON.stringify([...kv.rows])).not.toContain('synthetic-refresh-');
 expect(JSON.stringify(await manager.list('w'))).not.toContain('synthetic-access-');
 expect((await manager.list('w'))[0]?.codexRefresh?.nextDueAt).toBe(new Date(at+2*CODEX_REFRESH_INTERVAL_MS).toISOString());
 expect((await manager.refreshCodexDue(run,{now:at+CODEX_REFRESH_INTERVAL_MS+100}))[0]?.status).toBe('not_due');expect(run).toHaveBeenCalledOnce();
});
it('keeps a concurrent grant/rename change and refuses to recreate a deleted login',async()=>{
 const {manager}=setup(),saved=await manager.save('w',record);
 expect((await manager.refreshCodexDue(async()=>{await manager.save('w',{...record,name:'重命名',allowWorkspace:true,expectedRevision:saved.revision},saved.id);return auth('new');},{force:true,now:at}))[0]?.status).toBe('refreshed');
 expect((await manager.list('w'))[0]).toMatchObject({name:'重命名',allowWorkspace:true});
 expect((await manager.refreshCodexDue(async()=>{await manager.remove('w',saved.id);return auth('third');},{force:true,now:at}))[0]?.status).toBe('superseded');
 expect(await manager.list('w')).toEqual([]);
});
it('does not overwrite a replacement login or accept a different refreshed account',async()=>{
 const {manager}=setup(),saved=await manager.save('w',record);
 expect((await manager.refreshCodexDue(async()=>{await manager.save('w',{...record,content:auth('manual'),expectedRevision:saved.revision},saved.id);return auth('new');},{force:true,now:at}))[0]?.status).toBe('superseded');
 expect((await manager.refreshCodexDue(async()=>auth('bad','different-account'),{force:true,now:at}))[0]?.status).toBe('failed');
 const again=vi.fn(async()=>auth('unused'));await manager.refreshCodexDue(again,{now:at+2*CODEX_REFRESH_INTERVAL_MS});expect(again).not.toHaveBeenCalled();
 expect(JSON.stringify(await manager.list('w'))).not.toContain('synthetic-');
});
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function fake(mode:string){
 const dir=await mkdtemp(join(tmpdir(),'maishu-refresh-test-'));dirs.push(dir);const binary=join(dir,'codex');
 const action=mode==='hang'?'return;':`
 const p=path.join(process.env.CODEX_HOME,'auth.json');const a=JSON.parse(fs.readFileSync(p,'utf8'));
 a.tokens.access_token='synthetic-access-rotated';a.tokens.refresh_token='synthetic-refresh-rotated';
 fs.writeFileSync(p,JSON.stringify(a));fs.appendFileSync(path.join(${JSON.stringify(dir)},'calls'),'x');
 ${mode==='lost'?"process.exit(0);":"process.stdout.write(JSON.stringify({id:m.id,result:{account:{type:'chatgpt'}}})+String.fromCharCode(10));"}`;
 await writeFile(binary,`#!/usr/bin/env node
const fs=require('fs'),path=require('path'),rl=require('readline').createInterface({input:process.stdin});
rl.on('line',l=>{const m=JSON.parse(l);
if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+String.fromCharCode(10));
if(m.method==='account/read'){${action}}});
`,{mode:0o700});
 return {dir,binary,refresh:createCodexAuthRefresher({binary,directory:join(dir,'homes'),timeoutMs:mode==='hang'?150:3000})};
}
it.each(['normal','lost'])('uses real JSONL RPC and recovers a persisted rotation without refreshing twice: %s',async(mode)=>{
 const f=await fake(mode),input={workspaceId:'w',id:'credential',content:auth('old')};
 const first=await f.refresh(input);expect(JSON.parse(first).tokens.refresh_token).toBe('synthetic-refresh-rotated');
 expect(await f.refresh(input)).toBe(first);expect(await readFile(join(f.dir,'calls'),'utf8')).toBe('x');
});
it('bounds a hung RPC and an executable startup failure without token-bearing errors',async()=>{
 const f=await fake('hang'),input={workspaceId:'w',id:'credential',content:auth('old')};
 await expect(f.refresh(input)).rejects.toThrow(/认证刷新失败/);
 const missing=createCodexAuthRefresher({binary:join(f.dir,'missing'),directory:join(f.dir,'other'),timeoutMs:150});
 await expect(missing(input)).rejects.toThrow(/认证刷新失败/);
});
