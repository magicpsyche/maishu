# DSH 0.4.41 兼容补丁

本版本只认证 `dsh-acp@0.4.41`，软件核心为适配器随附的 `@deepseek-ai/dsh@0.2.1-rc.5`。镜像在构建时预装这套软件；任务不重新下载或解包。账户推理仍须配置客户自己的有效凭证。本次验收使用无外网容器、回环假模型和合成凭证，没有调用真实 DeepSeek 账户。

## 固定版本与上游维护

`@openma/common@0.14.0` 的权限映射没有公开注册接口。`pnpm-workspace.yaml` 和 `package.json.pnpm` 镜像声明同一个 `patchedDependencies`（pnpm 11.0.8 的配置查询可读 YAML，但实际 patch resolver 仍需要后者），正式应用 `patches/@openma__common@0.14.0.patch`，只增一条精确握手身份 profile；没有更改原来的待决 RPC、超时、取消、原生配置读回或未知版本拒绝逻辑。不能直接修改 node_modules 交付，也不能把 DSH 冒充其他适配器。

核验的公开 npm 产物源文件 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `@openma/deepseek-harness-acp@0.4.41/dist/server.js` | `c42aed91e17287f526f6c2ca32d1828e45a2cccd23ee7e88c0d9b5647ba37c91` |
| 同包 `dist/index.js` | `b378a2efa5227c1b1e56d2ab0d6a0602a12115ee3927e2d15a4cdaba807a424f` |
| 同包 `vendor/dsh-runtime.tgz` | `7a957f2d27c588cdc0949b9407584a09b438db7ca339d3cc6ae866ceac784559` |

升级 common 或 DSH 时必须重新验证补丁上下文、握手身份、模式含义和工具生命周期，不能仅放宽版本列表。镜像的其他软件 pin 由 `package.json`、`package-lock.json` 和 `harnesses.json` 管理。

## 权限映射

| 平台模式 | DSH 原生 mode | 核验语义 |
| --- | --- | --- |
| `always_ask` | `read-only` | 文件写入受只读沙箱限制；这比逐次询问更严格，不代表每次只读操作也弹确认 |
| `auto` | `workspace-write` | 工作目录内可写，扩大沙箱权限要确认 |
| `always_allow` | `danger-full-access` | 不限制文件访问，原生批准策略为 `never` |

适配器 `applyMode` 写入实际 sandbox mode，并将批准策略设为 `ask/ask/never`；`session/set_config_option` 返回实际 `configOptions`。通用 helper 同时验证响应和会话最新状态。离线实测三种模式读回，实际执行写文件：只读模式拒绝文件写入，其他两种模式成功。这里的沙箱模式是 DSH 的文件访问策略，外层 OpenSandbox 容器仍然存在。

## Work 完成证明

DSH 的 `tool_call_update.status=completed` 和显示用的 `_meta.terminal_exit.exit_code=0` **不证明命令已经退出**。实际超时命令会被提升为后台任务，同时发出这两个值。结构化结果保存在 `_meta.dsh.toolResult.value`：

- 前台结束：`kind=foreground`，含实际 `exitCode` 或退出 `signal`。
- 超时转后台：`kind=promoted`，含 `jobId`。
- 显式后台：`kind=background`，含 `jobId`。

`WorkTurnActivities` 只对精确 DSH 身份启用额外规则。执行工具必须有结构化前台退出证据；后台标记持续保留，后续看似完成的更新不能抹掉。原生 `read/edit/search` 的同步完成可接受。其他工具、定时任务、扩展、子智能体或后台任务仍须平台持有的真实 completion join；目前未接这种 join，遇到它们会拒绝完成发布。这是当前兼容范围，不能宣称所有 DSH 后台与子智能体能力已适配。

工具 trace 夹具 `packages/harness-runtime-acp/test/fixtures/dsh-native-0.4.41.json` 来自实际无网络容器里的合成会话。针对测试同时覆盖未认证版本、坏模式读回、超时后重复写入、后台提升、终端显示伪退出、未知活动和晚到通知。

## 可重复验收

安装正式 pnpm 补丁后，在 `packages/harness-runtime-acp` 下执行：

```sh
../../node_modules/.bin/vitest run test/dsh-work-profile.test.ts test/node-work-composition.test.ts
../../node_modules/.bin/tsc --noEmit
```

将 `verify-dsh-work.py` 放到执行机后，在专用 Docker daemon 的临时容器运行，不挂载任何凭证或生产目录：

```sh
docker --host unix:///run/maishu-docker.sock run --rm --network none \
  --mount type=bind,src=/absolute/path/verify-dsh-work.py,dst=/verify-dsh-work.py,readonly \
  --entrypoint python3 maishu-runtime:2026.11.17 /verify-dsh-work.py
```

脚本只监听 `127.0.0.1`，使用临时 DSH_HOME 和显式预装 runtime。验收包含真实 `session/new`、模式读回、真实 bash/read/write/glob/grep、前台结束、自动转后台和显式后台；不会把 initialize 成功代替工具调用。后台负例在返回时尚未写出 marker，随后进程结束，证明显示终端退出不能作为 Work drain 依据。
