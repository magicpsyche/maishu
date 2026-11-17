import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBetterSqlite3SqlClient, type SqlClient } from "@open-managed-agents/sql-client";
import { LocalFsBlobStore } from "@open-managed-agents/blob-store/adapters/local-fs";
import { prepareAcpSandboxAgent } from "@open-managed-agents/acp-runtime";
import { createAcpNativeSessionState } from "../../../packages/harness-runtime-acp/src/node.js";
import type { SandboxExecutor } from "@open-managed-agents/sandbox";
import { NodeWorkWorkspaceCheckpoints, SqlWorkWorkspaceCheckpoints } from "../../../packages/control-plane-node/src/lib/work-workspace-checkpoints.js";
import { createNodeWorkFinalizationHost } from "../../../packages/control-plane-node/src/lib/work-finalization-host/index.js";
import type { NodeSessionSandboxes } from "../../../packages/control-plane-node/src/lib/node-session-sandbox.js";
import { seedWorkspaceAuthority, workspaceSandbox, physical, scope, runtime, holderHash } from "./_helpers/work-workspace-checkpoint.fixture.js";
const roots: string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{force:true,recursive:true})));});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"maishu-work-checkpoint-"));roots.push(root);
  const sql=await createBetterSqlite3SqlClient(":memory:");await seedWorkspaceAuthority(sql,"sqlite");
  const blobs=new LocalFsBlobStore({baseDir:join(root,"blobs")});
  const sandbox=await workspaceSandbox(join(root,"source"));
  const service=new NodeWorkWorkspaceCheckpoints({sql,blobs,dialect:"sqlite"});
  const store=new SqlWorkWorkspaceCheckpoints(sql,"sqlite");
  return {root,sql,blobs,sandbox,service,store};
}
const candidate={id:"wsc_11111111-1111-1111-1111-111111111111",contentHash:`sha256:${"b".repeat(64)}`,revision:2};
const publication={scope,runtime,holderHash,candidate,expected:null};
const nativeState=(sandbox:SandboxExecutor)=>createAcpNativeSessionState({
  harness:{id:"codex-acp",version:"1.8.0"},
  io:{readFile:path=>sandbox.readFile(path),writeFile:async(path,content)=>{await sandbox.writeFile(path,content);},
    writeFileBytes:async(path,content)=>{await sandbox.writeFileBytes!(path,content);},exec:command=>sandbox.exec(command)},
  resolveSession:async()=>({agent:{id:"codex-acp",command:"/usr/local/bin/maishu-harness",args:["codex"]}}),
});
const nativeStart={type:"session.start" as const,sessionId:"s",agentId:"codex-acp",runtime:"cloud" as const};

describe("Work-owned portable workspace checkpoint",()=>{
  it("restores LocalFs files and native allowlist into a new sandbox without credentials",async()=>{
    const f=await fixture();await f.sandbox.writeFile("/workspace/project.txt","saved project bytes");
    const plan=prepareAcpSandboxAgent({sessionId:"s",agent:{id:"codex-acp",command:"/usr/local/bin/maishu-harness",args:["codex"]}});
    const initialNative=nativeState(f.sandbox);await initialNative.beforeStart(nativeStart);
    await initialNative.onReady({type:"session.ready",sessionId:"s",acpSessionId:"native-original"});
    await f.sandbox.writeFile(plan.binding.nativePath+"/sessions/one.jsonl",'{"conversation":"saved"}');
    await f.sandbox.writeFile(plan.binding.nativePath+"/auth.json",'SYNTHETIC_AUTH_MUST_STAY_PRIVATE');
    await initialNative.checkpoint({sessionId:"s",turnId:"input"});
    await f.service.prepare(scope,physical(f.sandbox),async()=>{});
    const saved=await f.store.load(scope.claim);expect(saved.record?.turnId).toBe("input");
    const archiveKey=saved.record!.candidate.metadata!["openma.workspace.blob-key.v1"] as string;
    expect(await (await f.blobs.get(archiveKey))!.text()).not.toContain("SYNTHETIC_AUTH_MUST_STAY_PRIVATE");
    const fresh=await workspaceSandbox(join(f.root,"fresh"));
    await f.sql.prepare('UPDATE kv_entries SET value=? WHERE "key"=?').bind(JSON.stringify({phase:"running",handle:{...runtime,runtimeId:"sandbox-2"}}),"session_sandbox_state:s").run();
    await f.sql.exec("UPDATE managed_environment_work SET claim_generation=3,claim_worker_id='worker-next',state='queued'");
    await new NodeWorkWorkspaceCheckpoints({sql:f.sql,blobs:new LocalFsBlobStore({baseDir:join(f.root,"blobs")}),dialect:"sqlite"})
      .restore(physical(fresh,"sandbox-2",{...scope.claim,generation:3,holder:"worker-next"}));
    expect(await nativeState(fresh).beforeStart({...nativeStart,canonicalCompletedTurnId:"input"}))
      .toEqual({command:{...nativeStart,acpSessionId:"native-original"}});
    expect(await fresh.readFile("/workspace/project.txt")).toBe("saved project bytes");
    expect(await fresh.readFile(plan.binding.sessionArtifacts[0]!.path+"/one.jsonl")).toContain("saved");
    await expect(fresh.readFile(plan.binding.nativePath+"/auth.json")).rejects.toThrow();
    expect(await f.sql.prepare("SELECT name FROM sqlite_master WHERE name='managed_session_executions'").first()).toBeNull();
  });
  it.each([false,true])("wires the safe Work host barrier and stops before native snapshot on failure=%s",async fail=>{
    const f=await fixture();const trace:string[]=[];const p=physical(f.sandbox);
    const facade={boundToWorkAttempt:()=>true,captureWork:async()=>p};
    const sandboxes={get:()=>facade,synchronizeReconnectedWork:async()=>{trace.push("sync");},
      checkpointNativeWork:async()=>{trace.push("native");}} as unknown as NodeSessionSandboxes;
    const host=await createNodeWorkFinalizationHost({sql:f.sql,dialect:"sqlite",blobs:f.blobs,sandboxes,afterExecution:async()=>{},
      workspaceCheckpoints:{prepare:async(s,p,assert)=>{trace.push("workspace");
        if(fail)await f.sql.exec("UPDATE managed_environment_work SET claim_generation=3");
        await f.service.prepare(s,p,assert);
      }},
    });
    if(fail){await expect(host.prepare(scope)).rejects.toThrow();expect(trace).toEqual(["sync","workspace"]);expect((await f.store.load(scope.claim)).record).toBeNull();}
    else{expect(await host.prepare(scope)).toEqual({type:"prepared"});expect(trace).toEqual(["sync","workspace","native"]);expect((await f.store.load(scope.claim)).record?.turnId).toBe("input");}
  });
  it("accepts a fully reserved queued restore while publication still rejects queued Work",async()=>{
    const f=await fixture();await f.sql.exec("UPDATE managed_environment_work SET state='queued'");
    await expect(f.service.restore(physical(f.sandbox))).resolves.toBeUndefined();
    await expect(f.service.prepare(scope,physical(f.sandbox),async()=>{})).rejects.toThrow(/claim unavailable/);
    expect(await f.store.publish(publication)).toBe(false);
  });
  it.each(["unclaimed","owner","holder-hash","expired","stopping","archived","generation","physical","callback"])("rejects queued restore with %s",async how=>{
    const f=await fixture();await f.sql.exec("UPDATE managed_environment_work SET state='queued'");
    if(how==="unclaimed")await f.sql.exec("UPDATE managed_environment_work SET claim_at=NULL,claim_worker_id=NULL");
    if(how==="owner")await f.sql.exec("UPDATE managed_environment_work SET claim_worker_id='Worker'");
    if(how==="holder-hash")await f.sql.exec("UPDATE managed_environment_work SET sandbox_token_hashes='[]'");
    if(how==="expired")await f.sql.exec("UPDATE managed_environment_work SET claim_at=0");
    if(how==="stopping")await f.sql.exec("UPDATE managed_environment_work SET state='stopping'");
    if(how==="archived")await f.sql.exec("UPDATE managed_sessions SET archived_at=1");
    if(how==="generation")await f.sql.exec("UPDATE managed_environment_work SET claim_generation=3");
    const p=physical(f.sandbox,how==="physical"?"wrong-runtime":"sandbox-1");
    if(how==="callback")p.workAuthority.isCurrent=async()=>false;
    await expect(f.service.restore(p)).rejects.toThrow(/Work workspace/);
    expect((await f.store.load(scope.claim)).record).toBeNull();
  });
  it("does not publish twice for the same quiescent Work turn",async()=>{
    const f=await fixture();await f.service.prepare(scope,physical(f.sandbox),async()=>{});
    const initial=await f.store.load(scope.claim);await f.service.prepare(scope,physical(f.sandbox),async()=>{});
    expect(await f.store.load(scope.claim)).toEqual(initial);
  });
  it.each(["missing","corrupt"])("fails closed for a %s archive",async how=>{
    const f=await fixture();await f.service.prepare(scope,physical(f.sandbox),async()=>{});
    const saved=(await f.store.load(scope.claim)).record!;const key=saved.candidate.metadata!["openma.workspace.blob-key.v1"] as string;
    if(how==="missing")await f.blobs.delete(key);else await f.blobs.put(key,"corrupt");
    await f.sql.prepare('UPDATE kv_entries SET value=? WHERE "key"=?').bind(JSON.stringify({phase:"running",handle:{...runtime,runtimeId:"new"}}),"session_sandbox_state:s").run();
    await expect(f.service.restore(physical(await workspaceSandbox(join(f.root,"replacement")),"new"))).rejects.toThrow(/missing|corrupt/);
  });
  it.each(["generation","holder","expired","runtime","turn","stale-pointer"])("rejects %s authority without replacing the canonical pointer",async change=>{
    const f=await fixture();expect(await f.store.publish(publication)).toBe(true);const before=await f.store.load(scope.claim);
    if(change==="generation")await f.sql.exec("UPDATE managed_environment_work SET claim_generation=3");
    if(change==="holder")await f.sql.exec("UPDATE managed_environment_work SET claim_worker_id='Worker'");
    if(change==="expired")await f.sql.exec("UPDATE managed_environment_work SET claim_at=0");
    if(change==="runtime")await f.sql.prepare('UPDATE kv_entries SET value=? WHERE "key"=?').bind(JSON.stringify({phase:"running",handle:{...runtime,runtimeId:"other"}}),"session_sandbox_state:s").run();
    const next={...publication,candidate:{...candidate,id:"wsc_22222222-2222-2222-2222-222222222222"},expected:change==="stale-pointer"?null:before.version,scope:change==="turn"?{...scope,turnId:"unconsumed"}:scope};
    expect(await f.store.publish(next)).toBe(false);expect(await f.store.load(scope.claim)).toEqual(before);
  });
  it.each(["claim","holder","lease","revision","runtime"])("rechecks %s inside the atomic publication transaction",async change=>{
    const f=await fixture();let injected=false;
    const sql:SqlClient={prepare:q=>f.sql.prepare(q),exec:q=>f.sql.exec(q),batch:ss=>f.sql.batch(ss),batchChecked:async(ss,validate)=>{if(!injected){injected=true;
      if(change==="claim")await f.sql.exec("UPDATE managed_environment_work SET claim_generation=3");
      if(change==="holder")await f.sql.exec("UPDATE managed_environment_work SET claim_worker_id='next'");
      if(change==="lease")await f.sql.exec("UPDATE managed_environment_work SET claim_at=0");
      if(change==="revision")await f.sql.exec("UPDATE managed_sessions SET revision=4");
      if(change==="runtime")await f.sql.prepare('UPDATE kv_entries SET value=? WHERE "key"=?').bind(JSON.stringify({phase:"running",handle:{...runtime,runtimeId:"successor"}}),"session_sandbox_state:s").run();
    }return f.sql.batchChecked!(ss,validate);}};
    expect(await new SqlWorkWorkspaceCheckpoints(sql,"sqlite").publish(publication)).toBe(false);
    expect((await f.store.load(scope.claim)).record).toBeNull();
    if(change==="claim")expect(await f.sql.prepare("SELECT claim_generation FROM managed_environment_work").first()).toEqual({claim_generation:3});
  });
});
