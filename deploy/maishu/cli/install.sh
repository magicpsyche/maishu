#!/bin/sh
# 麦枢自托管命令行安装器：不修改 shell profile，不写入账户凭证。
set -eu
MAISHU_SERVER=${MAISHU_BASE_URL:-__MAISHU_DEFAULT_SERVER__}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --server-url) MAISHU_SERVER=$2; shift 2 ;;
    --help|-h) printf '%s\n' '用法：sh install.sh [--server-url https://你的麦枢平台]' '需要 Node.js 22+、curl，以及 sha256sum 或 shasum。'; exit 0 ;;
    *) printf '%s\n' "不支持的参数：$1" >&2; exit 2 ;;
  esac
done
case "$MAISHU_SERVER" in http://*|https://*) ;; *) printf '%s\n' '请通过 --server-url 指定平台 HTTP(S) 地址。' >&2; exit 2 ;; esac
command -v node >/dev/null 2>&1 || { printf '%s\n' '请先安装 Node.js 22 或更高版本。' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22) process.exit(1)' || { printf '%s\n' '需要 Node.js 22 或更高版本。' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { printf '%s\n' '请先安装 curl。' >&2; exit 1; }
MAISHU_ROOT=${MAISHU_INSTALL_ROOT:-"$HOME/.local/share/maishu/cli"}
MAISHU_BIN=${MAISHU_BIN_DIR:-"$HOME/.local/bin"}
mkdir -p "$MAISHU_ROOT" "$MAISHU_BIN"
if { [ -e "$MAISHU_BIN/maishu" ] || [ -L "$MAISHU_BIN/maishu" ]; } && ! head -n 3 "$MAISHU_BIN/maishu" 2>/dev/null | grep -q 'maishu-managed-cli'; then
  printf '%s\n' "已有其他安装来源的 $MAISHU_BIN/maishu，已保留。请另选 MAISHU_BIN_DIR。" >&2; exit 1
fi
MAISHU_TMP=$(mktemp -d "$MAISHU_ROOT/.install.XXXXXXXX")
trap 'rm -rf "$MAISHU_TMP"' EXIT HUP INT TERM
MAISHU_SERVER=${MAISHU_SERVER%/}
curl --fail --silent --show-error --location --proto '=http,https' "$MAISHU_SERVER/downloads/maishu.mjs" -o "$MAISHU_TMP/maishu.mjs"
curl --fail --silent --show-error --location --proto '=http,https' "$MAISHU_SERVER/downloads/SHA256SUMS" -o "$MAISHU_TMP/SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then MAISHU_DIGEST=$(sha256sum "$MAISHU_TMP/maishu.mjs" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null 2>&1; then MAISHU_DIGEST=$(shasum -a 256 "$MAISHU_TMP/maishu.mjs" | cut -d ' ' -f 1)
else printf '%s\n' '请安装 sha256sum 或 shasum。' >&2; exit 1; fi
MAISHU_EXPECTED=$(awk '$2 == "maishu.mjs" {print $1}' "$MAISHU_TMP/SHA256SUMS")
[ "$MAISHU_DIGEST" = "$MAISHU_EXPECTED" ] || { printf '%s\n' '下载校验失败，已保留原安装。' >&2; exit 1; }
chmod 700 "$MAISHU_TMP/maishu.mjs"
mv "$MAISHU_TMP/maishu.mjs" "$MAISHU_ROOT/maishu.mjs"
# Quote paths and origin for POSIX shell without evaluating their contents.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
{
  printf '%s\n' '#!/bin/sh' '# maishu-managed-cli'
  printf 'export MAISHU_BASE_URL=${MAISHU_BASE_URL:-'; quote "$MAISHU_SERVER"; printf '}\n'
  printf 'exec node '; quote "$MAISHU_ROOT/maishu.mjs"; printf ' "$@"\n'
} > "$MAISHU_TMP/maishu"
chmod 700 "$MAISHU_TMP/maishu"
mv "$MAISHU_TMP/maishu" "$MAISHU_BIN/maishu"
printf '%s\n' "安装完成：$MAISHU_BIN/maishu" "平台地址：$MAISHU_SERVER" "首次登录：$MAISHU_BIN/maishu auth login"
case ":$PATH:" in *":$MAISHU_BIN:"*) ;; *) printf '%s\n' '该目录尚未加入 PATH；可直接使用以上完整路径。安装器未修改你的 shell 配置。' ;; esac
