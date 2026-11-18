#!/usr/bin/env node
// 前端独立发布：复用服务端品牌处理，不启动 API、Worker 或认证维护。
import { cp, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConsoleBranding, brandIndexHtml } from '../../packages/control-plane-node/src/lib/console-branding.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.argv[2];
if (!target || process.argv.includes('--help')) {
  console.log('用法：Node.js 24 运行 node scripts/maishu/package-console.mjs <新输出目录>；先构建 console 与 CLI downloads。');
  process.exit(target ? 0 : 1);
}
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('请使用 Node.js 24。');
const output = resolve(target);
const distance = relative(root, output);
if (!distance || distance === '..' || distance.startsWith('..' + sep) === false) throw new Error('输出目录必须位于源码目录之外。');
try { await stat(output); throw new Error('输出目录已存在，不覆盖旧版本。'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const scope = ['apps/console', 'deploy/maishu/branding', 'scripts/maishu/package-console.mjs', 'deploy/maishu/nginx-console-static.conf.example'];
if (git('status', '--porcelain', '--', ...scope)) throw new Error('请先提交前端和品牌修改。');
const dist = join(root, 'apps/console/dist');
const brand = join(root, 'deploy/maishu/branding');
await stat(join(dist, 'downloads/maishu.mjs'));
await stat(join(dist, 'downloads/SHA256SUMS'));
await mkdir(output, { recursive: true });
await cp(dist, output, { recursive: true });
await cp(brand, join(output, 'branding'), { recursive: true });
await cp(join(root, 'deploy/maishu/nginx-console-static.conf.example'), join(output, 'nginx-console-static.conf'));
const branding = loadConsoleBranding(brand);
await writeFile(join(output, 'branding/branding.json'), JSON.stringify(branding, null, 2) + '\n');
await writeFile(join(output, 'index.html'), brandIndexHtml(await readFile(join(dist, 'index.html'), 'utf8'), branding));
const files = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) files[relative(output, file)] = createHash('sha256').update(await readFile(file)).digest('hex');
    else throw new Error('静态发布不接受特殊文件或符号链接。');
  }
}
await walk(output);
await writeFile(join(output, 'console-release.json'), JSON.stringify({ product: '麦枢', sourceCommit: git('rev-parse', 'HEAD'), node: process.version, files }, null, 2) + '\n');
console.log(JSON.stringify({ output, files: Object.keys(files).length, sourceCommit: git('rev-parse', 'HEAD') }));
