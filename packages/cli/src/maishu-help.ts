const helps: Record<string, string> = {
  'auth': `账户与工作区\n  maishu auth login --base-url <平台地址> [--tenant <工作区ID>]\n  maishu auth logout\n  maishu auth tenant ls\n  maishu auth tenant use <工作区ID>\n  maishu whoami\n\n也可设置 MAISHU_BASE_URL、MAISHU_API_KEY 和 MAISHU_TENANT_ID。`,
  'agents': `智能体管理\n  maishu agents list\n  maishu agents get <ID>\n  maishu agents create <名称> --model <模型ID>\n  maishu agents update <ID> [--model <模型ID>] [--system <指令>]\n  maishu agents delete <ID>\n\n使用 --json 输出原始结构，协议字段保持不变。`,
  'sessions': `会话与任务\n  maishu sessions list\n  maishu sessions create --agent <智能体ID> --env <环境ID>\n  maishu sessions chat <会话ID> <任务内容>\n  maishu sessions message <会话ID> <补充内容>\n  maishu sessions tail <会话ID>\n  maishu sessions logs <会话ID>\n\n任务在平台配置的执行端运行。本命令行仅提交和读取，不在本机代替远程执行。`,
  'bridge': `Bridge 机器接入\n  maishu bridge setup --server-url <平台地址> [--token <一次性配对令牌>]\n  maishu bridge setup --force\n  maishu bridge status\n  maishu bridge refresh\n  maishu bridge agents refresh\n  maishu bridge uninstall\n\n--no-service 在前台运行；--yes 接受适配器安装提示。\n此功能要求平台支持 Bridge。麦枢当前 Node 部署使用远程沙箱，尚未启用机器接入。\n运行任务请使用 agents、sessions 和 envs 命令。`,
  'runtime': `接入机器\n  maishu runtime list\n  maishu runtime pair\n\n需要服务端启用 Bridge。一次性配对命令不代表已安装客户端。`,
  'envs': `执行环境\n  maishu envs list\n  maishu envs create <名称>\n\n环境指定任务运行条件；沙箱服务地址和密钥由实例管理员在控制台配置。`,
  'files': `文件资源\n  maishu api files\n\n原版尚无 files 子命令组；此命令查看文件列表、上传和下载接口。文件资源与远程工作目录分别管理。`,
};
export function maishuHelp(args: string[]): string | null {
  const command = args.find(value => !value.startsWith('-'));
  if (!command || command === 'help') return null;
  return helps[command] ?? `麦枢命令：${command}\n\n使用 maishu --help 查看命令分组，maishu api 查看兼容接口。\n--json 保留机器可读输出；认证使用 MAISHU_BASE_URL 和 MAISHU_API_KEY。`;
}
