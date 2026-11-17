import { defineConfig } from "vitest/config";
export default defineConfig({test:{pool:"threads",fileParallelism:false,
  include:["test/work-workspace-checkpoints.storage.integration.ts"],testTimeout:60000,hookTimeout:240000}});
