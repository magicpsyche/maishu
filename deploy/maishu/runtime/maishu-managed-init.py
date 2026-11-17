#!/usr/bin/env python3
"""Trusted container entrypoint; start the shared management launcher first."""
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

ROOT = Path('/run/oma-managed')
LAUNCHER = Path('/usr/local/lib/maishu/managed-launcher.py')


def main():
    if os.getuid() != 0 or not hasattr(os, 'waitid'):
        raise RuntimeError('管理入口需要 Linux root 与 waitid')
    if LAUNCHER.is_symlink() or LAUNCHER.resolve() != LAUNCHER:
        raise RuntimeError('管理程序路径不能为符号链接')
    info = LAUNCHER.stat()
    if info.st_uid != 0 or info.st_mode & 0o022 or not stat.S_ISREG(info.st_mode):
        raise RuntimeError('管理程序必须由 root 拥有且不可由其他用户写入')
    if ROOT.is_symlink() or ROOT.resolve() != ROOT:
        raise RuntimeError('管理目录不能为符号链接')
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(ROOT, 0o700)
    os.umask(0o077)
    (ROOT / 'ready').unlink(missing_ok=True)
    launcher = subprocess.Popen([sys.executable, str(LAUNCHER), str(ROOT)], stdin=subprocess.DEVNULL, start_new_session=True)
    stopping = False

    def stop(_signal, _frame):
        nonlocal stopping
        stopping = True
        if launcher.poll() is None:
            launcher.send_signal(signal.SIGTERM)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        deadline = time.monotonic() + 15
        while not stopping and time.monotonic() < deadline:
            if launcher.poll() is not None:
                raise RuntimeError('管理程序启动失败')
            ready = ROOT / 'ready'
            if ready.exists() and ready.read_text() == 'oma-managed-v2':
                break
            time.sleep(0.05)
        else:
            if not stopping:
                raise RuntimeError('管理程序就绪超时')
        while not stopping and launcher.poll() is None:
            time.sleep(0.2)
        return launcher.returncode or 0
    finally:
        if launcher.poll() is None:
            launcher.send_signal(signal.SIGTERM)
        try:
            launcher.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(launcher.pid, signal.SIGKILL)
            launcher.wait()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('麦枢管理程序启动失败。', file=sys.stderr)
        sys.exit(78)
