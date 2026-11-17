import type { SandboxExecutor } from "@open-managed-agents/sandbox";

export type HarnessCredentialKind = "codex" | "claude" | "dsh";
export function usesNativeAccountFiles(config: unknown): boolean {
  const value = config as { acp?: { agent?: { env?: Record<string, unknown> } } } | undefined;
  return value?.acp?.agent?.env?.MAISHU_AUTH_MODE === "native";
}
export interface HarnessCredentialView {
  id: string; name: string; kind: HarnessCredentialKind; revision: string;
  allowedAgentIds: string[]; allowWorkspace: boolean; updatedAt: string;
  codexRefresh?: { status: "ok" | "failed"; lastAttemptAt: string; lastSuccessAt?: string; nextDueAt?: string };
}
export interface HarnessCredentialInput {
  name: string; kind: HarnessCredentialKind; content?: string;
  allowedAgentIds?: string[]; allowWorkspace?: boolean; expectedRevision?: string;
}
export interface HarnessCredentialController {
  list(workspaceId: string): Promise<HarnessCredentialView[]>;
  save(workspaceId: string, input: HarnessCredentialInput, id?: string): Promise<HarnessCredentialView>;
  remove(workspaceId: string, id: string): Promise<void>;
  materialize(input: {
    workspaceId: string; sessionId: string; agentId: string;
    agentConfig: unknown; sandbox: SandboxExecutor;
  }): Promise<void>;
}
