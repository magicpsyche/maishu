# 麦枢命令行

从终端驱动麦枢平台，沿用上游兼容 API。产品入口为 `maishu`，配置使用 `MAISHU_BASE_URL`、`MAISHU_API_KEY`、`MAISHU_TENANT_ID` 和 `MAISHU_PROFILE`。

在源码仓库构建：

```sh
pnpm --filter @openma/cli build:maishu
MAISHU_BASE_URL=https://your-console.example node packages/cli/dist/maishu.js auth login
```

CLI 登录凭证独立保存在 `~/.config/maishu/`，接入机器的 Bridge 状态保存在 `~/.maishu/bridge/`。原有 `oma` 入口保留用于上游兼容，不会自动迁移或覆盖旧凭证。产品包尚未发布到 npm，使用构建产物安装。

常用命令包括 `auth login`、`agents list`、`sessions create`、`sessions chat`、`envs list`、`bridge setup`。详见 `--help`。当前内部命令帮助仍有英文，中文化验收应单独记录。

基于 Apache-2.0 许可的上游 CLI 修改，适用许可和归属见仓库 LICENSE、NOTICE。
