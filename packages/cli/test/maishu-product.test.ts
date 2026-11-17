import { beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { humanText } from "../src/human-text.js";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const bundle = join(root, "packages/cli/dist/maishu.js");
beforeAll(async () => { await exec(process.execPath, [join(root, "packages/cli/scripts/build-maishu.mjs"), "--output-dir", join(root, "work/cli-downloads"), "--base-url", "http://127.0.0.1:8797"]); });

describe("Maishu product CLI", () => {
  it("only translates explicit human messages; JSON and upstream bypass it", () => {
    const previous = process.env.MAISHU_CLI;
    try {
      process.env.MAISHU_CLI = "0"; expect(humanText("Message sent.")).toBe("Message sent.");
      process.env.MAISHU_CLI = "1"; expect(humanText("Message sent.")).toBe("指令已发送。");
      expect(humanText("customer document: oma is the project name")).toBe("customer document: oma is the project name");
      process.argv.push("--json"); try { expect(humanText("Message sent.")).toBe("Message sent."); } finally { process.argv.pop(); }
    } finally { if (previous === undefined) delete process.env.MAISHU_CLI; else process.env.MAISHU_CLI = previous; }
  });
  it("shows command-specific Chinese help without an API connection", async () => {
    expect((await exec(process.execPath, [bundle, "sessions", "--help"])).stdout).toContain("会话与任务");
  });
  it("preserves JSON/customer data and uses branded API aliases", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url!); res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.url?.startsWith("/v1/agents") ? { data: [{ id: "a", name: "Message sent.", model: "oma-user-model", created_at: "2026-11-17" }] } : { user: { id: "u", email: "server" }, tenant: { id: "w", name: "Auth" }, tenants: [] }));
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address() as { port: number };
      const options = { env: { ...process.env, MAISHU_BASE_URL: `http://127.0.0.1:${address.port}`, MAISHU_API_KEY: "synthetic-key" } };
      const agents = await exec(process.execPath, [bundle, "agents", "list", "--json"], options);
      expect(JSON.parse(agents.stdout).data[0].name).toBe("Message sent.");
      const me = await exec(process.execPath, [bundle, "whoami", "--json"], options);
      expect(JSON.parse(me.stdout).tenant.name).toBe("Auth"); expect(seen).toContain("/v1/maishu/me");
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  });
  it("installs with checksum, quotes paths, and preserves unrelated commands", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "maishu install ' "));
    const binary = await readFile(join(root, "work/cli-downloads/maishu.mjs"));
    const sums = await readFile(join(root, "work/cli-downloads/SHA256SUMS"));
    let corrupt = false;
    const server = createServer((req, res) => { if (req.url === "/downloads/maishu.mjs") res.end(corrupt ? "corrupt" : binary); else if (req.url === "/downloads/SHA256SUMS") res.end(sums); else { res.statusCode = 404; res.end(); } });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const options = { env: { ...process.env, MAISHU_INSTALL_ROOT: join(temporary, "cli"), MAISHU_BIN_DIR: join(temporary, "bin") } };
    try {
      await exec("sh", [join(root, "deploy/maishu/cli/install.sh"), "--server-url", origin], options);
      const command = join(temporary, "bin/maishu");
      expect((await exec(command, ["--help"], options)).stdout).toContain("麦枢命令行");
      expect(await readFile(command, "utf8")).toContain(origin);
      corrupt = true;
      await expect(exec("sh", [join(root, "deploy/maishu/cli/install.sh"), "--server-url", origin], options)).rejects.toThrow();
      expect(await readFile(join(temporary, "cli/maishu.mjs"))).toEqual(binary);
      corrupt = false;
      await writeFile(command, "#!/bin/sh\necho unrelated\n");
      await expect(exec("sh", [join(root, "deploy/maishu/cli/install.sh"), "--server-url", origin], options)).rejects.toThrow();
      expect(await readFile(command, "utf8")).toContain("unrelated");
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(temporary, { recursive: true, force: true }); }
  }, 15000);
});
