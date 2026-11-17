import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { MySqlContainer } from "@testcontainers/mysql";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openPostgresDatabase } from "../../../packages/node-database-postgres/src/index.js";
import { openMysqlDatabase } from "../../../packages/node-database-mysql/src/index.js";
import type { NodeDatabase } from "@open-managed-agents/node-database";
import type { SqlClient } from "@open-managed-agents/sql-client";
import { LocalFsBlobStore } from "@open-managed-agents/blob-store/adapters/local-fs";
import { NodeWorkWorkspaceCheckpoints, SqlWorkWorkspaceCheckpoints } from "../../../packages/control-plane-node/src/lib/work-workspace-checkpoints.js";
import { seedWorkspaceAuthority, workspaceSandbox, physical, scope, runtime, holderHash } from "./_helpers/work-workspace-checkpoint.fixture.js";

for (const dialect of ["postgres","mysql"] as const) describe(`${dialect} Work workspace authority`,()=>{
  let database: NodeDatabase;let container:{stop():Promise<unknown>};let root:string;
  beforeAll(async()=>{
    const server=dialect==="postgres"?await new PostgreSqlContainer("postgres:16-alpine").start():await new MySqlContainer("mysql:8.4").start();container=server;
    database=await(dialect==="postgres"?openPostgresDatabase:openMysqlDatabase)({url:server.getConnectionUri()});
    root=await mkdtemp(join(tmpdir(),"maishu-work-storage-"));
  });
  beforeEach(async()=>{await seedWorkspaceAuthority(database.sql,dialect);});
  afterAll(async()=>{await database?.stop?.();await container?.stop();if(root)await rm(root,{recursive:true,force:true});});
  it("commits a Work-owned LocalFs archive and restores into a fresh sandbox",async()=>{
    const blobs=new LocalFsBlobStore({baseDir:join(root,"blobs")});
    const source=await workspaceSandbox(join(root,"source"));await source.writeFile("/workspace/proof.txt",dialect+" persisted");
    await new NodeWorkWorkspaceCheckpoints({sql:database.sql,blobs,dialect}).prepare(scope,physical(source),async()=>{});
    const store=new SqlWorkWorkspaceCheckpoints(database.sql,dialect);expect((await store.load(scope.claim)).record?.workId).toBe("w");
    const fresh=await workspaceSandbox(join(root,"fresh"));
    await database.sql.prepare('UPDATE kv_entries SET value=? WHERE "key"=?').bind(JSON.stringify({phase:"running",handle:{...runtime,runtimeId:"new-runtime"}}),"session_sandbox_state:s").run();
    await new NodeWorkWorkspaceCheckpoints({sql:database.sql,blobs:new LocalFsBlobStore({baseDir:join(root,"blobs")}),dialect}).restore(physical(fresh,"new-runtime"));
    expect(await fresh.readFile("/workspace/proof.txt")).toBe(dialect+" persisted");
  });
  it("atomically rejects a successor claim at publication and leaves no candidate pointer",async()=>{
    let injected=false;
    const sql:SqlClient={prepare:q=>database.sql.prepare(q),exec:q=>database.sql.exec(q),batch:ss=>database.sql.batch(ss),batchChecked:async(ss,validate)=>{
      if(!injected){injected=true;await database.sql.exec("UPDATE managed_environment_work SET claim_generation=3");}
      return database.sql.batchChecked!(ss,validate);
    }};
    const service=new NodeWorkWorkspaceCheckpoints({sql,blobs:new LocalFsBlobStore({baseDir:join(root,"race-blobs")}),dialect});
    await expect(service.prepare(scope,physical(await workspaceSandbox(join(root,"race-source"))),async()=>{})).rejects.toThrow(/lost authority/);
    expect((await new SqlWorkWorkspaceCheckpoints(database.sql,dialect).load(scope.claim)).record).toBeNull();
  });
  it("keeps exact holder casing and rejects expired leases",async()=>{
    const store=new SqlWorkWorkspaceCheckpoints(database.sql,dialect);
    const candidate={id:"wsc_11111111-1111-1111-1111-111111111111",contentHash:`sha256:${"b".repeat(64)}`,revision:2};
    expect(await store.publish({scope:{...scope,claim:{...scope.claim,holder:"Worker"}},runtime,holderHash,candidate,expected:null})).toBe(false);
    expect(await store.publish({scope,runtime,holderHash,candidate,expected:null})).toBe(true);
    const previous=await store.load(scope.claim);await database.sql.exec("UPDATE managed_environment_work SET claim_at=0");
    expect(await store.publish({scope,runtime,holderHash,candidate:{...candidate,id:"wsc_next"},expected:previous.version})).toBe(false);
    expect(await store.load(scope.claim)).toEqual(previous);
  });
});
