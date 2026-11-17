import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { SqlClient } from "@open-managed-agents/sql-client";
import type { SandboxExecutor } from "@open-managed-agents/sandbox";
import type { WorkFinalizationScope } from "@open-managed-agents/managed-agents-application";
import { environmentWorkSandboxTokenRef } from "../../../../packages/sandbox-gateway-sql/src/index.js";
import type { WorkWorkspacePhysical } from "../../../../packages/control-plane-node/src/lib/work-workspace-checkpoints.js";

export const claim = {workspaceId:"ws",environmentId:"env",sessionId:"s",workId:"w",generation:2,holder:"worker"};
export const holderHash = "a".repeat(64);
export const scope: WorkFinalizationScope = {claim,turnId:"input",revision:3,isCurrent:async()=>true};
export const runtime = {provider:"opensandbox",runtimeId:"sandbox-1"};

export async function seedWorkspaceAuthority(sql: SqlClient, dialect: "sqlite"|"postgres"|"mysql") {
  const id = "VARCHAR(191)";
  const keyColumn = dialect === "mysql" ? '`key`' : '"key"';
  await sql.exec(`CREATE TABLE IF NOT EXISTS managed_sessions(workspace_id ${id},id ${id},document TEXT,revision BIGINT,created_at BIGINT,updated_at BIGINT,archived_at BIGINT,environment_id ${id},agent_id ${id},agent_version BIGINT,deployment_id ${id},status ${id},PRIMARY KEY(workspace_id,id));
    CREATE TABLE IF NOT EXISTS managed_environment_work(workspace_id ${id},environment_id ${id},id ${id},session_id ${id},state ${id},claim_generation BIGINT,claim_at BIGINT,heartbeat_ttl_seconds BIGINT,revision BIGINT,document TEXT,claim_worker_id ${id},created_at BIGINT,sandbox_token_hashes TEXT,PRIMARY KEY(workspace_id,id));
    CREATE TABLE IF NOT EXISTS managed_session_events(workspace_id ${id},session_id ${id},thread_id ${id},id ${id},type ${id},document TEXT,processed_at BIGINT,PRIMARY KEY(workspace_id,session_id,id));
    CREATE TABLE IF NOT EXISTS managed_session_initial_events(workspace_id ${id},session_id ${id},sequence BIGINT,document TEXT,PRIMARY KEY(workspace_id,session_id,sequence));
    CREATE TABLE IF NOT EXISTS kv_entries(tenant_id ${id},${keyColumn} ${id},value TEXT,expires_at BIGINT,PRIMARY KEY(tenant_id,${keyColumn}));`);
  for (const table of ["managed_sessions","managed_environment_work","managed_session_events","managed_session_initial_events","kv_entries"]) await sql.exec(`DELETE FROM ${table}`);
  await sql.prepare("INSERT INTO managed_sessions VALUES ('ws','s','{}',3,0,0,NULL,'env','agent',1,NULL,'running')").run();
  await sql.prepare("INSERT INTO managed_environment_work VALUES ('ws','env','w','s','active',2,?,90,1,'{}','worker',0,?)")
    .bind(Date.now(),JSON.stringify([{s:"all",h:holderHash}])).run();
  const event = {id:"input",type:"user.message",processedAt:new Date().toISOString(),content:[],
    source_position:{revision:2,index:0,consumed_by_execution_id:"input"}};
  await sql.prepare("INSERT INTO managed_session_events VALUES ('ws','s',NULL,'input','user.message',?,0)").bind(JSON.stringify(event)).run();
  await sql.prepare('INSERT INTO kv_entries VALUES (?, ?, ?, NULL)')
    .bind("ws","session_sandbox_state:s",JSON.stringify({phase:"running",handle:runtime,version:1})).run();
}

export async function workspaceSandbox(root: string): Promise<SandboxExecutor> {
  for (const part of ["workspace","tmp","var-tmp","oma"]) await mkdir(join(root,part),{recursive:true});
  const dirs: {[key:string]:string} = {"/workspace":"workspace","/var/tmp":"var-tmp","/tmp":"tmp","/oma":"oma"};
  const path = (text: string) => text.replace(/^(\/workspace|\/var\/tmp|\/tmp|\/oma)\b/, dir=>join(root,dirs[dir]!));
  return {
    exec: async command => {
      const rewritten=command.replace(/(\/workspace|\/var\/tmp|\/tmp|\/oma)\b/g,dir=>join(root,dirs[dir]!));
      const r=spawnSync("/bin/sh",["-c",rewritten],{encoding:"utf8",cwd:join(root,"workspace")});
      return r.status===0?r.stdout:`${r.stderr}[exit ${r.status}]`;
    },
    readFile: name=>readFile(path(name),"utf8"),
    readFileBytes: async name=>new Uint8Array(await readFile(path(name))),
    writeFile: async(name,content)=>{await mkdir(join(path(name),".."),{recursive:true});await writeFile(path(name),content);return name;},
    writeFileBytes: async(name,bytes)=>{await mkdir(join(path(name),".."),{recursive:true});await writeFile(path(name),bytes);return name;},
  } as SandboxExecutor;
}
export const physical = (sandbox: SandboxExecutor, runtimeId="sandbox-1", workClaim=claim): WorkWorkspacePhysical => ({workspaceId:"ws",environment:{id:"env"},session:{id:"s"},
  sandbox,runtimeGeneration:runtimeId,handle:{...runtime,runtimeId},
  workAuthority:{attempt:environmentWorkSandboxTokenRef(workClaim),holderHash,isCurrent:async()=>true},
} as WorkWorkspacePhysical);
