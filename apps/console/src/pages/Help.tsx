// 麦枢修改：自有中文入门与许可入口；许可原文由构建工具从仓库根文件读取。
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRightIcon, CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import license from "../../../../LICENSE?raw";
import notice from "../../../../NOTICE?raw";

const steps: { title: string; to: string; action: string; body: ReactNode }[] = [
  { title: "连接沙箱后端", to: "/settings/sandbox", action: "配置沙箱后端", body: <>
    <p>由实例管理员连接已有的 OpenSandbox 服务，填写服务地址、默认镜像和认证密钥，再运行临时沙箱验证。控制端保存会话和配置，执行端承担任务负载。</p>
    <p>验证会创建并销毁临时容器，检查文件、命令和双向通信。控制端还需能访问沙箱服务返回的执行端点，只有管理端口可达不代表任务可运行。</p>
  </> },
  { title: "准备引擎凭证", to: "/settings/harness-credentials", action: "管理引擎凭证", body: <>
    <p>当前原生预设支持 Codex、Claude Code 和 DeepSeek Harness。添加对应认证文件，并明确授权给指定智能体，或当前工作空间。</p>
    <p>可以先保存未授权凭证，创建智能体后再回到凭证页，按名称选择并授权；未授权时不能执行任务。认证内容只写入、不回显；智能体配置只保存凭证引用，执行时再注入隔离目录。凭证与镜像分离，更新认证不需要重建镜像。请使用你有权用于相应任务的账号。</p>
  </> },
  { title: "创建智能体并选择执行引擎", to: "/agents", action: "创建智能体", body: <>
    <p>选择模板或从空白开始，填写名称和系统指令。选择 ACP Sandbox，再选择 Codex、Claude Code 或 DeepSeek Harness 预设及已授权的引擎凭证。</p>
    <p>原生认证模式使用引擎自己的账号和模型配置，无需创建平台模型配置；表单中的 <code>native</code> 只是平台标识。执行镜像需要已具备所选引擎和麦枢启动器，选择预设不会自动安装或重建镜像。</p>
    <p>如果选择平台托管模型，请先在<Link to="/model-cards" className="text-brand underline">模型配置</Link>中设置提供商、模型和 API 凭证。技能、MCP 服务和工具的实际支持范围，以所选引擎及其适配器为准。</p>
  </> },
  { title: "建立执行环境", to: "/environments", action: "管理执行环境", body: <>
    <p>执行环境描述镜像、软件包和网络条件，可以复用于多个会话。需要额外工具时，选择包含这些工具的镜像，或配置受支持的软件包。</p>
    <p>沙箱服务与执行环境是两层配置：前者负责提供算力，后者规定任务所用的运行条件。当前 Node 部署通过远程沙箱运行任务；“接入机器”页面若显示 Bridge 不可用，请使用沙箱后端路径。</p>
  </> },
  { title: "发起会话并跟踪执行", to: "/sessions", action: "创建会话", body: <>
    <p>创建会话时选择智能体和执行环境，按需添加文件、仓库、记忆库或非机密环境变量，再发送任务。会话使用创建时绑定的智能体版本。</p>
    <p>在对话和执行轨迹中查看进展、工具结果及错误。遇到提问或授权请求时，提交回答或明确批准；需要调整方向时补充消息，也可以中断后继续原会话。</p>
  </> },
  { title: "获取文件和任务产物", to: "/files", action: "查看文件", body: <>
    <p>文件页管理平台已登记的文件资源，可以按会话筛选，并下载允许下载的文件。它不是沙箱整个磁盘的文件管理器；界面没有预览时，可先下载再打开。</p>
    <p>需要交付的文件请让智能体写入 <code>/mnt/session/outputs/</code>，再在会话产物区检查。任务目录里的任意文件，不会仅因存在就自动出现在平台文件列表中。</p>
  </> },
  { title: "在不同会话间复用记忆", to: "/memory", action: "管理记忆库", body: <>
    <p>先创建记忆库，再在会话资源中选择它，并设置“只读”或“读写”。多个会话绑定同一记忆库后可以复用知识；需要限制写入时，只给负责维护的会话读写权限。</p>
    <p>聊天历史、引擎原生会话状态和长期记忆是不同内容。保留会话记录，不等于全部聊天会自动变成长期记忆；应明确让智能体整理并保存值得复用的事实、约定和项目进展。</p>
  </> },
];

export function Help() {
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;
  const install = `curl -fsSL ${origin}/downloads/install.sh | sh -s -- --server-url ${origin}`;
  const login = `maishu auth login --base-url ${origin}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(install); setCopied(true); }
    catch { setCopied(false); }
  };
  return <div className="mx-auto w-full max-w-5xl space-y-9 p-5 md:p-9 pb-16">
    <header className="space-y-3 border-b border-border pb-7">

      <h1 className="text-3xl font-semibold tracking-tight">从配置到第一次任务</h1>
      <p className="max-w-3xl text-sm leading-7 text-fg-muted">麦枢是企业智能体执行与管理平台。你可以在控制台或通过 CLI、API 发起任务，由远程沙箱中的原生智能体执行，并集中查看会话、文件和记忆。</p>
      <p className="text-sm text-fg-muted">私网部署请先连接组织的 Tailscale 网络。沙箱服务和账户凭证设置需要实例管理员权限。</p>
    </header>
    <section aria-label="快速入门步骤" className="space-y-5">
      {steps.map((step, index) => <article key={step.to} className="grid gap-4 rounded-xl border border-border p-5 md:grid-cols-[2.5rem_minmax(0,1fr)] md:p-6">
        <span className="flex size-9 items-center justify-center rounded-lg bg-brand-subtle text-brand font-mono text-sm">{index + 1}</span>
        <div className="space-y-3 min-w-0"><h2 className="text-lg font-semibold">{step.title}</h2><div className="text-sm leading-7 text-fg-muted space-y-2 [&_code]:break-all [&_code]:rounded [&_code]:bg-bg-surface [&_code]:px-1">{step.body}</div><Link to={step.to} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">{step.action}<ArrowUpRightIcon className="size-4" /></Link></div>
      </article>)}
    </section>
    <section aria-labelledby="help-model-boundary" className="rounded-xl border border-border bg-bg-surface p-5 md:p-6 space-y-3">
      <h2 id="help-model-boundary" className="text-lg font-semibold">原生执行与平台判分是两条模型调用路径</h2>
      <p className="text-sm leading-7 text-fg-muted">Codex 等原生引擎使用自己的认证完成任务推理。平台的自动结果判分或评估可能另行调用判分模型，需要相应的平台模型配置和 API 访问；引擎的订阅凭证不会自动成为平台判分凭证。</p>
      <p className="text-sm leading-7 text-fg-muted">请分别核对任务执行和平台判分的结果。原生引擎完成任务，不代表独立判分已通过；判分模型未配置或调用失败，也不等于原生引擎登录失败。</p>
      <Link to="/model-cards" className="inline-block text-sm text-brand underline">管理平台模型配置</Link>
    </section>
    <section aria-labelledby="help-cli" className="space-y-4">
      <h2 id="help-cli" className="text-xl font-semibold">通过命令行驱动平台</h2>
      <p className="text-sm leading-7 text-fg-muted">麦枢 CLI 操作的是同一个平台，可创建和管理智能体、会话及资源。安装机器需要 Node.js 22 或更新版本；执行负载仍由所选远程环境承担。</p>
      <div className="rounded-xl border border-border bg-bg-surface p-4 space-y-3"><div className="flex items-start justify-between gap-3"><code className="break-all text-xs leading-6">{install}</code><Button variant="outline" size="sm" onClick={() => void copy()} aria-label="复制安装命令">{copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}{copied ? "已复制" : "复制"}</Button></div><p className="text-xs text-fg-muted">安装后登录：</p><code className="block break-all text-xs leading-6">{login}</code></div>
      <div className="flex flex-wrap gap-4 text-sm"><a href="/downloads/maishu.mjs" download className="text-brand underline">下载命令行客户端</a><a href="/downloads/SHA256SUMS" className="text-brand underline">查看 SHA256 校验值</a><Link to="/api-keys" className="text-brand underline">管理访问密钥</Link></div>
    </section>
    <section aria-labelledby="help-license" className="space-y-3 border-t border-border pt-7">
      <h2 id="help-license" className="text-xl font-semibold">开源组件与许可</h2>
      <p className="text-sm leading-7 text-fg-muted">麦枢基于 Open Managed Agents 改造，包含中文界面、独立品牌及相关部署和管理功能。上游采用 Apache License 2.0；相关版权、归属和第三方声明保留在下方原文及随发行包提供的 LICENSE、NOTICE 中。产品改名不改变这些适用声明。</p>
      <Accordion type="multiple" className="rounded-xl border border-border px-4">
        <AccordionItem value="notice"><AccordionTrigger>查看版权与第三方归属声明（NOTICE 原文）</AccordionTrigger><AccordionContent><pre className="whitespace-pre-wrap break-words text-xs leading-6 text-fg-muted">{notice}</pre></AccordionContent></AccordionItem>
        <AccordionItem value="license"><AccordionTrigger>查看 Apache License 2.0 许可原文</AccordionTrigger><AccordionContent><pre className="whitespace-pre-wrap break-words text-xs leading-6 text-fg-muted">{license}</pre></AccordionContent></AccordionItem>
      </Accordion>
      <p className="text-xs leading-6 text-fg-muted">需要阅读底层实现时，可查看<a href="https://github.com/openma-ai/open-managed-agents" target="_blank" rel="noreferrer" className="text-brand underline mx-1">上游技术参考（外部站点）</a>。它不替代本页的麦枢操作说明。</p>
    </section>
  </div>;
}
