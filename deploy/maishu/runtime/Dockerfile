# syntax=docker/dockerfile:1.7
# Build from the repository root. Account credentials are never build inputs.
# Node 工具链和系统工具层分别版本化，复用开发工具安装层。
FROM node:24.22.2-bookworm-slim AS node-toolchain
FROM node:24.13.1-bookworm-slim
ARG PYTHON_VERSION=3.12.12
ARG UV_VERSION=0.11.6
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq ripgrep zip unzip openssh-client \
    python3 python3-pip build-essential bzip2 xz-utils procps \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages --no-cache-dir "uv==${UV_VERSION}" \
    && UV_PYTHON_INSTALL_DIR=/opt/python uv python install "${PYTHON_VERSION}" \
    && UV_PYTHON_INSTALL_DIR=/opt/python uv python find "${PYTHON_VERSION}" > /tmp/maishu-python-path \
    && xargs -a /tmp/maishu-python-path -I PYTHON_PATH ln -sf PYTHON_PATH /usr/local/bin/python3 \
    && rm /tmp/maishu-python-path
COPY --from=node-toolchain /usr/local/bin/ /usr/local/bin/
# COPY merges directories; npm's removed dependency files must not survive an upgrade.
RUN rm -rf /usr/local/lib/node_modules
COPY --from=node-toolchain /usr/local/lib/node_modules/ /usr/local/lib/node_modules/
ENV NODE_VERSION=24.22.2
COPY deploy/maishu/runtime/package*.json /opt/maishu-tools/
RUN cd /opt/maishu-tools && npm ci --omit=dev \
    && npm cache clean --force
ENV PATH="/opt/maishu-tools/node_modules/.bin:${PATH}"
COPY deploy/maishu/runtime/dsh-runtime.json /usr/local/share/maishu/dsh-runtime.json
COPY deploy/maishu/runtime/preinstall-dsh.py /usr/local/lib/maishu/preinstall-dsh.py
COPY deploy/maishu/runtime/verify-dsh.py /usr/local/lib/maishu/verify-dsh.py
RUN python3 /usr/local/lib/maishu/preinstall-dsh.py \
    && python3 /usr/local/lib/maishu/verify-dsh.py
ENV DSH_PATH="/opt/maishu-dsh" DSH_ACP_HOST="/opt/maishu-dsh"
COPY deploy/maishu/runtime/maishu-harness.py /usr/local/bin/maishu-harness
COPY deploy/maishu/runtime/maishu-managed-init.py /usr/local/bin/maishu-managed-init
COPY packages/sandbox-adapter-e2b/template/launcher.py /usr/local/lib/maishu/managed-launcher.py
RUN chmod 755 /usr/local/bin/maishu-harness /usr/local/bin/maishu-managed-init \
    && chmod 644 /usr/local/lib/maishu/managed-launcher.py
COPY LICENSE NOTICE /usr/local/share/maishu/
WORKDIR /workspace
# OpenSandbox supplies execd and manages lifecycle. Its trusted entrypoint
# prestarts the shared management launcher before any task; account data, Docker
# sockets, host profiles and cross-customer writable caches are never baked in.
CMD ["/usr/local/bin/maishu-managed-init"]
