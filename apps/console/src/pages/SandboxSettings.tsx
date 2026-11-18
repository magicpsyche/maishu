import { useCallback, useEffect, useState } from "react";
import { useApi } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectOption } from "../components/Select";

interface Settings {
  provider: "opensandbox"; domain: string; protocol: "http" | "https"; runtime: "docker";
  image: string; cpu: string; memory: string; timeoutSeconds: number; readyTimeoutMs: number;
}
interface View { revision: string; source: "environment" | "console"; credentialSet: boolean; settings: Settings }
const endpoint = "/v1/maishu/admin/sandbox-backend";

export function SandboxSettings() {
  const { api } = useApi();
  const [view, setView] = useState<View | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [replaceKey, setReplaceKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const load = useCallback(async () => {
    try {
      const capabilities = await api<{ sandbox_backend_settings?: boolean }>("/v1/maishu/capabilities");
      if (capabilities.sandbox_backend_settings === false) {
        setUnsupported(true); setView(null); setSettings(null); setMessage(""); return;
      }
      setUnsupported(false);
      const next = await api<View>(endpoint); setView(next); setSettings(next.settings);
    }
    catch (e) { setMessage(e instanceof Error ? e.message : "读取配置失败"); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const patch = (value: Partial<Settings>) => setSettings(old => old ? { ...old, ...value } : old);
  const run = async (action: "probe" | "save" | "import") => {
    if (!settings || !view) return;
    setBusy(true); setMessage("");
    try {
      const body = action === "import" ? JSON.stringify({ expectedRevision: view.revision })
        : JSON.stringify({ expectedRevision: view.revision, settings, ...(replaceKey ? { apiKey: key } : {}) });
      if (action === "probe") {
        const result = await api<{ stages: string[] }>(endpoint + "/probe", { method: "POST", body });
        setMessage("验证通过：" + result.stages.join("、"));
      } else {
        const next = await api<View>(action === "import" ? endpoint + "/import-environment" : endpoint, { method: action === "import" ? "POST" : "PUT", body });
        setView(next); setSettings(next.settings); setKey(""); setReplaceKey(false);
        setMessage(action === "import" ? "已从部署配置导入新版本。新会话将使用导入配置，已绑定的会话继续使用原版本。"
          : "已保存。新分配使用此版本，已有会话继续使用原后端配置。");
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  };
  return <main className="maishu-settings-page mx-auto w-full max-w-3xl space-y-7 p-6">
    <header><h1 className="text-2xl font-semibold">沙箱后端</h1>
      <p className="mt-2 text-sm text-fg-muted">新分配的沙箱使用这里的 OpenSandbox 后端。保存后，已绑定后端的会话继续使用原配置。</p></header>
    {message && <p role="status" className="rounded-lg border border-border p-4 text-sm [overflow-wrap:anywhere]">{message}</p>}
    {unsupported ? <section className="rounded-xl border border-border p-5"><p>当前部署不支持此设置。</p><p className="mt-2 text-sm text-fg-muted">控制台沙箱后端配置目前由麦枢 Node 服务提供；此部署的执行资源仍由原有部署配置管理。</p></section> : !settings || !view ? <Button onClick={() => void load()}>重新读取</Button> : <>
      <p className="text-xs text-fg-muted">配置来源：{view.source === "environment" ? "部署配置" : "控制台"} · 版本：{view.revision}</p>
      <section className="grid gap-5 rounded-xl border border-border p-5 sm:grid-cols-2">
        <div><Label htmlFor="backend-provider">服务类型</Label><Input id="backend-provider" value="OpenSandbox · Docker" disabled /></div>
        <div><Label htmlFor="backend-protocol">连接协议</Label><Select id="backend-protocol" value={settings.protocol} onValueChange={value => patch({ protocol: value as Settings["protocol"] })}><SelectOption value="http">HTTP</SelectOption><SelectOption value="https">HTTPS</SelectOption></Select></div>
        <div className="sm:col-span-2"><Label htmlFor="backend-domain">服务地址</Label><Input id="backend-domain" value={settings.domain} placeholder="执行端地址:8808" onChange={e => patch({ domain: e.target.value })} /><p className="mt-1 text-xs text-fg-muted">只填写主机名或 IP 和端口。管理端还需能访问服务返回的命令执行和双向通信端点。</p></div>
        <div className="sm:col-span-2"><Label htmlFor="backend-image">默认镜像</Label><Input id="backend-image" value={settings.image} onChange={e => patch({ image: e.target.value })} /><p className="mt-1 text-xs text-fg-muted">镜像应具备 Node.js 和对应运行时；此处不保存订阅认证。环境指定的镜像仍优先。</p></div>
        <div><Label htmlFor="backend-cpu">CPU 配额</Label><Input id="backend-cpu" value={settings.cpu} onChange={e => patch({ cpu: e.target.value })} /></div>
        <div><Label htmlFor="backend-memory">内存配额</Label><Input id="backend-memory" value={settings.memory} onChange={e => patch({ memory: e.target.value })} /></div>
        <div><Label htmlFor="backend-timeout">沙箱有效期（秒）</Label><Input id="backend-timeout" type="number" value={settings.timeoutSeconds} onChange={e => patch({ timeoutSeconds: Number(e.target.value) })} /></div>
        <div><Label htmlFor="backend-ready">启动等待时间（毫秒）</Label><Input id="backend-ready" type="number" value={settings.readyTimeoutMs} onChange={e => patch({ readyTimeoutMs: Number(e.target.value) })} /></div>
        <div className="sm:col-span-2 space-y-2"><Label htmlFor="backend-key">服务认证密钥</Label><p className="text-xs text-fg-muted">{view.credentialSet ? "已配置，密钥不会回传浏览器。" : "尚未设置服务密钥。"}</p>
          <div className="flex items-center gap-2 text-sm"><Checkbox id="backend-replace-key" checked={replaceKey} onCheckedChange={value => setReplaceKey(value === true)} /><Label htmlFor="backend-replace-key">更新密钥</Label></div>
          {replaceKey && <Input id="backend-key" type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder="留空将清除服务密钥" />}</div>
      </section>
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => void run("probe")}>{busy ? "处理中…" : "创建临时沙箱并验证"}</Button><Button disabled={busy} onClick={() => void run("save")}>保存配置</Button></div>
      <p className="text-xs text-fg-muted">验证会实际创建并销毁一个临时容器，检查文件、命令、双向通信，以及安全管理进程的启动、身份绑定、恢复和停止。已有会话固定原配置版本；修改地址不会把它们切到其他服务。</p>
      <section className="space-y-3 border-t border-border pt-5">
        <p className="text-sm text-fg-muted">升级执行工具或挂载后，可从服务当前加载的部署配置导入新版本。导入会替换本页未保存的修改；新会话使用导入版本，已绑定的会话保留原配置。</p>
        <Button variant="outline" disabled={busy} onClick={() => void run("import")}>从部署配置导入新版本</Button>
      </section>
    </>}
  </main>;
}
