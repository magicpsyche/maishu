#!/usr/bin/env python3
"""Start an ACP harness with a session-private native credential copy.

The orchestrator mounts ONLY the authorized account directory. This program
never downloads credentials, writes back refreshed tokens or starts a shell.
"""
import json
import os
from pathlib import Path
import re
import stat
import sys


CREDENTIAL_ROOT = Path('/run/maishu-credentials')
STATE_ROOT = Path('/tmp/openma-harness-state')
TRUSTED_PATH = '/opt/maishu-tools/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
HARNESSES = {
    'codex': ('CODEX_HOME', '/opt/maishu-tools/node_modules/.bin/codex-acp', ('auth.json', 'config.toml')),
    'claude': ('CLAUDE_CONFIG_DIR', '/opt/maishu-tools/node_modules/.bin/claude-agent-acp', ('.credentials.json', 'settings.json')),
    'dsh': ('DSH_HOME', '/opt/maishu-tools/node_modules/.bin/dsh-acp', ('.credentials.yaml',)),
}


def private_write(target, content):
    """Refuse links and write a private file without printing its contents."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW
    fd = os.open(target, flags, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(content)


def validate_directory(path, root):
    if root.is_symlink() or root.resolve() != root.absolute():
        raise ValueError('会话临时状态根目录不得为符号链接')
    if not path.is_absolute() or path == root or not path.is_relative_to(root):
        raise ValueError('运行目录必须位于会话临时状态目录内')
    # A lexical containment check alone would accept a symlink into /workspace.
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('运行目录不得通过符号链接指向会话状态目录外')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


def credential_bytes(source):
    flags = os.O_RDONLY | os.O_NOFOLLOW
    with os.fdopen(os.open(source, flags), 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024:
            raise ValueError('凭证必须为不超过 1 MiB 的普通文件')
        return stream.read(1024 * 1024 + 1)


def prepare(harness, env, *, credential_root=CREDENTIAL_ROOT, state_root=STATE_ROOT):
    if harness not in HARNESSES:
        raise ValueError('不支持的执行引擎')
    mode = env.get('MAISHU_AUTH_MODE', 'managed')
    if mode not in ('native', 'managed'):
        raise ValueError('认证模式必须为 native 或 managed')
    native_var, command, files = HARNESSES[harness]
    native = Path(env.get(native_var, ''))
    validate_directory(native, state_root)
    result = dict(env)
    # Management exec replaces, rather than inherits, the image environment.
    # Supply a trusted runtime path even when the parent passed no PATH.
    result['PATH'] = TRUSTED_PATH
    if harness == 'dsh':
        # Use the checksum-pinned, build-time installation even after the
        # management plane replaces the image environment for a new Session.
        result['DSH_PATH'] = '/opt/maishu-dsh'
        result['DSH_ACP_HOST'] = '/opt/maishu-dsh'
    if mode == 'managed':
        # Keep the original platform model gateway config and scoped token.
        return command, result

    ref = env.get('MAISHU_CREDENTIAL_REF', '')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', ref):
        raise ValueError('原生认证需要有效的账户引用')
    account = credential_root / ref
    if account.is_symlink() or not account.resolve().is_relative_to(credential_root.resolve()):
        raise ValueError('凭证目录不得跳转到挂载根目录外')
    required = files[0]
    # Only fixed filenames are copied; credentials never enter /workspace.
    for filename in files:
        source = account / filename
        if not source.exists() and filename != required:
            continue
        content = credential_bytes(source)
        if filename.endswith('.json'):
            value = json.loads(content)
            if not isinstance(value, dict):
                raise ValueError('认证配置必须为 JSON 对象')
        target = native / filename
        # Native refresh belongs to this private session. Do not replace a
        # refreshed credential with the stale mounted source on process restart.
        if filename == required and target.exists():
            if target.is_symlink():
                raise ValueError('会话凭证不得为符号链接')
            continue
        private_write(target, content)

    if harness == 'codex':
        for key in ('OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_AUTH_TOKEN'):
            result.pop(key, None)
        if not (account / 'config.toml').exists():
            private_write(native / 'config.toml', b'model_provider = "openai"\ncli_auth_credentials_store = "file"\n')
    elif harness == 'claude':
        for key in list(result):
            if key in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_SUBAGENT_MODEL') or key.startswith('ANTHROPIC_DEFAULT_') or key == 'ANTHROPIC_MODEL':
                result.pop(key, None)
        if not (account / 'settings.json').exists():
            private_write(native / 'settings.json', b'{}\n')
    else:
        for key in ('DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DSH_PROVIDER', 'DSH_MODEL'):
            result.pop(key, None)
    # Work tokens are already scrubbed by the upstream ACP launch layer.
    # Our own account reference need not be inherited by tools or descendants.
    result.pop('MAISHU_CREDENTIAL_REF', None)
    return command, result


def main():
    try:
        if len(sys.argv) < 2:
            raise ValueError('缺少执行引擎参数')
        if sys.argv[1] == 'dsh' and any(value == '--dsh-path' or value.startswith('--dsh-path=') for value in sys.argv[2:]):
            raise ValueError('DeepSeek Harness 使用镜像内固定版本，不接受运行时安装路径覆盖')
        command, env = prepare(sys.argv[1], os.environ)
        os.execvpe(command, [command, *sys.argv[2:]], env)
    except Exception:
        # Exception text may include secret-bearing JSON, paths or subprocess
        # values. Detailed diagnostics stay out of session events and stderr.
        print('执行引擎启动失败，请检查认证引用、运行目录和引擎安装。', file=sys.stderr)
        return 78


if __name__ == '__main__':
    sys.exit(main())
