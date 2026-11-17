// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectOption } from "../../components/Select";
import { useApi } from "../../lib/api";
import { uiText } from "../../i18n/ui-text";
import { formatHarnessRequirement, harnessValidationError, missingHarnessRequirements, resolvedHarness, type HarnessCatalog } from "./harnessCatalog";

type AcpConfig = { agent: { id?: string; command?: string; registry?: string; args?: string[]; env?: Record<string, string | undefined>; [key: string]: unknown }; [key: string]: unknown };
interface CredentialOption { id: string; name: string; kind: string }
interface Props {
  value: unknown;
  fields: Record<string, unknown>;
  configError?: string;
  onChange: (id: string) => void;
  onAcpChange?: (config: AcpConfig) => void;
  catalog: HarnessCatalog | null;
  loading: boolean;
  error: string;
  retry: () => void;
}
const presets = [
  { value: "codex", name: "Codex", id: "codex-acp" },
  { value: "claude", name: "Claude Code", id: "claude-acp" },
  { value: "dsh", name: "DeepSeek Harness", id: "dsh-acp" },
];
const placementLabels = { host: "Control-plane process", sandbox: "Sandbox", runtime: "Runtime", unknown: "Unspecified by deployment" };

export function HarnessPicker({ value, fields, configError, onChange, onAcpChange, catalog, loading, error, retry }: Props) {
  const { api } = useApi();
  const selected = value == null || value === "default" ? "default" : String(value);
  const descriptor = catalog ? resolvedHarness(catalog, value) : undefined;
  const unknown = selected !== "default" && !catalog?.data.some((entry) => entry.id === selected);
  const validation = configError || (catalog ? harnessValidationError(catalog, value, fields) : "");
  const defaultDescriptor = catalog ? resolvedHarness(catalog, "default") : undefined;
  const missingFor = (entry: Parameters<typeof missingHarnessRequirements>[0]) => configError ? [] : missingHarnessRequirements(entry, fields);
  const acp = fields.acp as AcpConfig | undefined;
  const agent = acp?.agent;
  const preset = agent?.command === "/usr/local/bin/maishu-harness" ? presets.find((p) => p.value === agent.args?.[0]) : undefined;
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [credentialError, setCredentialError] = useState("");
  useEffect(() => {
    if (!preset) return;
    const controller = new AbortController();
    setCredentialError("");
    void api<{ data: CredentialOption[] }>("/v1/maishu/admin/harness-credentials", { signal: controller.signal }).then((r) => {
      if (!controller.signal.aborted) setCredentials(r.data);
    }).catch(() => { if (!controller.signal.aborted) setCredentialError("无法读取引擎凭证，请确认实例管理员权限和服务连接。"); });
    return () => controller.abort();
  }, [Boolean(preset), api]);
  const choosePreset = (key: string) => {
    const next = presets.find((p) => p.value === key);
    if (!next || !onAcpChange) return;
    const env: Record<string, string | undefined> = { ...agent?.env, MAISHU_AUTH_MODE: agent?.env?.MAISHU_AUTH_MODE ?? "native" };
    if (preset?.value !== key) delete env.MAISHU_CREDENTIAL_REF;
    const { registry: _registry, ...oldAgent } = agent ?? {};
    onAcpChange({ ...acp, agent: { ...oldAgent, id: next.id, command: "/usr/local/bin/maishu-harness", args: [next.value], env } });
  };
  const patchEnv = (key: string, entry: string) => {
    if (!agent || !onAcpChange) return;
    onAcpChange({ ...acp, agent: { ...agent, env: { ...agent.env, [key]: entry } } });
  };
  return (
    <section aria-label={uiText("Harness configuration")} className="min-w-0 space-y-3">
      <Label htmlFor="agent-harness" className="text-sm text-fg-muted block">{uiText("Harness")}</Label>
      <Select id="agent-harness" value={selected} onValueChange={(id) => {
        onChange(id);
        if (id === "acp-sandbox" && !agent?.command && !agent?.registry && onAcpChange) choosePreset("codex");
      }} disabled={loading || !catalog || catalog.data.length === 0}
        aria-describedby="agent-harness-details" aria-invalid={!!validation}
        className="w-full min-w-0 h-auto min-h-9 whitespace-normal [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:break-all">
        <SelectOption value="default" disabled={!defaultDescriptor || missingFor(defaultDescriptor).length > 0}>{uiText("Default")} ({catalog?.default_harness_id ?? (loading ? uiText("Loading") : uiText("Unavailable"))})</SelectOption>
        {unknown && <SelectOption value={selected} disabled>{selected}</SelectOption>}
        {catalog?.data.filter((entry) => entry.id !== "default").map((entry) => {
          const missing = missingFor(entry);
          const canConfigure = entry.id === "acp-sandbox" && !!onAcpChange;
          const name = entry.label;
          return <SelectOption key={entry.id} value={entry.id} disabled={missing.length > 0 && !canConfigure}>
            {name} ({entry.id}){missing.length > 0 && !canConfigure ? uiText(" — requires configuration") : ""}
          </SelectOption>;
        })}
      </Select>
      {descriptor?.id === "acp-sandbox" && onAcpChange && <div className="rounded-xl border border-border bg-bg-surface p-4 space-y-3">
        <div><Label htmlFor="acp-preset">原生智能体</Label>
          <Select id="acp-preset" value={preset?.value ?? "custom"} onValueChange={choosePreset}>
            {!preset && agent && <SelectOption value="custom">已有自定义启动配置（保留）</SelectOption>}
            {presets.map((p) => <SelectOption key={p.value} value={p.value}>{p.name}</SelectOption>)}
          </Select>
        </div>
        {preset && <>
          <div><Label htmlFor="acp-auth-mode">认证方式</Label><Select id="acp-auth-mode" value={agent?.env?.MAISHU_AUTH_MODE ?? "native"} onValueChange={(v) => patchEnv("MAISHU_AUTH_MODE", v)}>
            <SelectOption value="native">原生认证／订阅凭证</SelectOption><SelectOption value="managed">平台托管模型</SelectOption>
          </Select></div>
          {agent?.env?.MAISHU_AUTH_MODE !== "managed" && <div><Label htmlFor="acp-credential">引擎凭证</Label>
            <Select id="acp-credential" value={agent?.env?.MAISHU_CREDENTIAL_REF ?? "__none"} onValueChange={(v) => patchEnv("MAISHU_CREDENTIAL_REF", v === "__none" ? "" : v)}>
              <SelectOption value="__none">请选择已授权的凭证</SelectOption>
              {credentials.filter((c) => c.kind === preset.value).map((c) => <SelectOption key={c.id} value={c.id}>{c.name}</SelectOption>)}
              {agent?.env?.MAISHU_CREDENTIAL_REF && !credentials.some((c) => c.id === agent.env?.MAISHU_CREDENTIAL_REF) && <SelectOption value={agent.env.MAISHU_CREDENTIAL_REF}>已保存的凭证引用（请核对授权）</SelectOption>}
            </Select>
            <p className="mt-2 text-xs text-fg-muted">仅保存凭证引用，认证文件在沙箱启动时注入。<Link to="/settings/harness-credentials" className="underline text-brand">管理引擎凭证</Link></p>
            {credentialError && <p role="alert" className="text-xs text-danger">{credentialError}</p>}
          </div>}
          <p className="text-xs text-fg-muted">执行镜像须包含麦枢引擎启动器及所选引擎。选择预设不会修改或重建镜像。原生认证模式使用引擎自身的模型配置，平台中的 native 仅为标识。</p>
        </>}
        {!preset && <p className="text-xs text-fg-muted">自定义命令、参数及认证设置保持原样，可切换 JSON／YAML 查看或编辑。</p>}
      </div>}
      <div id="agent-harness-details" className="space-y-1 text-xs text-fg-muted break-words">
        {loading && <p role="status">{uiText("Loading harness catalog…")}</p>}
        {error && <p role="alert">{error}</p>}
        {catalog?.data.length === 0 && <p role="status">{uiText("No harnesses are registered in this deployment.")}</p>}
        {validation && <p role="alert" className="text-danger">{validation}</p>}
        {descriptor && <>
          <p>{descriptor.id === "acp-sandbox" ? "在执行沙箱中运行完整 ACP 智能体。" : descriptor.id === "pi" ? "在管理端运行 Pi 智能体循环，工具操作由执行环境承接。" : descriptor.description}</p>
          <p>{uiText("Execution strategy:")} {uiText(placementLabels[descriptor.execution.placement])}</p>
          {!!descriptor.requirements.length && !onAcpChange && <p>{uiText("Required advanced fields:")} {descriptor.requirements.map(formatHarnessRequirement).join(", ")}</p>}
        </>}
        {catalog && catalog.data.some((entry) => entry.id !== "acp-sandbox" && missingFor(entry).length > 0) &&
          <p>{uiText("Unavailable choices need JSON / YAML configuration:")} {catalog.data.filter((entry) => missingFor(entry).length > 0).map((entry) => `${entry.label}: ${missingFor(entry).map(formatHarnessRequirement).join(", ")}`).join("; ")}</p>}
        <p>{uiText("Environment is selected when starting a session. Existing ACP and runtime binding configuration is preserved.")}</p>
      </div>
      {(error || catalog?.data.length === 0) && <Button type="button" variant="outline" size="sm" onClick={retry} disabled={loading}>{uiText("Retry harness catalog")}</Button>}
    </section>
  );
}
