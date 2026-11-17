# 麦枢通用执行镜像

镜像只包含软件，不接收账户认证作为构建参数。使用现有的远程 OpenSandbox 和
`acp-sandbox` 执行通道；不引入第二套任务调度器。

```bash
docker build -f deploy/maishu/runtime/Dockerfile -t maishu/runtime:20261117 .
python3 -m unittest discover -s deploy/maishu/runtime -p 'test_*.py' -v
```

## 平台管理进程

云类型环境中的 ACP 会话需要平台 Work 管理进程，只有 ACP 软件还不能领取任务。
在已安装项目依赖的源目录运行（不要求 `.git` 存在）：

```bash
node deploy/maishu/runtime/build-worker.mjs
```

产物为 `work/maishu-worker/runner.mjs` 和摘要清单。部署到执行机专属版本目录，
例如 `/var/lib/maishu/runtime/2026.11.17-alpha1/`，将目录只读挂到
`/opt/maishu-worker`，控制端设置：

```dotenv
OPENMA_WORK_RUNNER_COMMAND=/usr/local/bin/node
OPENMA_WORK_RUNNER_ARGS=["/opt/maishu-worker/runner.mjs"]
```

`OPENMA_ACP_HARNESSES` 使用本目录 `harnesses.json` 的紧凑 JSON。新环境/Agent
的 command/args 必须与安装清单完全一致。后端配置版本要冻结该只读挂载来源，避免
升级管理进程时影响已有会话。Work 派发只转交非秘密账户引用，实际认证由控制端受权
注入。管理进程会使用 scoped Work/Session capability；不把部署 API 密钥交给沙箱。

## 软件与缓存

- Node 24.22.2，Python 3.12.12，uv 0.11.6，pnpm 11.28.12。
- Codex 0.166.0、Codex ACP 1.8.0、Claude Code 2.1.326、Claude ACP 0.94.0、
  DeepSeek Harness ACP 0.4.41（其独立发行包自带所锁定的 Harness 运行时）。
- npm 依赖使用本目录的 lockfile；基础工具包括 git/curl/jq/rg/zip/unzip/ssh、编译工具。
- Office、浏览器、视频和三维工具按环境镜像扩展，不在每次会话里全量安装。
- npm/pnpm/uv 项目依赖默认留在该沙箱，不挂载跨客户共享可写缓存。若配置持久缓存，
  使用专属租户和项目目录；共享制品缓存只能作为只读来源，认证目录不属于缓存。
- apt 工具受固定 Debian 发行版仓库约束，构建时仍会取得安全更新；它们不是逐包
  快照锁定。交付部署必须记录实际镜像 digest 和软件清单，不能把标签当不可变版本。
- Work 管理进程使用替换环境，不能依赖镜像继承的 `PATH`。平台给管理进程提供可信
  基础路径，执行包装使用固定绝对引擎路径并补齐可信工具路径。

## OpenSandbox 管理入口

本次 Node Work 路径要求 safe management process 接口，原版 OpenSandbox 适配器只有
ACP 双向进程，并不能仅凭连接探测成功就认定完整任务可执行。麦枢适配器启用
`OPENSANDBOX_MANAGED_BOOTSTRAP=1` 时指定可信入口 `/usr/local/bin/maishu-managed-init`。
它在任务开始前启动仓库既有管理 launcher，保留原有 flock、epoch、holder 绑定和
精确进程清理算法。控制端经管理文件通道调度，不能用普通命令工具模拟进程状态。

执行端使用麦枢独立 Docker daemon；不要在同一 OpenSandbox 管理范围中混入旧平台沙箱。
新 daemon 的 DNS 需要能解析控制域名；私网 MagicDNS 场景可配置
`100.100.100.100` 与适用的公共 DNS，真实容器中验证 DNS、HTTPS 和 TLS 校验。

单控制实例使用 LocalFs 文件后端时，麦枢为 standalone OpenSandbox 复用已有的
SQL fencing＋final_collect 输出实现，将执行端产物收集到控制端 BlobStore。
LocalFs 不因此变成可跨多控制副本共享的存储；多控制副本仍需共享对象存储。

## Agent 启动配置

三种预设均使用 `/usr/local/bin/maishu-harness`，引擎参数分别为 `codex`、`claude`、
`dsh`，身份分别为 `codex-acp`、`claude-acp`、`dsh-acp`。

```json
{
  "harness": "acp-sandbox",
  "acp": {
    "agent": {
      "id": "codex-acp",
      "command": "/usr/local/bin/maishu-harness",
      "args": ["codex"],
      "env": {
        "MAISHU_AUTH_MODE": "native",
        "MAISHU_CREDENTIAL_REF": "codex-default"
      }
    }
  }
}
```

这些字段放在 Agent 的扩展配置中。它们均不是秘密。上游原生状态适配器负责生成
每会话的 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 或 `DSH_HOME`，包装只接受
`/tmp/openma-harness-state/` 下的目录。不要将它们手工改成工作区路径。

`managed` 模式保留平台已生成的模型网关配置和短期 token，不读取外部账户目录。
`native` 模式复制当前引擎的白名单认证文件，并移除会与原生登录冲突的网关环境变量。
Codex 原生模式默认写入 `model_provider="openai"`；如需选择原生模型，可在受控账户
目录提供不含额外秘密的 `config.toml`。Claude 原生模式可提供 `settings.json`。
DeepSeek 原生文件模式指 API key 配置，不宣称存在通用的“订阅登录”。

## 认证挂载契约

由管理员在执行 VPS 上准备专属账户目录，仅通过 OpenSandbox volume 配置挂载：

```text
宿主机上的已授权账户目录
    → /run/maishu-credentials/codex-default（只读）
       └─ auth.json
```

不要将所有客户的凭证总目录挂载给每个沙箱。每个环境只挂载被授权的账户。不要将
普通 Files、Memory Store 或 Session env 用作凭证存储；也不要在 Agent 启动参数中
包含认证 JSON。

正式控制台使用独立的执行账户凭证 API：`/v1/oma/admin/harness-credentials`。
只有实例管理员或部署密钥可管理，数据使用现有加密组件和跨数据库 KV 存储，响应
只含元数据。管理员明确授权 Agent ID，或显式授权整个工作区。Agent 配置只保存
`hc_…` 引用。执行前检查工作区、Agent、引擎和受控启动入口，再通过二进制写入接口
注入 `/run/maishu-credentials/<hc_id>/`。这个正式路径不需要宿主机认证卷。

每个会话用 CAS 固定初次执行的账户版本。更新只影响新会话；每次执行仍检查当前授权，
删除或撤销授权会阻止后续执行。删除会清理平台中的该账户绑定；运行中的进程已经
持有的上游 token 无法凭平台删除操作收回，需在服务商侧撤销。

认证文件白名单：Codex `auth.json`；Claude `.credentials.json`；DeepSeek
`.credentials.yaml`。它们被复制到会话私有 native home，文件权限为 `0600`。
沙箱中的 Agent 能读取它自己的认证，这一模式不承诺对不受信任务隐藏账户 token。
部署者应选择容器隔离和可授予该账户的业务范围。

认证不写入 `/workspace`、事件或产物；包装报错不打印解析异常内容。上游的会话
便携状态白名单不包含认证文件。但是整容器快照可能保存 `/tmp`，因此原生凭证模式
禁止创建和导出全容器镜像/快照，Node 执行通道对原生认证强制阻止 provider 全容器
checkpoint，并拒绝包含认证根目录的工作区快照。恢复只可使用工作区和声明的会话文件。
目前热继续可以复用仍存活的沙箱；不能仅凭取消全容器快照就宣称已完成原生 Work
路径的冷恢复，需要单独验收 workspace-only 检查点线路。

## 刷新和生命周期边界

包装首次启动复制源认证；同一 native home 重启时保留已有认证，避免覆盖引擎刚刷新
的 token。刷新结果不自动回写只读挂载源，也不上传为普通产物。新容器重新取受控源。
因此本实现不是持久 OAuth 刷新代理。源认证失效时管理员重新授权/更新源后创建新会话。

同一账号的多个会话如同时刷新轮换型 token，会有竞态。不能通过共享可写 auth 文件
或“最后写入胜出”解决。需要可靠多会话刷新时，应另做账户级单写刷新和版本 CAS，
或者使用经验证的模型网关认证；不能把当前方案宣称为已经实现。

## 验收

本目录测试只验证文件边界、权限、原生/API 模式分离、拒绝路径跳转和保留刷新副本。
安装成功或 health 正常不等于引擎可用。每种引擎真实认证后分别验证一次模型响应、
工具执行、会话继续、沙箱替换恢复、取消、认证失效提示和跨账户隔离。真实模型验收
由部署负责人执行；不要由镜像构建或单元测试自动触发计费任务。

## Work 引擎兼容矩阵

跨 VPS 的 Work checkpoint 会收集记忆和产物，HTTP 等待时间由控制端运营配置
`MAISHU_WORK_FINALIZATION_REQUEST_TIMEOUT_MS` 指定，默认 `30000`，合法范围
`1..89999` 毫秒。控制端仅向可信 Work 进程转发该值。本部署使用 `75000`；它只
调整 `work-checkpoint` 的等待，其他终端写入仍使用原来的 30 秒等待和未知结果屏障。
SQL 租约、holder/generation 检查、单飞与有限重试规则保持原有语义。

控制台能选择、ACP 能 initialize、认证文件格式正确，都不等于 Work 任务可执行。
当前平台公共运行库 `@openma/common 0.14.0` 的原生权限映射与本项目的工具完成门禁
都按确切版本验证，升级时必须一起重新认证，不能伪造版本或移除门禁。

| 引擎组合 | 原生权限 profile | 同步工具完成 profile | 当前结论 |
| --- | --- | --- | --- |
| Codex CLI 0.166.0 + Codex ACP 1.8.0 | 已有 | 已有 | 本产品选择此版本；CLI 覆盖组合仍需真实工具与续聊验收 |
| Codex ACP 1.10.0 | 已有 | 当前未列入 | 不能仅因权限可设置就当作完整 Work 支持 |
| Codex ACP 2.6.0 | 未列入 | 未列入 | 实机 initialize/session-new 成功，但 Work 在推理前被权限门禁拒绝；不作为当前生产预设 |
| Claude Code 2.1.326 + Claude ACP 0.94.0 | 已有 | 已有 | 入口与协议可启动；未提供真实 Claude 账户时不能宣称已完成订阅认证验收 |
| DeepSeek Harness 0.2.1-rc.5 + ACP 0.4.41 | 麦枢精确版本补丁 | 麦枢精确版本契约 | 原生三权限模式、真实本地工具与后台拒绝的离线协议验收已通过；真实 DeepSeek 账户推理待客户密钥，详见 `DSH-COMPATIBILITY.md` |

当前 `always_ask / auto / always_allow` 在已认证 Codex profile 分别映射到
`read-only / agent / agent-full-access`，Claude 分别为
`default / auto / bypassPermissions`。必须通过 `session/set_config_option` 响应和
当前会话状态同时回读确认；一个空 ACK 或进程仍在运行不能证明权限已应用。

## DeepSeek Harness 的预装与版本

`dsh-acp` 与真正的 DSH CLI 是两个版本。本镜像锁定适配器
`@openma/deepseek-harness-acp@0.4.41`，其已发布包内携带官方
`@deepseek-ai/dsh@0.2.1-rc.5` 的锁定运行时压缩包。原版 standalone 会在缓存
缺失时解包；这不是下载模型，但每个新会话使用新 HOME 时仍会重复进行大量解包。

麦枢在镜像构建时一次完成：

1. 按 `dsh-runtime.json` 校验适配器版本、官方 DSH 版本、归档 SHA256，以及
   归档内 package-lock 与官方 npm tarball/integrity 的对应关系。
2. 使用适配器自带的受支持 materializer 解包到镜像 `/opt` 目录，包含所需外部包。
3. 安装真正的 `/usr/local/bin/dsh`，执行 `dsh --version` 验证。
4. 固定 `/opt/maishu-dsh` 为执行源。受控包装强制 `DSH_PATH` 和 `DSH_ACP_HOST`，
   即使 Work 清空镜像继承环境也会设置；不允许参数把路径改成 `bundled` 触发新缓存。

该步骤不增加 npm/系统依赖，不更改 Codex 或 Claude Code 的版本；利用现有已锁定
归档，增加的是镜像中预解包的运行时文件。构建期间不接触账户凭证。

`verify-dsh.py` 在两个全新临时 DSH_HOME 下执行完整离线门禁：验证 CLI 版本，先
发送无密钥 `session/new` 并确认正式认证拒绝，再以明确的合成测试值调用官方
`authenticate` 后创建 Session，确认显式运行时且没有重新 materialize。始终不发送
`session/prompt`，不使用真实账户。专用容器以 `--network none` 实测通过。
这证明软件和 ACP Session bootstrap 可用，不证明真实 DeepSeek 账户或模型调用。
Work 权限与活动契约的独立离线验收见 `DSH-COMPATIBILITY.md`，真实账户推理仍须分别验收。

可单独在账号无关的镜像容器中执行：

```sh
python3 /usr/local/lib/maishu/verify-dsh.py
```

它只创建临时认证和会话数据并清理，不读取客户认证目录。升级 DSH 时同步更新
`dsh-runtime.json`，重新核实官方 npm 信息并执行离线门禁，不使用 `latest`。
