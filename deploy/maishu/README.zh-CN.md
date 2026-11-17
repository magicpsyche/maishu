# 麦枢部署与上游维护

麦枢的控制面和执行面独立部署。控制面运行 API、中文控制台、数据库、文件与记忆服务；执行面运行 OpenSandbox 和账户无关的工具镜像。保留上游 LICENSE、NOTICE。

## 目录和服务隔离

使用 `/opt/maishu/releases/<版本>`、`/opt/maishu/current`、`/var/lib/maishu`、`/etc/maishu`；服务名使用 `maishu`、`maishu-sandbox`。不要覆盖已有 OMA 的目录、数据库、存储桶、密钥、端口或 systemd unit。

默认部署一个控制实例和一个 Docker OpenSandbox 后端。OpenSandbox 生命周期 API、execd、ACP relay 都必须可从控制节点到达，使用专用网络或网关。只开放生命周期 API 不足以运行会话。

控制面的原版变量 `SANDBOX_PROVIDER=opensandbox`、`OPENSANDBOX_DOMAIN`、`OPENSANDBOX_PROTOCOL`、`OPENSANDBOX_API_KEY`、`SANDBOX_IMAGE` 继续有效。镜像列表用 `SANDBOX_IMAGES`；品牌用 `CONSOLE_BRANDING_DIR`。兼容配置名保留在部署接入边界，不要求操作者手工改源码。

## 执行环境

固定任务默认使用 `OMA_WORKSPACE_STRATEGY=ephemeral`，复用原版配置，不为每轮执行上传整个工作区。聊天事件、正式发布的产物和附加 Memory Store 独立持久保存；临时目录不是产物存储。一次定时触发宜创建独立会话，所需文件和记忆通过资源重新挂载。`ephemeral` 不代表每轮都会立即销毁容器，也不会自动把已有会话拆成独立任务。

同一个仍存活的沙箱可以继续使用；沙箱销毁后不承诺恢复原项目目录或原生线程。失败任务应显示失败或中断，由业务重试策略决定是否重新执行；发送消息、付款、发布等外部副作用不能凭聊天记录自动重放。需要连续修改项目的任务再采用持久目录或显式启用 `checkpoint_restore`。目前该配置是实例级选项，不是控制台中已实现的逐任务开关；既有冷恢复实现保留，启用时仍须满足其存储和容量条件。

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

### 从干净源码部署双 VPS（systemd 模板）

`systemd/`、`execution.env.example`、`docker.json.example`、`opensandbox.toml.example` 和
`prepare-execution-network.sh` 提供可人工审阅的部署模板，不会自动安装或覆盖服务。
本节对应 Linux/systemd、Docker Engine 29.1.3、Python venv 中的
`opensandbox-server==1.2.1`、控制端 Node.js 24（本轮实际为 24.22.2）。
OpenSandbox 客户端 SDK 由仓库锁文件固定为 1.1.1。其他版本需重新验证配置和并存行为。
执行端的 Python 服务拥有创建容器的权限，应作为受信部署组件运行。

两台 VPS 都需要 root 完成首次配置，并已接入独立、可控的 Tailscale 网络。
控制端需要 Node.js 24、systemd、Nginx、DNS-01 获取的 TLS 证书，以及所选 SQL
后端或本地 SQLite。执行端需要现有 Docker Engine/containerd、Docker CLI、
Python 3.11+ 与 venv/pip、`iproute2`、`iptables`、`procps`、systemd。
不要为安装本产品重装或重启已有 Docker。构建机还需要仓库固定版本 pnpm；
已有 OMA 的目录、容器、Docker 默认 socket、数据库和秘密均不作为安装来源。

1. **构建并上传版本。** 按前文生成独立控制端发布包；用
   `runtime/build-worker.mjs` 生成本版 Worker，保留其摘要。
   两端分别解包所需源码/部署资产到 `/opt/maishu/releases/RELEASE/`，将
   `/opt/maishu/current` 指向该版本。控制端 Node.js 安装到独立目录，建立
   `/opt/maishu/tooling/node24` 符号链接；模板使用该路径，不改变系统默认 Node。
   执行端 Worker 上传至 `/var/lib/maishu/runtime/RELEASE/`，文件只读。
   每个发布单独记录源码提交、Worker 摘要及最终镜像 digest。

2. **准备执行端配置。** 新建专属目录，不迁移旧 OMA 的文件：

   ```sh
   install -d -m 0700 /etc/maishu /var/lib/maishu/opensandbox
   install -d /var/lib/maishu/docker /var/lib/maishu/runtime /var/lib/maishu/projects /var/lib/maishu/cache
   python3 -m venv /opt/maishu/opensandbox-venv
   /opt/maishu/opensandbox-venv/bin/pip install 'opensandbox-server==1.2.1'
   /opt/maishu/opensandbox-venv/bin/pip freeze > /etc/maishu/opensandbox-requirements.txt
   install -m 0600 deploy/maishu/execution.env.example /etc/maishu/execution.env
   install -m 0600 deploy/maishu/opensandbox.toml.example /etc/maishu/opensandbox.toml
   install -m 0600 deploy/maishu/docker.json.example /etc/maishu/docker.json
   ```

   编辑环境和 TOML 文件。`docker.json` 保留空对象，其他引擎参数已显式写在 unit；
   独立配置路径避免新 daemon 继承旧 `/etc/docker/daemon.json`。
   `execution.env` 的地址是非秘密参数，必须是两台机器实际的
   Tailscale IPv4；脚本会检查执行地址确属本机。TOML 中两个 `EXECUTOR_TAIL_IP`
   必须替换成同一执行地址，不能使用 `0.0.0.0`；替换随机执行 API key，并将
   同一值安全写入控制端配置，不放进命令历史、Git 或镜像。TOML 不展开环境变量。
   默认 `maishu0=172.30.0.1/24`；脚本遇到接口或路由网段冲突会停止，需先重新规划。
   这些命令从已解包的发布目录执行。

3. **启动独立容器服务。** 初次安装先核对没有同名麦枢服务，维护已有实例时使用
   下文维护窗口流程。只复制本产品的 unit：

   ```sh
   install -m 0644 deploy/maishu/systemd/maishu-docker.service /etc/systemd/system/
   install -m 0644 deploy/maishu/systemd/maishu-sandbox.service /etc/systemd/system/
   sh -n deploy/maishu/prepare-execution-network.sh
   systemd-analyze verify /etc/systemd/system/maishu-docker.service /etc/systemd/system/maishu-sandbox.service
   systemctl daemon-reload
   systemctl enable --now maishu-docker.service
   docker --host unix:///run/maishu-docker.sock info --format '{{.DockerRootDir}}'
   docker --host unix:///run/maishu-docker.sock pull opensandbox/execd:v1.1.0
   # 在有源码和构建依赖的执行端构建；也可从构建机导入已校验的镜像归档。
   docker --host unix:///run/maishu-docker.sock build -f deploy/maishu/runtime/Dockerfile -t maishu-runtime:2026.11.17 .
   systemctl enable --now maishu-sandbox.service
   ```

   输出 DockerRootDir 必须是 `/var/lib/maishu/docker`。模板显式隔离 socket、
   data-root、exec-root、pidfile、containerd namespace=`maishu`、插件 namespace
   `plugins.maishu`，并使用自建 `maishu0`；不会将旧 Docker 的容器纳入新后端。
   `prepare-execution-network.sh` 只重建本产品的 `MAISHU-*` 链和对应跳转，
   不清空系统表、不改默认策略、不删除旧 `DOCKER*` 链或旧桥；它启用 IPv4 转发，
   为本产品网段提供 NAT，限制执行端 API/动态端口的来源，并限制沙箱到控制端
   Tailscale 地址的出站 TCP 端口。非 443 控制入口需调整
   `MAISHU_CONTROLLER_PORT`；确有其他私网服务需求时审阅这条专属链再放行。
   这组更窄的模板规则已做静态检查，尚未替换现网规则做整机实测。

4. **可选出站 HTTP 代理。** 默认直连，不安装 `maishu-egress.*`。
   若客户确有一个可用的 HTTP CONNECT 上游，先修改 `maishu-egress.service`
   中的转发目标，核对本发行版 `systemd-socket-proxyd` 的路径，再安装同名
   `.service/.socket` 并启用 socket。示例 `127.0.0.1:17890` 不是本产品内置服务，
   不能假定客户机器存在。随后取消 TOML 中 `[docker.sandbox_env]` 的注释，
   替换 NO_PROXY 的控制域名和两端私网 IP，重启**新** `maishu-sandbox` 后验证。
   NO_PROXY 必须覆盖控制端真实域名/IP，避免管理回调绕行外部代理。

5. **准备控制端。** 创建专属非登录系统用户 `maishu`，使其能读发布目录，
   并拥有 `/var/lib/maishu`、文件/记忆/产物目录；只授予所需权限。
   复制 `control.env.example` 到 `/etc/maishu/control.env`，设为 root 所有、0600。
   分别生成平台长期随机秘密，填写管理员身份；不要复用旧 OMA 的秘密。
   填写新的执行端 `TAIL_IP:8818`、相同执行 key、镜像标签/digest、Worker
   版本目录挂载，保留 `OPENSANDBOX_MANAGED_BOOTSTRAP=1`。
   使用只读 Worker 挂载，不挂 Docker socket、宿主机 home 或所有客户的认证总目录。
   控制端发布包必须含前端、`downloads/`、egress 产物和本版依赖闭包。

   ```sh
   install -m 0644 deploy/maishu/systemd/maishu.service /etc/systemd/system/
   systemd-analyze verify /etc/systemd/system/maishu.service
   systemctl daemon-reload
   systemctl enable --now maishu.service
   curl --fail http://127.0.0.1:8797/health
   ```

   `nginx-private.conf.example` 的占位符替换后放入新 server block，先运行
   `nginx -t` 再 reload；不要覆盖现有站点或抢占已有监听。
   DNS 使用 DNS-only A 指向控制端 Tailscale IP，TLS 用 DNS-01，Nginx 仅绑定该
   私网地址。`PUBLIC_BASE_URL`、`CONSOLE_ORIGINS` 和 CLI 下载产物的默认地址必须
   同源。可从任何未加入该私网的设备验证公网无法访问。

Tailscale ACL/宿主机防火墙至少需要：授权用户到控制端 TCP 443；控制端到执行端
TCP 8818 与 48000—49999（生命周期、execd 和 ACP relay）；执行沙箱到控制端
TCP 443（或配置的控制端口）用于受限管理回调。DNS 也必须可用。
不能只放行生命周期 API。动态端口由新 daemon 的 userland proxy 绑定执行端私网
地址；不要公网转发这些端口。模板不修改 Tailscale 管理端 ACL，需部署者按实际身份配置。

### 双 Docker 并存验收与维护窗口

**禁止给新 daemon 加 `--default-address-pool` 或 JSON `default-address-pools`。**
Moby 29.1.3 在清理自己的默认 bridge 记录时，只要显式地址池非空且 live-restore
关闭，就会直接删除主机固定名称 `docker0`，即使本 daemon 已选择
`--bridge=maishu0`。`--bridge=none` 也会进入清理路径。
详见 [同版本上游实现](https://github.com/moby/moby/blob/docker-v29.1.3/daemon/daemon_unix.go#L808-L824)。
隔离 socket/data/namespace 并不能隔离这个内核网桥副作用。
不通过切换 live-restore 或启动后强行修旧网桥掩盖该问题；本模板删除触发参数。

安装和维护前后分别记录旧服务的 MainPID/NRestarts、旧容器完整 ID/StartedAt、
`docker0` 名称/IP/MAC/网卡成员、旧存储与 OMA 的健康状态，以及新 `maishu0`。
只用显式 `--host unix:///run/maishu-docker.sock` 操作新资源。
除新平台真实任务外，还应从旧 OpenSandbox 创建一个无账户、无挂载的临时
`node:22-bookworm` 沙箱，执行 Node echo；若旧平台依赖代理，再验证 HTTP CONNECT，
随后通过原 API 删除并检查无残留。这些测试不能使用或修改旧会话和认证。

本轮现网已完成：恢复旧桥后，旧 provider 临时沙箱创建、执行、代理连接和删除均成功，
旧平台和存储健康响应为 200；旧 OMA/OpenSandbox/Docker、新 Docker 主进程和旧存储
容器均未重启。只有旧附属代理因绑定了已删除的网桥设备编号而重新绑定。
新 daemon 删除触发参数后只执行过 unit 校验和 daemon-reload；**未在真实任务运行时
重启新 daemon 验证下一次启动**。模板的语法校验不替代该维护窗口验收。

新 Docker 的重启、执行网络脚本变更、OpenSandbox 升级都需要维护窗口：停止接收
新任务，等待或明确结束新平台任务，记录容器与桥状态，先核对无地址池触发配置，
再仅重启新 `maishu-docker`，启动新 `maishu-sandbox`（以及已启用的可选代理 socket）。
重启容器引擎可能中断运行中的新任务；不要将 daemon-reload 当作已重启。
随后立即检查旧 `docker0`/旧代理、旧健康及旧临时沙箱正例，再验证新平台真实任务。
任何旧服务异常都应停止继续发布，按已记录的原桥元数据定位恢复，不能重装 Docker、
清理全部网络或重启旧 OMA 来碰运气。
