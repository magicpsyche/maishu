import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(root, 'work/maishu-worker');
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root, entryPoints: ['packages/harness-runtime-acp/src/node-work-item-cli.ts'],
  outfile: resolve(output, 'runner.mjs'), bundle: true, platform: 'node', format: 'esm',
  target: 'node24', metafile: true,
});
const hashes = [];
for (const name of Object.keys(result.metafile.inputs).sort()) {
  hashes.push([name, createHash('sha256').update(await readFile(resolve(root, name))).digest('hex')]);
}
const bytes = await readFile(resolve(output, 'runner.mjs'));
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({
  sourceLabel: process.env.MAISHU_SOURCE_LABEL ?? 'source-tree',
  inputsSha256: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
  runnerSha256: createHash('sha256').update(bytes).digest('hex'),
  command: '/usr/local/bin/node', args: ['/opt/maishu-worker/runner.mjs'],
}, null, 2) + '\n');
console.log(`Built ${output}; no credentials or model requests were used.`);
