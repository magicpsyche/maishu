import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('maishu_harness', Path(__file__).with_name('maishu-harness.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.credentials = self.root / 'credentials'
        self.account = self.credentials / 'account-a'
        self.account.mkdir(parents=True)
        self.home = self.state / 'session-a' / 'native'

    def run_prepare(self, harness='codex', **values):
        key = runtime.HARNESSES[harness][0]
        env = {key: str(self.home), 'MAISHU_AUTH_MODE': 'native', 'MAISHU_CREDENTIAL_REF': 'account-a', **values}
        return runtime.prepare(harness, env, credential_root=self.credentials, state_root=self.state)

    def test_native_codex_replaces_gateway_and_keeps_refresh_private(self):
        (self.account / 'auth.json').write_text('{"token":"synthetic-test-only"}')
        self.home.mkdir(parents=True)
        (self.home / 'config.toml').write_text('model_provider="oma"')
        command, env = self.run_prepare(OPENAI_API_KEY='scoped-gateway')
        self.assertEqual(command, '/opt/maishu-tools/node_modules/.bin/codex-acp')
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('MAISHU_CREDENTIAL_REF', env)
        auth = self.home / 'auth.json'
        self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
        self.assertIn('model_provider = "openai"', (self.home / 'config.toml').read_text())
        auth.write_text('{"token":"synthetic-refreshed"}')
        self.run_prepare()
        self.assertEqual(json.loads(auth.read_text())['token'], 'synthetic-refreshed')
        self.assertEqual(json.loads((self.account / 'auth.json').read_text())['token'], 'synthetic-test-only')

    def test_managed_does_not_read_credentials_or_replace_gateway_config(self):
        self.home.mkdir(parents=True)
        config = self.home / 'config.toml'
        config.write_text('model_provider="oma"')
        _, env = self.run_prepare(MAISHU_AUTH_MODE='managed', OPENAI_API_KEY='scoped-gateway')
        self.assertEqual(env['OPENAI_API_KEY'], 'scoped-gateway')
        self.assertEqual(config.read_text(), 'model_provider="oma"')
        self.assertFalse((self.home / 'auth.json').exists())
        self.assertEqual(env['PATH'], runtime.TRUSTED_PATH)

    def test_rejects_paths_outside_native_state_and_traversal_references(self):
        with self.assertRaises(ValueError):
            self.run_prepare(CODEX_HOME=str(self.root / 'workspace'))
        with self.assertRaises(ValueError):
            self.run_prepare(MAISHU_CREDENTIAL_REF='../account-a')
        self.state.mkdir(exist_ok=True)
        outside = self.root / 'outside'
        outside.mkdir()
        (self.state / 'link').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.run_prepare(CODEX_HOME=str(self.state / 'link' / 'native'))

    def test_rejects_a_state_root_symlink_into_the_workspace(self):
        workspace = self.root / 'workspace'
        workspace.mkdir()
        self.state.symlink_to(workspace, target_is_directory=True)
        (self.account / 'auth.json').write_text('{}')
        with self.assertRaises(ValueError):
            self.run_prepare()
        self.assertFalse((workspace / 'session-a' / 'native' / 'auth.json').exists())

    def test_rejects_symlink_credentials_and_invalid_json(self):
        source = self.account / 'auth.json'
        outside = self.root / 'not-credential'
        outside.write_text('{}')
        source.symlink_to(outside)
        with self.assertRaises(OSError):
            self.run_prepare()
        source.unlink()
        source.write_text('SYNTHETIC_INVALID_SECRET')
        with self.assertRaises(ValueError):
            self.run_prepare()

    def test_claude_and_dsh_strip_conflicting_gateway_tokens(self):
        (self.account / '.credentials.json').write_text('{}')
        command, env = self.run_prepare('claude', ANTHROPIC_AUTH_TOKEN='scoped-gateway', ANTHROPIC_BASE_URL='http://gateway')
        self.assertEqual(command, '/opt/maishu-tools/node_modules/.bin/claude-agent-acp')
        self.assertNotIn('ANTHROPIC_AUTH_TOKEN', env)
        self.assertNotIn('ANTHROPIC_BASE_URL', env)
        (self.account / '.credentials.yaml').write_text('DEEPSEEK_API_KEY: synthetic-test-only\n')
        command, env = self.run_prepare('dsh', DEEPSEEK_API_KEY='scoped-gateway', DSH_PATH='bundled', DSH_ACP_HOST='/tmp/unpinned-runtime')
        self.assertEqual(env['DSH_PATH'], '/opt/maishu-dsh')
        self.assertEqual(env['DSH_ACP_HOST'], '/opt/maishu-dsh')
        self.assertEqual(command, '/opt/maishu-tools/node_modules/.bin/dsh-acp')
        self.assertNotIn('DEEPSEEK_API_KEY', env)
        self.assertEqual((self.home / '.credentials.yaml').stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
