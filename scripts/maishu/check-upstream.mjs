// 麦枢修改：只生成升级差异，不合并分支、不重启生产、不修改数据库。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('deploy/maishu/upstream.json', root), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (process.argv.includes('--fetch')) git('fetch', 'upstream', 'main');
const head = git('rev-parse', 'upstream/main');
console.log(`麦枢上游基线：${config.baseline}\n当前上游版本：${head}`);
console.log(git('diff', '--stat', config.baseline, head) || '上游没有新增差异。');
console.log('\n本产品改动：\n' + git('diff', '--stat', config.baseline, 'HEAD'));
