# 麦枢命令行发布

本产品从自托管平台发布单文件命令行，不假设存在已发布的 npm 包。

在仓库根目录使用 Node.js 22 或更高版本构建：

```sh
node packages/cli/scripts/build-maishu.mjs \
  --output-dir apps/console/dist/downloads \
  --base-url https://你的平台地址
```

`--output-dir` 必须指向最终控制台静态目录的 `downloads` 子目录。脚本输出：

- `install.sh`：安装器，写入本平台默认地址。
- `maishu.mjs`：打包后的 Node 命令行。
- `SHA256SUMS`：客户端校验文件。

使用者安装：

```sh
curl -fsSL https://你的平台地址/downloads/install.sh | sh -s -- \
  --server-url https://你的平台地址
maishu auth login
```

安装器要求 Node.js 22+、curl 和 sha256sum 或 shasum，仅更新自己管理的 `~/.local/share/maishu/cli/` 与 `~/.local/bin/maishu`；不会编辑 shell profile、覆盖其他来源的 maishu 命令或复制平台账户凭证。若 PATH 不包含安装目录，使用安装器打印的完整路径。Windows 可从 WSL 使用此安装器，或下载 `maishu.mjs` 后由 Node 执行；此脚本不声称提供原生 PowerShell 安装。

麦枢入口使用 MAISHU_* 配置变量和独立本机目录，原 oma 入口仍兼容上游。`--json` 保留原始结构和用户内容；中文翻译仅作用于明确的命令行人类提示，不改 API 字段、事件或 Agent 回复。

当前 Node 发行版使用远程 OpenSandbox，不支持 Bridge 配对。`bridge` 命令保留用于具备该能力的后端，控制台依据 `/v1/maishu/capabilities` 展示真实可用功能。新增沙箱后端和账户凭证管理目前仅 Node 实现；CF 保留原功能并提供品牌 API 路径别名，不声称具有这些 Node 新能力。
