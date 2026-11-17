import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads", environment: "node", fileParallelism: false,
    include: [
      "apps/main-node/test/harness-credentials.test.ts",
      "apps/main-node/test/node-session-sandbox.test.ts",
      "packages/agent-harness/test/acp-sandbox-loop.lifetime.test.ts",
      "packages/harness-runtime-acp/test/execution-channels-http.test.ts",
      "packages/harness-runtime-acp/test/node-supervisor.test.ts",
    ],
    testTimeout: 30000,
  },
});
