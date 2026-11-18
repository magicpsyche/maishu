// 麦枢修改：账户文件只写管理、按本工作空间智能体名称授权；保留旧授权引用。
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Modal } from "../components/Modal";
import { Select, SelectOption } from "../components/Select";
import { useApi } from "../lib/api";

type Kind = "codex" | "claude" | "dsh";
interface Credential { id: string; name: string; kind: Kind; revision: string | number; allowedAgentIds: string[]; allowWorkspace: boolean; updatedAt: string }
interface AgentOption { id: string; name: string; archived_at?: string | null }
const names: Record<Kind, string> = { codex: "Codex", claude: "Claude Code", dsh: "DeepSeek Harness" };
const files: Record<Kind, string> = { codex: "auth.json", claude: ".credentials.json", dsh: ".credentials.yaml" };
const initial = { name: "", kind: "codex" as Kind, content: "", allowed: [] as string[], allowWorkspace: false };

export function HarnessCredentials() {
  const { api } = useApi();
  const [rows, setRows] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Credential | null>(null);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState("");
  const [agentsRefresh, setAgentsRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [showIds, setShowIds] = useState(false);
  const [filename, setFilename] = useState("");
  const contentGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const capabilities = await api<{ harness_credentials?: boolean }>("/v1/maishu/capabilities");
      if (capabilities.harness_credentials === false) { setUnsupported(true); setError(""); return; }
      setUnsupported(false);
      const response = await api<{ data: Credential[] }>("/v1/maishu/admin/harness-credentials");
      setRows(response.data); setError("");
    } catch { setError("无法读取引擎凭证。此功能仅对实例管理员开放，请检查权限或稍后重试。"); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setAgentsLoading(true); setAgentsError("");
    void (async () => {
      const found = new Map<string, AgentOption>();
      const cursors = new Set<string>();
      let cursor = "";
      do {
        if (cursors.has(cursor)) throw new Error("重复的列表游标");
        cursors.add(cursor);
        const params = new URLSearchParams({ limit: "100", include_archived: "true", ...(cursor ? { page: cursor } : {}) });
        const page = await api<{ data: AgentOption[]; next_page?: string | null }>(`/v1/agents?${params}`, { signal: controller.signal });
        for (const agent of page.data) found.set(agent.id, agent);
        cursor = page.next_page ?? "";
      } while (cursor);
      if (!controller.signal.aborted) setAgents([...found.values()]);
    })().catch(() => {
      if (!controller.signal.aborted) setAgentsError("无法加载本工作空间的智能体。已保存的授权会保留，可重试后再选择。");
    }).finally(() => { if (!controller.signal.aborted) setAgentsLoading(false); });
    return () => controller.abort();
  }, [open, agentsRefresh, api]);

  const close = () => {
    if (busy) return;
    contentGeneration.current++;
    setOpen(false); setEditing(null); setForm(initial); setFilename("");
  };
  const edit = (row: Credential | null) => {
    contentGeneration.current++;
    setEditing(row); setError(""); setFilename(""); setSearch(""); setShowIds(false); setAgents([]);
    setForm(row ? { name: row.name, kind: row.kind, content: "", allowed: [...row.allowedAgentIds], allowWorkspace: row.allowWorkspace } : initial);
    setOpen(true);
  };
  const readCredential = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 256 * 1024) { setError("认证文件不能超过 256 KiB。"); return; }
    const generation = ++contentGeneration.current;
    try {
      const content = await file.text();
      if (generation !== contentGeneration.current) return;
      setForm(current => ({ ...current, content })); setFilename(file.name); setError("");
    } catch { if (generation === contentGeneration.current) setError("无法读取这个文件，请重新选择或直接粘贴内容。"); }
  };
  const toggleAgent = (id: string, checked: boolean) => {
    if (checked && !form.allowed.includes(id) && form.allowed.length >= 200) { setError("最多单独授权 200 个智能体，请缩小授权范围。"); return; }
    setForm(current => ({ ...current, allowed: checked ? [...new Set([...current.allowed, id])] : current.allowed.filter(value => value !== id) }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || (!editing && !form.content.trim())) { setError("请填写名称和认证文件内容。"); return; }
    setBusy(true); setError("");
    try {
      await api(`/v1/maishu/admin/harness-credentials${editing ? `/${encodeURIComponent(editing.id)}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ name: form.name.trim(), kind: form.kind, ...(form.content.trim() ? { content: form.content } : {}), allowedAgentIds: [...new Set(form.allowed)], allowWorkspace: form.allowWorkspace, ...(editing ? { expectedRevision: editing.revision } : {}) }),
      });
      contentGeneration.current++;
      setOpen(false); setEditing(null); setForm(initial); setFilename(""); await load();
    } catch { setError("保存失败。请检查文件格式、授权范围；若凭证已被其他管理员更新，请刷新后重试。"); }
    finally { setBusy(false); }
  };
  const remove = async (row: Credential) => {
    if (!confirm(`删除“${row.name}”？后续任务将无法使用此凭证。`)) return;
    setBusy(true);
    try { await api(`/v1/maishu/admin/harness-credentials/${encodeURIComponent(row.id)}`, { method: "DELETE" }); await load(); }
    catch { setError("删除失败，请稍后重试。"); }
    finally { setBusy(false); }
  };
  const activeAgents = agents.filter(agent => !agent.archived_at);
  const needle = search.trim().toLocaleLowerCase();
  const filteredAgents = activeAgents.filter(agent => !needle || `${agent.name} ${agent.id}`.toLocaleLowerCase().includes(needle));
  const unavailableIds = agentsLoading ? [] : form.allowed.filter(id => !activeAgents.some(agent => agent.id === id));

  return <main className="maishu-settings-page p-5 md:p-8 min-w-0 max-w-6xl mx-auto space-y-6">
    <header className="flex flex-wrap gap-4 items-start justify-between"><div><h1 className="text-2xl font-semibold">引擎凭证</h1><p className="mt-2 text-sm text-fg-muted max-w-2xl">为沙箱中的原生智能体提供认证文件。凭证在服务端加密保存，界面只显示名称、类型和授权范围。</p></div><Button disabled={loading || unsupported} onClick={() => edit(null)}>添加引擎凭证</Button></header>
    <div className="rounded-xl border border-border p-4 bg-bg-surface text-sm text-fg-muted space-y-2"><p>在<Link className="text-brand underline mx-1" to="/agents">智能体配置</Link>中选择 ACP Sandbox 和对应引擎，再引用这里的凭证。认证内容不会写入镜像或普通环境变量。</p><p>可先保存未授权凭证，创建智能体后回来按名称授权；未授权时不能执行任务。</p></div>
    {error && !open && <div role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">{error}</div>}
    {unsupported ? <p role="status" className="rounded-xl border border-border p-6 text-sm text-fg-muted">当前部署不支持引擎凭证设置。请在支持此功能的自托管管理端配置。</p> : loading ? <p role="status">正在加载凭证…</p> : <div className="rounded-xl border border-border overflow-x-auto"><Table className="w-full text-sm"><TableHeader className="bg-bg-surface text-left text-fg-muted"><TableRow>{["名称", "引擎", "授权范围", "版本", "操作"].map(name => <TableHead key={name} className="px-4 py-3 font-medium">{name}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id} className="border-t border-border"><TableCell className="px-4 py-4"><div className="font-medium">{row.name}</div><code className="text-xs text-fg-muted">{row.id}</code></TableCell><TableCell className="px-4 py-4 whitespace-nowrap">{names[row.kind]}</TableCell><TableCell className="px-4 py-4">{row.allowWorkspace ? "当前工作空间全部智能体" : row.allowedAgentIds.length ? `${row.allowedAgentIds.length} 个智能体` : "未授权，不能执行"}</TableCell><TableCell className="px-4 py-4">{row.revision}</TableCell><TableCell className="px-4 py-4 whitespace-nowrap"><Button variant="ghost" disabled={busy} onClick={() => edit(row)}>编辑</Button><Button variant="ghost" disabled={busy} onClick={() => void remove(row)}>删除</Button></TableCell></TableRow>)}</TableBody></Table>{!rows.length && <div className="py-14 text-center"><p className="font-medium">尚未添加引擎凭证</p><p className="mt-2 text-sm text-fg-muted">可以先保存认证，再创建智能体并回来完成授权。</p></div>}</div>}
    <Modal open={open} onClose={close} title={editing ? "编辑引擎凭证" : "添加引擎凭证"} footer={<><Button variant="ghost" disabled={busy} onClick={close}>取消</Button><Button disabled={busy} form="harness-credential-form" type="submit">{busy ? "保存中…" : "保存凭证"}</Button></>}>
      <form id="harness-credential-form" onSubmit={event => void save(event)} className="space-y-4">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div><Label htmlFor="credential-name">名称</Label><Input id="credential-name" value={form.name} autoComplete="off" onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：研究任务专用账号" /></div>
        <div><Label htmlFor="credential-kind">执行引擎</Label><Select id="credential-kind" value={form.kind} disabled={!!editing} onValueChange={kind => { contentGeneration.current++; setFilename(""); setForm({ ...form, kind: kind as Kind, content: "" }); }}>{Object.entries(names).map(([kind, name]) => <SelectOption value={kind} key={kind}>{name}</SelectOption>)}</Select></div>
        <div className="space-y-2"><Label htmlFor="credential-file">选择本地认证文件（选填）</Label><Input ref={fileInput} id="credential-file" type="file" tabIndex={-1} accept=".json,.yaml,.yml" disabled={busy} className="hidden" onChange={event => void readCredential(event)} /><Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>选择认证文件</Button><p className="text-xs text-fg-muted">{filename ? `已读取 ${filename}，内容仅保留在当前窗口。` : "也可直接粘贴下方内容。文件不会加入平台文件列表，点击保存后才提交到账户凭证接口。"}</p></div>
        <div><Label htmlFor="credential-content">{files[form.kind]} 内容{editing ? "（留空保留原值）" : ""}</Label><Textarea id="credential-content" value={form.content} onChange={event => { contentGeneration.current++; setFilename(""); setForm({ ...form, content: event.target.value }); }} className="font-mono text-xs min-h-28" autoComplete="off" spellCheck={false} placeholder={editing ? "已保存的内容不会回显；选择新文件或粘贴内容可更新认证。" : "选择文件或粘贴已登录引擎的认证内容。"} /><p className="mt-1 text-xs text-fg-muted">关闭窗口后不保留认证草稿；编辑已有凭证时不会读取旧认证内容。</p></div>
        <fieldset className="rounded-lg border border-border p-3 space-y-3"><legend className="px-1 text-sm font-medium">授权给本工作空间的智能体</legend>
          <p className="text-xs text-fg-muted">可先保存未授权凭证，创建智能体后回来授权；未授权时不能执行。</p>
          <Input aria-label="搜索本工作空间智能体" value={search} onChange={event => setSearch(event.target.value)} placeholder="按智能体名称搜索" />
          <div className="flex items-center gap-2"><Checkbox id="credential-show-ids" checked={showIds} onCheckedChange={checked => setShowIds(checked === true)} /><Label htmlFor="credential-show-ids" className="text-xs">显示 ID 辅助辨认同名智能体</Label></div>
          {agentsLoading ? <p role="status" className="text-xs text-fg-muted">正在读取本工作空间的智能体…</p> : agentsError ? <div><p role="alert" className="text-xs text-danger">{agentsError}</p><Button type="button" variant="ghost" size="sm" onClick={() => setAgentsRefresh(value => value + 1)}>重新读取智能体</Button></div> : <div className="max-h-52 overflow-y-auto space-y-2">{filteredAgents.map(agent => <div className="flex items-start gap-2 rounded-md px-1 py-1" key={agent.id}><Checkbox id={`credential-agent-${agent.id}`} disabled={busy} checked={form.allowed.includes(agent.id)} onCheckedChange={checked => toggleAgent(agent.id, checked === true)} /><Label htmlFor={`credential-agent-${agent.id}`} className="min-w-0 block"><span className="block text-sm">{agent.name || "未命名智能体"}</span>{showIds && <code className="block break-all text-xs text-fg-muted">{agent.id}</code>}</Label></div>)}{!filteredAgents.length && <p className="text-xs text-fg-muted">{search ? "没有匹配的智能体。已选择的授权保持不变。" : "本工作空间还没有可用智能体，可以先保存凭证，创建智能体后再授权。"}</p>}</div>}
          {unavailableIds.length > 0 && <div className="border-t border-border pt-3 space-y-2"><p className="text-xs text-fg-muted">已保存的归档或不可见授权不会自动清除，可逐项撤回。</p>{unavailableIds.map(id => { const agent = agents.find(value => value.id === id); const name = agent?.name || "不可见或已删除智能体"; return <div key={id} className="flex items-center justify-between gap-3"><div className="min-w-0"><span className="text-sm">{name}{agent?.archived_at ? "（已归档）" : ""}</span><code className="block break-all text-xs text-fg-muted">{id}</code></div><Button type="button" variant="ghost" size="sm" aria-label={`撤回${name}的授权`} onClick={() => toggleAgent(id, false)}>撤回</Button></div>; })}</div>}
        </fieldset>
        <div className="flex items-start gap-2 text-sm"><Checkbox id="credential-workspace" checked={form.allowWorkspace} onCheckedChange={checked => setForm({ ...form, allowWorkspace: checked === true })} /><div><Label htmlFor="credential-workspace">允许当前工作空间内的智能体使用</Label><p className="mt-1 text-xs text-fg-muted">包含当前及之后新建的全部智能体，不扩展到其他工作空间。启用后，上方单独选择不再限制本空间内的使用范围。</p></div></div>
      </form>
    </Modal>
  </main>;
}
