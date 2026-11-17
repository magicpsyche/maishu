// Operator maintenance entrypoint; no HTTP server, sandbox, model call or token output.
import { resolve } from "node:path";
import { loadNodeConfig } from "./config.js";
import { openNodeDatabase } from "./database.js";
import { createNodeSecrets, createHarnessCredentials, createCodexAuthRefresher } from "@open-managed-agents/control-plane-node";

const config = loadNodeConfig(process.env);
if (!config.platformRootSecret) throw new Error("认证维护需要配置平台加密根密钥");
const database = await openNodeDatabase(config.database);
try {
  const accounts = createHarnessCredentials(database, createNodeSecrets(config.platformRootSecret));
  const refresh = createCodexAuthRefresher({
    binary: process.env.MAISHU_CODEX_BINARY ?? "/opt/maishu/tooling/codex/0.166.0/codex",
    directory: resolve(process.env.MAISHU_AUTH_REFRESH_DIR ?? "/var/lib/maishu/auth-refresh"),
  });
  const results = await accounts.refreshCodexDue(refresh, { force: process.argv.includes("--force") });
  console.log(JSON.stringify({ op: "maishu.codex_auth_refresh", intervalDays: 6, results }));
  if (results.some(r => r.status === "failed")) process.exitCode = 1;
} catch {
  console.error("麦枢 Codex 认证维护失败；请检查服务配置、网络或重新授权。");
  process.exitCode = 1;
} finally { await database.stop?.(); }
