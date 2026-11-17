#!/usr/bin/env python3
"""Offline/no-account DSH CLI and full ACP Session creation gate. No prompts."""
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time

ADAPTER = '/opt/maishu-tools/node_modules/.bin/dsh-acp'
RUNTIME = '/opt/maishu-dsh'
VERSION = json.loads(Path('/usr/local/share/maishu/dsh-runtime.json').read_text())['coreVersion']


def bootstrap_once():
    with tempfile.TemporaryDirectory(prefix='maishu-dsh-noauth-') as temporary:
        environment = {
            'PATH': '/opt/maishu-tools/node_modules/.bin:/usr/local/bin:/usr/bin:/bin',
            'DSH_PATH': RUNTIME, 'DSH_ACP_HOST': RUNTIME,
            'DSH_HOME': temporary + '/home', 'DSH_SESSION_ROOT': temporary + '/sessions',
            'LANG': 'C.UTF-8',
        }
        version = subprocess.run(['/usr/local/bin/dsh', '--version'], env=environment,
                                 capture_output=True, text=True, check=True, timeout=20).stdout.strip()
        if VERSION not in version:
            raise RuntimeError('Unexpected DSH CLI version')
        process = subprocess.Popen([ADAPTER], env=environment, cwd=temporary,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, bufsize=1)
        replies = queue.Queue()
        errors = []
        def stdout_reader():
            for line in process.stdout:
                try: replies.put(json.loads(line))
                except json.JSONDecodeError: replies.put({'invalid_stdout': True})
        def stderr_reader():
            for line in process.stderr:
                if sum(map(len, errors)) < 30000:
                    errors.append(line)
        threading.Thread(target=stdout_reader, daemon=True).start()
        threading.Thread(target=stderr_reader, daemon=True).start()
        def request(ident, method, params, allow_authentication_required=False):
            process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': ident, 'method': method, 'params': params}) + '\n')
            process.stdin.flush()
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                try: item = replies.get(timeout=min(1, max(0.01, deadline-time.monotonic())))
                except queue.Empty:
                    if process.poll() is not None:
                        raise RuntimeError('DSH bootstrap exited: ' + ''.join(errors)[-2000:])
                    continue
                if item.get('invalid_stdout'):
                    raise RuntimeError('DSH emitted non-protocol stdout')
                if item.get('id') == ident:
                    if 'error' in item:
                        if allow_authentication_required and item['error'].get('code') == -32000 and 'Authentication required' in item['error'].get('message', ''):
                            return {'authenticationRequired': True, 'authMethods': item['error'].get('data', {}).get('authMethods', [])}
                        raise RuntimeError('DSH ' + method + ' rejected without an account: ' + json.dumps(item['error'])[:1200])
                    return item['result']
                if 'id' in item and 'method' in item:
                    process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': item['id'], 'error': {'code': -32601, 'message': 'No external tools in this build gate'}}) + '\n')
                    process.stdin.flush()
            raise RuntimeError('DSH bootstrap timed out: ' + ''.join(errors)[-2000:])
        try:
            initialized = request(1, 'initialize', {'protocolVersion': 1, 'clientCapabilities': {}, 'clientInfo': {'name': 'maishu-noauth-gate', 'version': '1'}})
            unauthenticated = request(2, 'session/new', {'cwd': temporary, 'mcpServers': []}, allow_authentication_required=True)
            if not unauthenticated.get('authenticationRequired'):
                raise RuntimeError('DSH did not enforce its no-credential authentication gate')
            # A clearly synthetic key stays inside this temporary, offline
            # home. Authenticate only to exercise Session construction; never
            # send session/prompt or infer that any real account/model works.
            request(3, 'authenticate', {'methodId': 'api-key:deepseek-official', '_meta': {'api-key': {'apiKey': 'maishu-offline-synthetic-not-a-real-key'}}})
            created = request(4, 'session/new', {'cwd': temporary, 'mcpServers': []})
            if not isinstance(created.get('sessionId'), str) or not created['sessionId']:
                raise RuntimeError('DSH session/new did not create a Session')
            diagnostics = ''.join(errors)
            if 'materializing' in diagnostics or 'extracting bundle archive' in diagnostics:
                raise RuntimeError('DSH tried per-session runtime materialization')
            explicit = RUNTIME in diagnostics or RUNTIME in json.dumps(initialized)
            if not explicit:
                raise RuntimeError('DSH did not report the explicit preinstalled runtime')
            return {'cliVersion': version, 'noCredentialRejected': True, 'syntheticCredentialUsed': True,
                    'sessionNew': True, 'runtimeExplicit': explicit,
                    'agentInfo': initialized.get('agentInfo'), 'noModelPrompt': True}
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)


if __name__ == '__main__':
    first, second = bootstrap_once(), bootstrap_once()
    print(json.dumps({'ok': True, 'freshHomes': 2, 'first': first, 'second': second, 'accountDataUsed': False}, ensure_ascii=False))
