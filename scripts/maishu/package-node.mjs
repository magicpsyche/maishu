#!/usr/bin/env node
// 麦枢修改：从当前锁安装的依赖闭包生成独立 Node 发布包，不读取其他实例。
import { cp, mkdir, readFile, readdir, realpath, lstat, readlink, symlink, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const git = (...values) => execFileSync('git', values, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const inside = (base, file) => { const path = relative(base, file); return path === '' || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path)); };
const exists = async file => { try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const sensitive = file => file.split(/[\\/]/).some(part => /^(?:\.git|\.test-artifacts|work|outputs|\.codex|\.claude|\.oma|\.maishu|\.cache|\.env(?:\..*)?|[^/]+\.env|\.dev\.vars(?:\..*)?|\.cf-creds|auth\.json|credentials\.json|credentials\.ya?ml|\.npmrc|\.credentials\.json|\.credentials\.ya?ml|private\.json)$/.test(part));
const skipSource = file => sensitive(file) || file.split('/').includes('node_modules') || /^(?:data|artifacts)\//.test(file);

if (args.includes('--help') || !flag('--output-dir')) {
  console.log('用法：node scripts/maishu/package-node.mjs --output-dir <新目录> --runtime-image <镜像版本> --worker-version <Worker版本> [--tar <发布包.tgz>] [--smoke-test]');
  console.log('前置：Node.js 24、干净且已提交的 checkout、pnpm install --frozen-lockfile；预先构建 console dist、CLI downloads 和 sandbox-egress dist。');
  process.exit(args.includes('--help') ? 0 : 1);
}
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('生产打包和验证必须使用 Node.js 24。');
if (git('status', '--porcelain=v1', '--untracked-files=normal')) throw new Error('工作区未提交或包含未追踪文件；请在干净 checkout 构建发布包。');
if (!flag('--runtime-image') || !flag('--worker-version')) throw new Error('必须分别指定 --runtime-image 和 --worker-version；控制端包不替你构建或部署执行端。');
const output = resolve(flag('--output-dir'));
if (inside(output, root) || output === root || inside(join(root, 'node_modules'), output)) throw new Error('输出目录不得覆盖源码或依赖目录。');
if (await exists(output)) throw new Error('输出目录已存在，请使用新的空路径，打包脚本不会删除旧发布。');
const archive = flag('--tar') ? resolve(flag('--tar')) : null;
if (archive && inside(output, archive)) throw new Error('压缩包不能放在待压缩的输出目录里。');

// Resolve filesystem entries rather than package.json exports, which many SDKs hide.
async function dependency(owner, name, required = true) {
  let directory = owner;
  while (inside(root, directory)) {
    const entry = join(directory, 'node_modules', name);
    if (await exists(entry)) {
      const target = await realpath(entry);
      if (!inside(root, target)) throw new Error(`依赖越出当前 checkout：${name}`);
      return { entry, target };
    }
    if (directory === root) break;
    directory = dirname(directory);
  }
  if (required) throw new Error(`缺少生产依赖 ${name}（${relative(root, owner)}）；请按当前锁文件安装，不能复用旧实例。`);
  return null;
}
const queue = [join(root, 'apps/main-node')];
const links = new Map();
const optionalMissing = [];
const seen = new Map();
const virtualRoots = new Set();
async function enqueue(owner, name, required = true) {
  const found = await dependency(owner, name, required);
  if (!found) { optionalMissing.push({ owner: relative(root, owner), dependency: name }); return; }
  links.set(found.entry, found.target);
  queue.push(found.target);
}
await enqueue(join(root, 'apps/main-node'), 'tsx');
await enqueue(join(root, 'packages/sandbox-adapter-opensandbox'), '@alibaba-group/opensandbox');
// These choices stay usable in the resulting image; no database-specific pruning.
for (const [owner, names] of [
  ['packages/node-database-sqlite', ['better-sqlite3', 'drizzle-orm']],
  ['packages/node-database-postgres', ['pg', 'postgres', 'drizzle-orm']],
  ['packages/node-database-mysql', ['mysql2', 'drizzle-orm']],
]) for (const name of names) await enqueue(join(root, owner), name);
while (queue.length) {
  const owner = queue.shift();
  if (seen.has(owner)) continue;
  const manifest = await json(join(owner, 'package.json'));
  seen.set(owner, { name: manifest.name, version: manifest.version, path: relative(root, owner) });
  const parts = relative(root, owner).split(sep);
  if (parts[0] === 'node_modules' && parts[1] === '.pnpm') virtualRoots.add(join(root, ...parts.slice(0, 3)));
  const optional = manifest.optionalDependencies ?? {};
  const dependencies = { ...manifest.dependencies, ...optional };
  for (const name of Object.keys(dependencies).sort()) await enqueue(owner, name, !Object.hasOwn(optional, name));
  for (const name of Object.keys(manifest.peerDependencies ?? {}).sort()) {
    if (Object.hasOwn(dependencies, name)) continue;
    await enqueue(owner, name, !manifest.peerDependenciesMeta?.[name]?.optional);
  }
}
const artifacts = ['apps/console/dist', 'packages/sandbox-egress/dist'];
for (const required of ['apps/console/dist/index.html', 'apps/console/dist/downloads/maishu.mjs', 'apps/console/dist/downloads/install.sh', 'apps/console/dist/downloads/SHA256SUMS', 'packages/sandbox-egress/dist/relay.cjs']) {
  if (!await exists(join(root, required))) throw new Error(`缺少构建产物：${required}`);
}
const files = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).filter(file => !skipSource(file));
await mkdir(output, { recursive: true });
for (const file of files) {
  const destination = join(output, file);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(root, file), destination, { dereference: false, verbatimSymlinks: true });
}
for (const directory of artifacts) await cp(join(root, directory), join(output, directory), { recursive: true, dereference: false, verbatimSymlinks: true,
  filter: file => { if (sensitive(relative(root, file))) throw new Error(`构建产物中包含不允许的私有路径：${relative(root, file)}`); return true; } });
// Copy only selected virtual-store roots, not the checkout's complete 1+GB store.
for (const directory of [...virtualRoots].sort()) await cp(directory, join(output, relative(root, directory)), { recursive: true, dereference: false, verbatimSymlinks: true });
for (const [entry, target] of links) {
  const destination = join(output, relative(root, entry));
  // A selected virtual-store root already contains its own dependency links.
  if (await exists(destination)) continue;
  if (!await exists(join(output, relative(root, target), 'package.json'))) throw new Error(`依赖目标未被包含：${relative(root, target)}`);
  await mkdir(dirname(destination), { recursive: true });
  await symlink(relative(dirname(destination), join(output, relative(root, target))), destination, 'dir');
}
// Raw required imports and pnpm peers sometimes resolve through the root importer.
await mkdir(join(output, 'node_modules'), { recursive: true });
const tsx = await dependency(join(root, 'apps/main-node'), 'tsx');
const rootTsx = join(output, 'node_modules/tsx');
if (!await exists(rootTsx)) await symlink(relative(dirname(rootTsx), join(output, relative(root, tsx.target))), rootTsx, 'dir');

async function verifyLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(file), await readlink(file));
      if (!inside(output, target) || !await exists(file)) throw new Error(`发布包含越界或悬空链接：${relative(output, file)}`);
    } else if (entry.isDirectory()) await verifyLinks(file);
  }
}
await verifyLinks(output);
const metadata = await json(join(root, 'deploy/maishu/upstream.json'));
const manifest = {
  product: '麦枢', controlPlaneVersion: (await json(join(root, 'package.json'))).version, sourceCommit: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'),
  upstreamBaseline: metadata.baseline, lockfileSha256: sha256(await readFile(join(root, 'pnpm-lock.yaml'))),
  nodeMajor: 24, buildNode: process.versions.node, platform: process.platform, arch: process.arch, nodeAbi: process.versions.modules,
  runtimeImage: { version: flag('--runtime-image'), dockerfileSha256: sha256(await readFile(join(root, 'deploy/maishu/runtime/Dockerfile'))), lockfileSha256: sha256(await readFile(join(root, 'deploy/maishu/runtime/package-lock.json'))), builtByThisPackage: false },
  worker: { version: flag('--worker-version'), buildScriptSha256: sha256(await readFile(join(root, 'deploy/maishu/runtime/build-worker.mjs'))), builtByThisPackage: false },
  artifacts: Object.fromEntries(await Promise.all(['apps/console/dist/index.html', 'apps/console/dist/downloads/maishu.mjs', 'packages/sandbox-egress/dist/relay.cjs'].map(async file => [file, sha256(await readFile(join(output, file)))]))),
  dependencies: [...seen.values()].sort((a, b) => a.path.localeCompare(b.path)), optionalMissing,
  smokeTest: 'not_requested',
};
await writeFile(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

if (args.includes('--smoke-test')) {
  const scratch = await mkdtemp(join(tmpdir(), 'maishu-package-check-'));
  const cleanEnv = { PATH: process.env.PATH, NODE_ENV: 'production', MAISHU_PRODUCT: '1', HOST: '127.0.0.1',
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), PLATFORM_ROOT_SECRET: randomBytes(32).toString('base64'),
    AUTH_DISABLED: '0', SANDBOX_PROVIDER: 'opensandbox', OPENSANDBOX_DOMAIN: '127.0.0.1:1', OPENSANDBOX_RUNTIME: 'docker',
    MEMORY_QUEUE: 'disabled', DREAM_CURATOR_MODE: 'dedup', LOG_LEVEL: 'silent',
    DATABASE_PATH: join(scratch, 'maishu.db'), AUTH_DATABASE_PATH: join(scratch, 'auth.db'),
    MEMORY_BLOB_DIR: join(scratch, 'memory'), FILES_BLOB_DIR: join(scratch, 'files'), SANDBOX_WORKDIR: join(scratch, 'sandboxes'), SESSION_OUTPUTS_DIR: join(scratch, 'outputs'),
  };
  const reserve = net.createServer();
  await new Promise((done, fail) => reserve.once('error', fail).listen(0, '127.0.0.1', done));
  const port = reserve.address().port;
  await new Promise(done => reserve.close(done));
  cleanEnv.PORT = String(port); cleanEnv.PUBLIC_BASE_URL = `http://127.0.0.1:${port}`;
  let logs = '', child;
  try {
    // Resolve from the packaged adapter, not from this build script's own modules.
    execFileSync(process.execPath, ['--input-type=module', '-e', `import {createRequire} from 'node:module'; const r=createRequire(new URL('./packages/sandbox-adapter-opensandbox/package.json', import.meta.url)); await import(r.resolve('@alibaba-group/opensandbox')); console.log('OpenSandbox SDK import OK');`], { cwd: output, env: cleanEnv, stdio: 'pipe' });
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/main-node/src/index.ts'], { cwd: output, env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { logs = (logs + data).slice(-12000); }); child.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
    let health;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`隔离服务提前退出：${logs}`);
      try { const response = await fetch(`${cleanEnv.PUBLIC_BASE_URL}/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { health = await response.json(); break; } } catch { /* Wait for local startup only. */ }
      await delay(200);
    }
    if (!health || health.status !== 'ok') throw new Error(`隔离健康检查未通过：${logs}`);
    manifest.smokeTest = { health: 'ok', opensandboxSdk: 'imported', database: health.backends?.db?.split(' ')[0], externalTasksStarted: false };
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(done => child.once('exit', done)), delay(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await rm(scratch, { recursive: true, force: true });
  }
  await writeFile(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
if (archive) {
  await mkdir(dirname(archive), { recursive: true });
  if (await exists(archive)) throw new Error('目标压缩包已存在，不覆盖旧发布。');
  execFileSync('tar', ['--sort=name', `--mtime=@${git('show', '-s', '--format=%ct', 'HEAD')}`, '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', output, '.'], { stdio: 'inherit' });
  await writeFile(archive + '.sha256', `${sha256(await readFile(archive))}  ${archive.split(sep).at(-1)}\n`);
}
console.log(JSON.stringify({ output, archive, sourceCommit: manifest.sourceCommit, packages: seen.size, virtualStoreRoots: virtualRoots.size, optionalMissing: optionalMissing.length, smokeTest: manifest.smokeTest }, null, 2));
