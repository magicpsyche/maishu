import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { MySqlContainer } from "@testcontainers/mysql";
import { openPostgresDatabase } from "../../../packages/node-database-postgres/src/index.js";
import { openMysqlDatabase } from "../../../packages/node-database-mysql/src/index.js";
import { createConsoleSandboxBackend } from "../../../packages/control-plane-node/src/lib/console-sandbox-backend.js";
import { createNodeSecrets } from "../../../packages/control-plane-node/src/secrets.js";
import { createPlatformSettingsStore } from "../../../packages/control-plane-node/src/lib/platform-settings-store.js";
import { EncryptedHarnessCredentials } from "../../../packages/control-plane-node/src/lib/harness-credentials.js";
import type { NodeDatabase } from "@open-managed-agents/node-database";
import type { SandboxProviderPort } from "@open-managed-agents/sandbox";

for (const kind of ["postgres", "mysql"] as const) describe(`${kind} sandbox backend persistence`, () => {
  let database: NodeDatabase;
  let container: { stop(): Promise<unknown> };
  const env = { OPENSANDBOX_DOMAIN: "old-host:8808", OPENSANDBOX_API_KEY: "storage-secret", OPENSANDBOX_RUNTIME: "docker" };
  const cipher = createNodeSecrets("storage-test-root-secret").cipherFor("platform.sandbox.backend");
  beforeAll(async () => {
    const server = kind === "postgres" ? await new PostgreSqlContainer("postgres:16-alpine").start() : await new MySqlContainer("mysql:8.4").start();
    container = server;
    database = await (kind === "postgres" ? openPostgresDatabase : openMysqlDatabase)({ url: server.getConnectionUri() });
    const keyColumn = kind === 'mysql' ? '`key`' : '"key"';
    await database.sql.exec(`CREATE TABLE kv_entries (tenant_id VARCHAR(255) NOT NULL, ${keyColumn} VARCHAR(255) NOT NULL, value TEXT NOT NULL, expires_at BIGINT, PRIMARY KEY (tenant_id, ${keyColumn}))`);
  });
  afterAll(async () => { await database?.stop?.(); await container?.stop(); });
  it("persists encrypted revisions and pins Sessions across replicas and restarts", async () => {
    const manager = createConsoleSandboxBackend(database, cipher, env, {} as SandboxProviderPort);
    const scope = { workspaceId: "w", sessionId: "before-update", workdir: "/workspace" };
    await manager.environmentFor(scope, false, {});
    const view = await manager.read();
    const next = await manager.save({ expectedRevision: view.revision, settings: { ...view.settings, domain: "new-host:8818" }, apiKey: "new-storage-secret" });
    const replica = createConsoleSandboxBackend(database, cipher, { ...env, OPENSANDBOX_DOMAIN: "wrong-host:9999" }, {} as SandboxProviderPort);
    expect((await replica.read()).revision).toBe(next.revision);
    expect((await replica.environmentFor(scope, true, {})).OPENSANDBOX_DOMAIN).toBe("old-host:8808");
    expect((await replica.environmentFor({ ...scope, sessionId: "new" }, false, {})).OPENSANDBOX_DOMAIN).toBe("new-host:8818");
    const rows = await database.sql.prepare('SELECT value FROM kv_entries').all<{ value: string }>();
    expect(JSON.stringify(rows)).not.toContain("storage-secret");
    const saves = await Promise.allSettled([manager, replica].map((m, i) => m.save({ expectedRevision: next.revision, settings: { ...next.settings, domain: `replica-${i}:8818` } })));
    expect(saves.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const store = createPlatformSettingsStore(database, "isolated-documents");
    await store.put("workspace:a%:item", "one");
    await store.put("workspace:ab:item", "two");
    expect((await store.list({ prefix: "workspace:a%:" })).keys.map(k => k.name)).toEqual(["workspace:a%:item"]);
    await store.delete("workspace:a%:item");
    expect(await store.get("workspace:a%:item")).toBeNull();
  });
  it("scopes encrypted account files, rotates with CAS and pins Session identity", async () => {
    const store = createPlatformSettingsStore(database, "account-files");
    const accounts = new EncryptedHarnessCredentials(store, cipher);
    const content = JSON.stringify({ tokens: { access_token: "synthetic-old-account-token" } });
    const saved = await accounts.save("tenant-a%", { name: "test", kind: "codex", content, allowedAgentIds: ["agent-a"] });
    expect((await accounts.list("tenant-a%"))[0].id).toBe(saved.id);
    expect(await accounts.list("tenant-ab")).toEqual([]);
    const received: string[] = [];
    const scope = { workspaceId: "tenant-a%", sessionId: "session-one", agentId: "agent-a",
      agentConfig: { harness: "acp-sandbox", acp: { agent: { id: "codex-acp", command: "/usr/local/bin/maishu-harness", args: ["codex"], env: { MAISHU_AUTH_MODE: "native", MAISHU_CREDENTIAL_REF: saved.id } } } },
      sandbox: { exec: async () => "", writeFileBytes: async (_path: string, bytes: Uint8Array) => { received.push(new TextDecoder().decode(bytes)); return ""; } } as never };
    await expect(accounts.materialize({ ...scope, workspaceId: "tenant-ab" })).rejects.toThrow();
    await accounts.materialize(scope);
    const rotated = await accounts.save("tenant-a%", { name: "test", kind: "codex", content: '{"tokens":{"access_token":"synthetic-new-account-token"}}', allowedAgentIds: ["agent-a"], expectedRevision: saved.revision }, saved.id);
    await accounts.materialize(scope);
    expect(received).toEqual([content, content]);
    await expect(accounts.save("tenant-a%", { name: "test", kind: "codex", expectedRevision: saved.revision }, saved.id)).rejects.toThrow();
    const revoked = await accounts.save("tenant-a%", { name: "test", kind: "codex", allowedAgentIds: [], expectedRevision: rotated.revision }, saved.id);
    expect(revoked.revision).not.toBe(rotated.revision);
    await expect(accounts.materialize(scope)).rejects.toThrow();
    await accounts.remove("tenant-a%", saved.id);
    expect(await accounts.list("tenant-a%")).toEqual([]);
  });
  it("automatically rotates Codex auth through shared CAS while preserving old Session pins", async () => {
    const kv = createPlatformSettingsStore(database, "codex-auto-refresh");
    const accounts = new EncryptedHarnessCredentials(kv, cipher);
    const content = (name: string) => JSON.stringify({auth_mode:"chatgpt",tokens:{access_token:"synthetic-access-"+name,refresh_token:"synthetic-refresh-"+name,account_id:"account-a"},last_refresh:"2026-01-01T00:00:00Z"});
    const saved = await accounts.save("workspace-a", {name:"refresh",kind:"codex",content:content("old"),allowedAgentIds:["agent-a"]});
    const received: string[] = [];
    const scope = {workspaceId:"workspace-a",agentId:"agent-a",sessionId:"old",agentConfig:{harness:"acp-sandbox",acp:{agent:{id:"codex-acp",command:"/usr/local/bin/maishu-harness",args:["codex"],env:{MAISHU_AUTH_MODE:"native",MAISHU_CREDENTIAL_REF:saved.id}}}},sandbox:{exec:async()=>"",writeFileBytes:async (_p:string,b:Uint8Array)=>{received.push(new TextDecoder().decode(b));}} as never};
    await accounts.materialize(scope);
    expect((await accounts.refreshCodexDue(async()=>content("new"),{force:true}))[0]?.status).toBe("refreshed");
    const restarted = new EncryptedHarnessCredentials(kv,cipher);
    await restarted.materialize(scope);await restarted.materialize({...scope,sessionId:"new"});
    expect(received).toEqual([content("old"),content("old"),content("new")]);
    expect((await restarted.list("workspace-a"))[0]?.codexRefresh?.status).toBe("ok");
    const rows = await database.sql.prepare('SELECT value FROM kv_entries').all<{value:string}>();
    expect(JSON.stringify(rows)).not.toContain("synthetic-refresh-");
    await expect(restarted.materialize({...scope,workspaceId:"workspace-b"})).rejects.toThrow();
  });

});
