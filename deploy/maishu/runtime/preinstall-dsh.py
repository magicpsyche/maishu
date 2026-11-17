#!/usr/bin/env python3
"""Materialize the already-locked official DSH tree once, at image build.

Use the adapter's supported bundled materializer (including external packages),
then pin explicit runtime selection. No account data or model request is used.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

TOOLS = Path('/opt/maishu-tools')
PIN = Path('/usr/local/share/maishu/dsh-runtime.json')


def preinstall(tools=TOOLS, pin_file=PIN):
    pin = json.loads(pin_file.read_text())
    adapter = tools / 'node_modules' / pin['adapterPackage']
    manifest = json.loads((adapter / 'package.json').read_text())
    metadata = json.loads((adapter / 'vendor/runtime.json').read_text())
    if manifest['version'] != pin['adapterVersion'] or metadata['dsh'] != pin['coreVersion'] or metadata['sha256'] != pin['archiveSha256']:
        raise ValueError('DeepSeek Harness runtime pin mismatch')
    archive = adapter / 'vendor' / metadata['archive']
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != pin['archiveSha256']:
        raise ValueError('DeepSeek Harness archive checksum mismatch')
    target = Path(pin['cacheRoot']) / (pin['coreVersion'] + '-' + pin['archiveSha256'][:12])
    with tempfile.TemporaryDirectory(prefix='maishu-dsh-build-') as temporary:
        environment = {
            'PATH': '/opt/maishu-tools/node_modules/.bin:/usr/local/bin:/usr/bin:/bin',
            'DSH_HOME': temporary,
            'DSH_ACP_CACHE_DIR': pin['cacheRoot'],
            'LANG': 'C.UTF-8',
        }
        # This resolves the locked archive before opening ACP stdio. EOF then
        # closes the server; neither initialize nor prompt is a model request.
        process = subprocess.Popen(['/usr/local/bin/node', str(adapter / 'dist/bin.js'), '--dsh-path', 'bundled'],
                                   env=environment, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        # Some adapter versions keep background services alive after stdin EOF.
        # The materializer's atomic marker is the build barrier; do not wait
        # three minutes for an interactive server to quit by itself.
        deadline = time.monotonic() + 180
        while not (target / '.dsh-acp-runtime').is_file() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        if process.poll() is None:
            process.terminate()
        try:
            _, errors = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            _, errors = process.communicate(timeout=5)
        if not (target / '.dsh-acp-runtime').is_file():
            raise RuntimeError('DeepSeek Harness materialization failed: ' + errors[-1500:])
    core = target / 'node_modules' / pin['corePackage']
    core_lock = json.loads((target / 'package-lock.json').read_text())['packages']['node_modules/' + pin['corePackage']]
    if core_lock.get('resolved') != pin['coreNpmTarball'] or core_lock.get('integrity') != pin['coreNpmIntegrity']:
        raise ValueError('Official DeepSeek Harness npm provenance mismatch')
    if json.loads((core / 'package.json').read_text())['version'] != pin['coreVersion']:
        raise ValueError('Preinstalled DeepSeek Harness version mismatch')
    entry = core / 'lib/bin.js'
    if not entry.is_file():
        raise ValueError('Preinstalled DeepSeek Harness CLI is missing')
    entry.chmod(entry.stat().st_mode | 0o111)
    root = Path(pin['runtimeRoot'])
    if root.exists() or root.is_symlink():
        if not root.is_symlink() or root.resolve() != target.resolve():
            raise ValueError('Refusing to replace an unrelated DSH runtime directory')
    else:
        root.symlink_to(target, target_is_directory=True)
    executable = Path('/usr/local/bin/dsh')
    if executable.exists() or executable.is_symlink():
        if not executable.is_symlink() or executable.resolve() != entry.resolve():
            raise ValueError('Refusing to replace an unrelated dsh command')
    else:
        executable.symlink_to(entry)
    result = subprocess.run([str(executable), '--version'],
                            env={'PATH': '/usr/local/bin:/usr/bin:/bin'},
                            capture_output=True, text=True, timeout=20, check=True)
    if pin['coreVersion'] not in result.stdout:
        raise ValueError('DeepSeek Harness CLI reported an unexpected version')
    print('Preinstalled @deepseek-ai/dsh ' + pin['coreVersion'] + '; archive SHA256 verified; no credentials/model request.')


if __name__ == '__main__':
    preinstall()
