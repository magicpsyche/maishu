import type { BlobStore } from "@open-managed-agents/blob-store";
import type { SqlClient, SqlRunResult } from "@open-managed-agents/sql-client";
import type { SandboxExecutor } from "@open-managed-agents/sandbox";
import type { RuntimeResourceFence, WorkspaceCheckpointCandidate } from "@open-managed-agents/runtime-resource-contract";
import { SqlWorkFinalization } from "@open-managed-agents/managed-agents-adapters-sql";
import type {
  WorkFinalizationScope, WorkWorkspaceCheckpointPersistencePort,
  WorkWorkspaceCheckpointPublication, WorkWorkspaceCheckpointRecord,
} from "@open-managed-agents/managed-agents-application";
import type { NodeWorkStorageInput } from "./node-session-sandbox.js";
import { createNodeWorkspacePersistencePort } from "./node-managed-workspace-checkpoints.js";

type Candidate = WorkspaceCheckpointCandidate;
type Record = WorkWorkspaceCheckpointRecord<Candidate>;
export type WorkWorkspacePhysical = NodeWorkStorageInput & { handle: { provider: string; runtimeId: string } };
type Dialect = "sqlite" | "postgres" | "mysql";
const key = (sessionId: string) => `work_workspace_checkpoint:${encodeURIComponent(sessionId)}`;
const empty = "null";
const sameRuntime = (a: Record["runtime"], b: Record["runtime"]) => a.provider === b.provider && a.runtimeId === b.runtimeId;

/** Storage adapter for the Work-owned domain publication port. The empty KV row
 * is only a CAS slot; no SessionExecution row or lease is created. */
export class SqlWorkWorkspaceCheckpoints implements WorkWorkspaceCheckpointPersistencePort<Candidate> {
  constructor(private readonly sql: SqlClient, private readonly dialect: Dialect) {
    if (!sql.batchChecked) throw new Error("Work workspace checkpoints require checked SQL transactions");
  }
  private get clock() {
    return this.dialect === "postgres" ? "floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint"
      : this.dialect === "mysql" ? "floor(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000)"
      : "(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
  }
  async load(scope: {workspaceId: string; sessionId: string}) {
    const row = await this.sql.prepare('SELECT value FROM kv_entries WHERE tenant_id=? AND "key"=?')
      .bind(scope.workspaceId, key(scope.sessionId)).first<{value: string}>();
    if (!row || row.value === empty) return {record: null, version: null};
    const record = JSON.parse(row.value) as Record;
    if (record?.version !== 1 || !/^wsc_[A-Za-z0-9-]+$/.test(record.candidate?.id ?? "")
      || !/^sha256:[a-f0-9]{64}$/.test(record.candidate?.contentHash ?? "")
      || !record.turnId || !record.workId || !Number.isSafeInteger(record.generation) || record.generation < 1
      || !Number.isSafeInteger(record.revision) || record.revision < 0 || !record.runtime?.provider || !record.runtime.runtimeId) {
      throw new Error("Invalid canonical Work workspace checkpoint");
    }
    return {record, version: row.value};
  }
  async publish(input: WorkWorkspaceCheckpointPublication<Candidate>): Promise<boolean> {
    const {scope, runtime, candidate} = input;
    const c = scope.claim;
    if (!/^[a-f0-9]{64}$/.test(input.holderHash)) throw new Error("Work checkpoint holder is required");
    const state = await new SqlWorkFinalization(this.sql, {dialect: this.dialect}).inspect(scope);
    if (state.type !== "current" || !state.consumed || state.terminal !== null || state.revision < scope.revision) return false;
    const raw = await this.sql.prepare('SELECT value FROM kv_entries WHERE tenant_id=? AND "key"=?')
      .bind(c.workspaceId, `session_sandbox_state:${c.sessionId}`).first<{value: string}>();
    const physical = raw && JSON.parse(raw.value);
    if (!physical || physical.phase !== "running" || !sameRuntime(physical.handle, runtime)) return false;
    const held = await this.sql.prepare('SELECT sandbox_token_hashes FROM managed_environment_work WHERE workspace_id=? AND environment_id=? AND session_id=? AND id=? AND claim_generation=?')
      .bind(c.workspaceId,c.environmentId,c.sessionId,c.workId,c.generation).first<{sandbox_token_hashes:string|null}>();
    const hashes: unknown = JSON.parse(held?.sandbox_token_hashes ?? "[]");
    if (!Array.isArray(hashes) || hashes.filter(h => h?.s === "all").length !== 1
      || !hashes.some(h => h?.s === "all" && h?.h === input.holderHash)) return false;
    const next: Record = {version:1,candidate,workId:c.workId,generation:c.generation,turnId:scope.turnId,
      revision:state.revision,runtime};
    await this.sql.prepare('INSERT INTO kv_entries (tenant_id,"key",value,expires_at) VALUES (?,?,?,NULL) ON CONFLICT (tenant_id,"key") DO NOTHING')
      .bind(c.workspaceId,key(c.sessionId),empty).run();
    const workWhere = `workspace_id=? AND environment_id=? AND session_id=? AND id=? AND claim_generation=?
      AND ${this.dialect === "mysql" ? "BINARY claim_worker_id=BINARY ?" : "claim_worker_id=?"}
      AND sandbox_token_hashes=? AND state IN ('starting','active','stopping')
      AND claim_at IS NOT NULL AND claim_at+heartbeat_ttl_seconds*1000>${this.clock}`;
    const workArgs = [c.workspaceId,c.environmentId,c.sessionId,c.workId,c.generation,c.holder,held!.sandbox_token_hashes!];
    const sessionWhere = "workspace_id=? AND environment_id=? AND id=? AND revision=? AND archived_at IS NULL";
    const sessionArgs = [c.workspaceId,c.environmentId,c.sessionId,state.revision];
    const lock = (table: string, column: string, where: string) => this.dialect === "mysql"
      ? `SELECT ${column} FROM ${table} WHERE ${where} FOR UPDATE`
      : `UPDATE ${table} SET ${column}=${column} WHERE ${where}`;
    const statements = [
      this.sql.prepare(lock("managed_sessions","revision",sessionWhere)).bind(...sessionArgs),
      this.sql.prepare(lock("managed_environment_work","claim_generation",workWhere)).bind(...workArgs),
      this.sql.prepare(lock("kv_entries","value",'tenant_id=? AND "key"=? AND value=?'))
        .bind(c.workspaceId,`session_sandbox_state:${c.sessionId}`,raw!.value),
      this.sql.prepare(`UPDATE kv_entries SET value=? WHERE tenant_id=? AND "key"=? AND value=?
        AND EXISTS (SELECT 1 FROM managed_sessions WHERE ${sessionWhere})
        AND EXISTS (SELECT 1 FROM managed_environment_work WHERE ${workWhere})`)
        .bind(JSON.stringify(next),c.workspaceId,key(c.sessionId),input.expected ?? empty,...sessionArgs,...workArgs),
    ];
    const conflict = new Error("Work workspace publication authority changed");
    try {
      await this.sql.batchChecked!(statements, rows => {
        const locked = (r: SqlRunResult<unknown> | undefined) => this.dialect === "mysql" ? r?.results?.length === 1 : r?.meta.changes === 1;
        if (!rows.slice(0,3).every(locked) || rows[3]?.meta.changes !== 1) throw conflict;
      });
      return true;
    } catch (error) { if (error === conflict) return false; throw error; }
  }
}

/** Physical archive orchestration. The existing Work safe point calls prepare;
 * only a newly acquired sandbox invokes restore before any native process starts. */
export class NodeWorkWorkspaceCheckpoints {
  private readonly persistence: WorkWorkspaceCheckpointPersistencePort<Candidate>;
  constructor(private readonly deps: {sql: SqlClient; blobs: BlobStore; dialect: Dialect}) {
    this.persistence = new SqlWorkWorkspaceCheckpoints(deps.sql,deps.dialect);
  }
  private async assertPhysical(physical: WorkWorkspacePhysical): Promise<void> {
    if (!await physical.workAuthority.isCurrent()) throw new Error("Work workspace authority lost");
    const row = await this.deps.sql.prepare('SELECT value FROM kv_entries WHERE tenant_id=? AND "key"=?')
      .bind(physical.workspaceId,`session_sandbox_state:${physical.session.id}`).first<{value:string}>();
    const state = row && JSON.parse(row.value);
    if (!state || state.phase !== "running" || !sameRuntime(state.handle,physical.handle)) throw new Error("Work workspace physical runtime changed");
  }
  private async context(physical: WorkWorkspacePhysical, phase: "restore" | "publish", publicationHolder?: string) {
    const a = physical.workAuthority.attempt;
    if (!physical.workAuthority.holderHash) throw new Error("Work workspace holder required");
    await this.assertPhysical(physical);
    const holder = phase === "restore" ? physical.workAuthority.claimHolder : publicationHolder;
    if (!holder) throw new Error("Work workspace reservation owner required");
    // Poll reserves queued Work before the management process can ACK it. Only
    // restore accepts that reservation; publication still requires a consumed turn.
    const states = phase === "restore" ? "'queued','starting','active'" : "'starting','active','stopping'";
    const clock = this.deps.dialect === "postgres" ? "floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint"
      : this.deps.dialect === "mysql" ? "floor(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000)"
      : "(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
    const row = await this.deps.sql.prepare(`SELECT w.claim_worker_id,w.claim_at,w.heartbeat_ttl_seconds,w.sandbox_token_hashes FROM managed_environment_work w
      WHERE w.workspace_id=? AND w.environment_id=? AND w.session_id=? AND w.id=? AND w.claim_generation=? AND w.state IN (${states})
      AND ${this.deps.dialect === "mysql" ? "BINARY w.claim_worker_id=BINARY ?" : "w.claim_worker_id=?"}
      AND w.claim_at IS NOT NULL AND w.claim_at+w.heartbeat_ttl_seconds*1000>${clock}
      AND EXISTS (SELECT 1 FROM managed_sessions s WHERE s.workspace_id=w.workspace_id AND s.id=w.session_id
        AND s.environment_id=w.environment_id AND s.archived_at IS NULL)`)
      .bind(physical.workspaceId,physical.environment.id,physical.session.id,a.executionId,a.generation,holder)
      .first<{claim_worker_id:string;claim_at:number;heartbeat_ttl_seconds:number;sandbox_token_hashes:string|null}>();
    const hashes: unknown = JSON.parse(row?.sandbox_token_hashes ?? "[]");
    if (!row || !Array.isArray(hashes) || hashes.filter(h=>h?.s==="all").length !== 1
      || !hashes.some(h=>h?.s==="all" && h?.h===physical.workAuthority.holderHash)) throw new Error("Work workspace claim unavailable");
    const scope = {workspaceId:physical.workspaceId,environmentId:physical.environment.id,sessionId:physical.session.id,workId:a.executionId};
    const fence: RuntimeResourceFence = {...scope,ownerId:row.claim_worker_id,generation:a.generation,token:physical.workAuthority.holderHash,
      expiresAt:new Date(Number(row.claim_at)+Number(row.heartbeat_ttl_seconds)*1000).toISOString()};
    return {scope,fence};
  }
  async prepare(scope: WorkFinalizationScope, physical: WorkWorkspacePhysical, assertCurrent: () => Promise<void>): Promise<void> {
    await assertCurrent();
    const {scope: resource,fence} = await this.context(physical,"publish",scope.claim.holder);
    if (scope.claim.workspaceId !== resource.workspaceId || scope.claim.sessionId !== resource.sessionId
      || scope.claim.environmentId !== resource.environmentId || scope.claim.workId !== resource.workId
      || scope.claim.generation !== fence.generation || scope.claim.holder !== fence.ownerId) throw new Error("Work workspace scope mismatch");
    const previous = await this.persistence.load(resource);
    if (previous.record?.workId === scope.claim.workId && previous.record.generation === scope.claim.generation
      && previous.record.turnId === scope.turnId && sameRuntime(previous.record.runtime,physical.handle)) {
      await assertCurrent(); return;
    }
    const port = createNodeWorkspacePersistencePort(physical.sandbox as SandboxExecutor,this.deps.blobs);
    const signal = new AbortController().signal;
    const binding = await port.materialize({scope:resource,fence,strategy:"checkpoint_restore",activeCheckpoint:null,idempotencyKey:scope.turnId,signal});
    try {
      const candidate = await port.checkpoint({scope:resource,fence,strategy:"checkpoint_restore",binding,sandbox:physical.handle,idempotencyKey:scope.turnId,signal});
      await assertCurrent();
      if (!await this.persistence.publish({scope,holderHash:physical.workAuthority.holderHash!,runtime:physical.handle,candidate,expected:previous.version})) {
        throw new Error("Work workspace checkpoint publication lost authority or canonical pointer");
      }
      await assertCurrent();
    } finally { await port.release({scope:resource,fence,binding}); }
  }
  async restore(physical: WorkWorkspacePhysical): Promise<void> {
    const {scope,fence} = await this.context(physical,"restore");
    const previous = await this.persistence.load(scope);
    if (previous.record === null) return;
    const port = createNodeWorkspacePersistencePort(physical.sandbox as SandboxExecutor,this.deps.blobs);
    const signal = new AbortController().signal;
    const binding = await port.materialize({scope,fence,strategy:"checkpoint_restore",activeCheckpoint:previous.record.candidate,idempotencyKey:physical.runtimeGeneration,signal});
    try {
      await port.attach({scope,fence,strategy:"checkpoint_restore",binding,sandbox:physical.handle,signal});
      await this.assertPhysical(physical);
      if ((await this.persistence.load(scope)).version !== previous.version) throw new Error("Canonical Work workspace changed during restore");
    } finally { await port.release({scope,fence,binding}); }
  }
}
