import { maishuHelp } from "./maishu-help.js";
declare const MAISHU_BUILD_VERSION: string;
if (process.argv.length === 3 && ["--version", "-v"].includes(process.argv[2]!)) {
  console.log(`麦枢 ${typeof MAISHU_BUILD_VERSION === "string" ? MAISHU_BUILD_VERSION : "dev"}`);
  process.exit(0);
}
// 麦枢入口：兼容上游协议，独立保存本产品的本机认证和 Bridge 状态。
if (process.argv.length === 2 || process.argv.slice(2).some(arg => arg === "--help" || arg === "-h")) {
  const detail = maishuHelp(process.argv.slice(2));
  if (detail) { console.log(detail); process.exit(0); }
  console.log(`麦枢命令行

用法：maishu <命令> [参数]

账户与连接
  auth login --base-url <地址>       打开浏览器登录本平台
  auth logout                       清除本机登录凭证
  whoami                            查看账户与当前工作区
  auth tenant ls                    列出工作区
  auth tenant use <工作区ID>         切换工作区

智能体与会话
  agents list                       列出智能体
  agents get <ID>                    查看智能体配置
  agents create <名称> --model <模型> 创建智能体
  agents update <ID> [参数]          更新智能体
  agents delete <ID>                 归档智能体
  sessions list                     列出会话
  sessions create --agent <ID> --env <ID>  创建会话
  sessions chat <ID> <内容>          发送指令并实时接收回复
  sessions message <ID> <内容>       发送指令
  sessions tail <ID>                 持续查看事件
  sessions logs <ID>                 导出完整事件

资源管理
  envs list                         列出执行环境
  envs create <名称>                创建执行环境
  models list                       列出模型配置
  keys list                         列出访问密钥
  api files                         查看文件上传、下载和列表接口
  skills list                       列出技能
  api [资源]                        查看兼容 API 参考

接入机器
  bridge setup --server-url <地址>   连接本机并启动 Bridge
  bridge status                     查看连接状态
  bridge refresh                    刷新工作区授权
  bridge agents refresh             重新检测执行引擎
  bridge uninstall                  停止服务并移除连接
  runtime list                      列出接入机器
  runtime pair                      为无浏览器机器生成一次性命令

配置变量：MAISHU_BASE_URL、MAISHU_API_KEY、MAISHU_TENANT_ID、MAISHU_PROFILE
登录状态：~/.config/maishu/；Bridge 状态：~/.maishu/bridge/
高级命令沿用上游兼容契约；输出中的模型、协议和机器字段保留原名。`);
  process.exit(0);
}
process.env.MAISHU_CLI = "1";
process.env.MAISHU_BUILD_VERSION = typeof MAISHU_BUILD_VERSION === "string" ? MAISHU_BUILD_VERSION : "dev";
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("MAISHU_") && value !== undefined) {
    process.env[`OMA_${key.slice(7)}`] = value;
  }
}
// 自托管产品不应把未配置的客户端连接到上游公共服务。
process.env.OMA_BASE_URL ??= "http://127.0.0.1:8797";
await import("./index.js");
