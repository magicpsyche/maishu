# 麦枢

麦枢是企业智能体执行与管理平台，基于 Open Managed Agents 改造。控制面与执行面可分开部署，默认使用 OpenSandbox，在隔离环境中运行 Codex、Claude Code 和 DeepSeek Harness。

## 本产品改造

- 麦枢品牌与中文控制台，沿用原版品牌配置入口。
- 在控制台管理 OpenSandbox 后端；配置加密保存并版本化，旧会话固定使用原后端。
- 原生账户凭证与工具镜像分离；凭证只写不回显，按工作区及智能体授权，在执行前注入。
- 通用开发工具镜像及可独立更新的 Harness 版本。
- 麦枢独立 CLI 入口与本机状态目录，兼容上游 API 契约。

部署方法、边界与升级流程见 [部署说明](deploy/maishu/README.zh-CN.md)，镜像与认证见 [执行环境](deploy/maishu/runtime/README.md)。功能实现不等于所有线上场景均已验收；正式交付以具体发布记录为准。

## 开发

需要 Node.js 24 与 pnpm 11。在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm --filter managed-agents-console dev
pnpm --filter @open-managed-agents/main-node start
```

内部 workspace 名称、部分协议与环境变量保留兼容上游。客户部署的服务、目录、镜像、数据库及品牌使用 maishu / 麦枢。第三方真实包名保持原名。

构建本机 CLI：

```sh
pnpm --filter @openma/cli build:maishu
MAISHU_BASE_URL=https://your-console.example node packages/cli/dist/maishu.js auth login
```

此仓库尚未把私有产品 CLI 发布到 npm；不要把未发布的 npm 名称当作可用安装命令。

## 上游升级

上游：[openma-ai/open-managed-agents](https://github.com/openma-ai/open-managed-agents)。基线记录在 `deploy/maishu/upstream.json`。品牌、部署资产和新增模块尽量独立；使用下面的只读命令查看升级差异，不自动更新生产实例。

```sh
node scripts/maishu/check-upstream.mjs --fetch
```

## 许可与归属

基于 Apache-2.0 许可修改与分发。保留 [LICENSE](LICENSE) 和 [NOTICE](NOTICE) 中的适用声明；麦枢不代表上游提供或认可本产品。产品修改记录见 Git 提交历史和发布记录。
