# 麦枢部署与上游维护

麦枢的控制面和执行面独立部署。控制面运行 API、中文控制台、数据库、文件与记忆服务；执行面运行 OpenSandbox 和账户无关的工具镜像。保留上游 LICENSE、NOTICE。

## 目录和服务隔离

使用 `/opt/maishu/releases/<版本>`、`/opt/maishu/current`、`/var/lib/maishu`、`/etc/maishu`；服务名使用 `maishu`、`maishu-sandbox`。不要覆盖已有 OMA 的目录、数据库、存储桶、密钥、端口或 systemd unit。

默认部署一个控制实例和一个 Docker OpenSandbox 后端。OpenSandbox 生命周期 API、execd、ACP relay 都必须可从控制节点到达，使用专用网络或网关。只开放生命周期 API 不足以运行会话。

控制面的原版变量 `SANDBOX_PROVIDER=opensandbox`、`OPENSANDBOX_DOMAIN`、`OPENSANDBOX_PROTOCOL`、`OPENSANDBOX_API_KEY`、`SANDBOX_IMAGE` 继续有效。镜像列表用 `SANDBOX_IMAGES`；品牌用 `CONSOLE_BRANDING_DIR`。兼容配置名保留在部署接入边界，不要求操作者手工改源码。

## 执行环境

见 `runtime/`。通用工具和三种执行引擎预装进有版本的镜像，镜像不含用户认证。大型工具可另做扩展镜像。依赖下载缓存按客户隔离，项目依赖按项目和运行时版本隔离。不能把整个宿主机 home、Docker socket 或所有客户的凭证目录共享给任务。

`OPENSANDBOX_VOLUMES` 为部署级挂载。不要把它误认为已经支持用户任意的每项目挂载；上线多个客户前必须验证挂载授权与目录隔离。默认通过控制台加密保存引擎凭证，按工作区与智能体授权，经二进制接口注入，再由启动包装复制到本次会话 native home；无需宿主机认证卷。只读挂载指定账号目录是可选手工路径。认证更新和会话原生状态持久化是两件事，令牌刷新不应盲目覆盖权威凭证。

## 跟随上游

1. `node scripts/maishu/check-upstream.mjs --fetch` 查看新差异，记录基线提交。
2. 在升级分支合并上游，按品牌、控制台、后端配置、认证的独立提交解决冲突。
3. 检查数据库迁移和公开契约，运行受影响的存储及执行边界测试。SQLite 测试不能替代 PostgreSQL/MySQL/D1 的支持验收。
4. 先发布测试实例，验证真实会话、审批、三引擎、文件下载、记忆、恢复和凭证隔离。
5. 数据库及私密配置在服务器独立备份；通过后切换 `current`，只重启麦枢服务。数据库有不兼容迁移时，回退必须恢复匹配的数据库，不能只换回旧程序。
6. 验收通过后更新 `upstream.json` 基线。控制面、工具镜像和 Harness 分别版本化；不自动改变正在运行的会话镜像和认证来源。

## 发布边界

源码保留上游的协议兼容字段和真实第三方依赖标识。客户可见品牌、部署资源使用麦枢；内部协议与持久状态的进一步改名必须有迁移和回归，不使用全仓字符串替换。npm 包未公开发布前，不在安装指引中声称 `npx @maishu/cli` 可用。

## 发布与升级回归（当前 Node 发行版）

以下命令从仓库根目录执行。构建使用 Node.js 24 和仓库固定的 pnpm 版本；客户端安装器要求 Node.js 22+。

```sh
pnpm install --frozen-lockfile
pnpm --filter @open-managed-agents/main-node typecheck
pnpm --filter @open-managed-agents/control-plane-node typecheck
pnpm --filter @openma/cli typecheck
pnpm exec tsc -p apps/main/tsconfig.json --rootDir . --noEmit
```

核心边界回归：

```sh
(cd apps/main-node && ../../node_modules/.bin/vitest run --config vitest.config.ts \
  test/sandbox-backend.test.ts test/harness-credentials.test.ts test/maishu-api-aliases.test.ts)
(cd apps/main-node && ../../node_modules/.bin/vitest run --config vitest.sandbox-backend.config.ts)
(cd packages/cli && ../../node_modules/.bin/vitest run --config vitest.config.ts test/maishu-product.test.ts)
python3 -m unittest discover -s deploy/maishu/runtime -p 'test_*.py'
```

存储集成测试会启动临时 PostgreSQL/MySQL 容器，需要可用 Docker。它验证新配置和账户凭证的加密、并发 CAS、工作区隔离、会话版本绑定和撤销；不等于这两种数据库上的全部 Harness 真实模型链均通过。数据库切换、迁移、Harness 变更仍须按所改边界执行实测。CLI 产品测试会自行构建客户端，并以临时目录验证安装，不修改使用者的真实登录目录。

控制台构建后发布客户端入口：

```sh
node packages/cli/scripts/build-maishu.mjs \
  --output-dir apps/console/dist/downloads \
  --base-url https://你的平台地址
```

把实际控制台产物目录中的 `downloads/` 连同前端一起发布；若构建输出目录不同，调整 `--output-dir`。发布后检查 `/downloads/install.sh`、`/downloads/maishu.mjs`、`/downloads/SHA256SUMS` 均可获取，安装器的默认平台地址正确，客户端 `sessions --help` 为中文，`--json` 保留原始 API 结构和客户文字。详见 `cli/README.md`。

### 能力与兼容范围

- Node 新功能：控制台管理默认 OpenSandbox 后端、不可变配置版本和会话绑定、实例管理员管理的加密账户文件、Codex/Claude Code/DeepSeek Harness 受控原生认证入口。
- Node 当前未实现 Bridge 配对整条服务端流程，控制台依据 `/v1/maishu/capabilities` 明确显示不可用；不要将 CLI 中存在 `bridge` 命令误认为服务端已支持。
- CF 保留原有 Bridge、沙箱等实现，并提供 `/v1/maishu` 品牌扩展路径别名；新增 Node 沙箱设置和账户凭证管理在 CF 能力接口中为不可用。本轮不声称这些 Node 新功能已在 CF 实现。
- `/v1/oma` 和 `_oma` 等既有协议、持久化字段继续兼容；新扩展入口使用 `/v1/maishu`。别名复用原 handler 和中间件，不通过绕过鉴权的 request 重写实现。

### 真实执行与旧服务共存验收

测试发布前后分别记录旧 OMA 和新麦枢的服务、端口、存储目录及健康状态。只切换麦枢自身的 `current` 和服务，不覆盖旧 OMA 的配置或数据。新后端地址通过控制台更改后，必须验证旧会话仍使用其绑定版本、新会话使用新版本；服务健康响应和连接端口可达不能代替任务成功。

至少验证一个真实任务的创建、执行、提问/审批、中断、续聊、文件下载和记忆回写。分别记录 Codex、Claude Code、DeepSeek Harness 的实际结果；未运行或缺少账户的引擎必须标为未验证，不能由假 Agent 或配置检查替代。临时探针和任务结束后核对遗留容器，并确认旧 OMA 仍可使用。

### 原生账户刷新与恢复边界

控制台更新账户认证只影响新会话；已绑定会话继续使用其首次执行的加密版本。每次执行仍重新检查当前授权，删除或撤回授权阻止后续注入，但不会收回运行进程已持有的上游 token，需要服务商侧撤销才能完成该动作。

同一个 native home 重启时保留引擎已刷新的认证，不用旧源覆盖它；刷新结果不会自动写回平台。多个会话使用同一轮换型 refresh token 时，目前没有账户级单写刷新协调，不能声称已解决并发刷新。源认证或会话 pin 失效时，应重新授权并创建新会话，不通过共享可写认证文件来回避。

原生认证禁止全容器快照，避免 `/run` 和 `/tmp` 私密认证被存入镜像。仍存活沙箱的热继续与沙箱销毁后的冷恢复是两个验收项目。工作区和引擎原生会话白名单提供的是可用的持久化构件；本轮若没有完成“容器销毁→恢复工作文件→继续原逻辑会话”的真实测试，就必须保留冷恢复未验收状态。禁止把新建空工作区或仅重放聊天摘要标为完整恢复。

### 独立 Node 发布包

小控制 VPS 可以只解包运行，把安装依赖和前端构建放在构建机或执行端完成。以下操作使用当前 checkout 的锁文件和依赖，不读取任何已部署实例。打包前请提交源码，脚本默认拒绝未提交改动和未追踪文件；生成的构建目录应由 Git 忽略。

```sh
# 使用 Node.js 24，先在构建机安装并生成所需产物
pnpm install --frozen-lockfile
pnpm --filter managed-agents-console build
node packages/cli/scripts/build-maishu.mjs \
  --output-dir apps/console/dist/downloads \
  --base-url https://你的平台地址
pnpm --filter @open-managed-agents/sandbox-egress build

node scripts/maishu/package-node.mjs \
  --output-dir ../releases/maishu-control-版本号 \
  --runtime-image maishu-runtime:镜像版本 \
  --worker-version Worker版本 \
  --smoke-test \
  --tar ../releases/maishu-control-版本号.tgz
```

发布目录包含已追踪源码、控制台与 CLI 下载产物、egress 产物，以及从当前 pnpm 虚拟存储计算出的运行依赖闭包。必需依赖、选定 OpenSandbox SDK、tsx 和三种 SQL 驱动缺失时失败；可选依赖仅在当前平台确实存在时包含，缺失记录在 `release-manifest.json`。不包含 `.git`、`work`、`outputs`、实际环境文件或账户认证文件。清单记录源码提交、上游基线、锁文件摘要、Node/系统/架构及独立的镜像、Worker 版本；这两个执行端组件不会由控制端打包脚本自动构建或发布。

`--smoke-test` 在临时目录中启动仅监听回环地址的独立 Node 服务，以临时 SQLite 和随机测试密钥检查 `/health` 并导入 OpenSandbox SDK；不启动真实任务、不调用模型、不连接正式沙箱，也不修改生产配置。该检查不代替远程执行、订阅认证或真实 PostgreSQL/MySQL 生命周期验收。

在与构建机兼容的系统、CPU 架构和 Node.js 24 上解包后，从发布目录运行：

```sh
node --env-file=/etc/maishu/control.env --import tsx apps/main-node/src/index.ts
```

正式凭证仍保存在服务器独立配置和平台凭证库中。不要把整个旧实例的 `node_modules`、认证目录或数据库合并进新发布；原版 Dockerfile 仍是可选部署路径。

### 可信管理入口与后端配置导入

当前 Work 执行路径除双向 ACP 通道外，还需要可信管理进程。工具镜像预装并在 entrypoint 启动管理服务，部署设置 `OPENSANDBOX_MANAGED_BOOTSTRAP=1`；控制台保存新后端版本时会启用该契约。探针现在会实际验证管理进程启动、身份与 holder 绑定、重新附着和停止，缺少管理入口不能再以“文件和命令可用”视为通过。

后端版本固定包括“字段不存在”的状态。升级服务环境中的镜像、挂载或管理开关不会渗入旧会话。管理员更新执行侧 worker 挂载版本后，可向 `/v1/maishu/admin/sandbox-backend/import-environment` 提交当前 `expectedRevision`，把服务启动配置导入为一个新的不可变版本；接口不回传密钥，也不改变旧会话绑定。之后再创建新会话验证。普通控制台保存只修改页面字段并保留原版本中的其他部署参数，不能当作自动导入新环境变量。

只读重新附着用于控制进程重启后，仍存活且有可信管理 locator 的 worker 提交结果。它保留 claim generation、启动器 epoch、PID、holder 和权限检查，不调用普通 resume 来冒充只读。该能力与执行容器被销毁后的冷恢复仍是不同项目：发布验收应分别记录同容器第二轮、控制进程重启、容器销毁三种结果。

### 跨 VPS 的管理调用等待预算

`MAISHU_MANAGEMENT_RPC_WAIT_MS` 只配置 Node 控制端对安全管理 RPC、提供商续租和进程发现的单次等待。默认仍为 `1000` 毫秒，允许正整数 `1—89999`；跨 VPS 可依据实际延迟选择 `5000—10000`。它不改变 Work 租约、SQL fence、进程 epoch/holder 或 single-flight：等待超时后底层调用仍在 pending，同一操作继续加入原调用，不会启动重复操作。应先查明网络、执行进程和底层服务的原因，再决定是否调整预算；延长等待不是执行成功的证明。
