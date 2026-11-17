import { build } from 'esbuild';
import { readFile, mkdir, writeFile, copyFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const flag = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const output = resolve(flag('--output-dir') ?? resolve(root, 'apps/console/dist/downloads'));
const origin = flag('--base-url') ?? process.env.MAISHU_PUBLIC_URL ?? 'http://127.0.0.1:8797';
const url = new URL(origin);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('平台地址必须为无路径和凭证的 HTTP(S) 地址');
await mkdir(output, { recursive: true });
const bundle = resolve(root, 'packages/cli/dist/maishu.js');
const { version } = JSON.parse(await readFile(resolve(root, 'packages/cli/package.json'), 'utf8'));
const attribution = (await Promise.all(['LICENSE', 'NOTICE'].map(name => readFile(resolve(root, name), 'utf8')))).join('\n\n');
await build({ entryPoints: [resolve(root, 'packages/cli/src/maishu.ts')], outfile: bundle, bundle: true,
  platform: 'node', format: 'esm', target: 'node22', define: { MAISHU_BUILD_VERSION: JSON.stringify(version) }, external: ['@boxlite-ai/boxlite'],
  banner: { js: "#!/usr/bin/env node\n/* 麦枢修改与分发；上游适用许可和归属如下。\n" + attribution.replaceAll('*/', '* /') + "\n*/\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
await chmod(bundle, 0o755);
await copyFile(bundle, resolve(output, 'maishu.mjs'));
const install = (await readFile(resolve(root, 'deploy/maishu/cli/install.sh'), 'utf8')).replace('__MAISHU_DEFAULT_SERVER__', url.origin);
await writeFile(resolve(output, 'install.sh'), install, { mode: 0o755 });
const bytes = await readFile(bundle);
await writeFile(resolve(output, 'SHA256SUMS'), `${createHash('sha256').update(bytes).digest('hex')}  maishu.mjs\n`);
console.log(`麦枢命令行已构建：${output}`);
