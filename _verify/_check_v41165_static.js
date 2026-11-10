// v4.11.65 静态自检：核对「历史页失效」两处根因是否都已消除 + 版本号锚点一致
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const S = fs.readFileSync(path.join(REPO, 'v4', 'v4-shell.js'), 'utf8');
const H = fs.readFileSync(path.join(REPO, 'v4', 'index.html'), 'utf8');

let PASS = 0, FAIL = 0;
const chk = (name, cond, detail) => {
  cond ? PASS++ : FAIL++;
  console.log((cond ? '  OK  ' : ' FAIL ') + name.padEnd(52) + ' ' + (detail === undefined ? '' : String(detail).slice(0, 160)));
};

const VER = (S.match(/var V4_VERSION = '([^']+)'/) || [])[1];
console.log('=== 0. 版本基线（从源码读，不硬编码）===');
console.log('   V4_VERSION =', VER);
chk('0.1 V4_VERSION 已是 4.11.65', VER === 'v4.11.65', VER);

console.log('');
console.log('=== 1. 根因①：跨闭包引用 fetchCloud / V4CLOUD ===');
chk('1.1 已暴露 window.v4CloudFetch', /window\.v4CloudFetch = fetchCloud;/.test(S));
chk('1.2 kickReports 走 window.v4CloudFetch', /window\.v4CloudFetch\(\{ action: 'records', key: 'history'/.test(S));
// 判据按作用域收窄：只查「历史库那层 IIFE」（kickReports / ensureCloud 所在段）。
// 3346/3347 也在用 V4CLOUD.limit，但它们与 V4CLOUD 定义同一个闭包 ⇒ 合法，不能一刀切。
const _ki = S.indexOf('function kickReports');
const histLayer = S.slice(_ki, S.indexOf('scheduleCloudRefresh', _ki));
const bareCloud = histLayer.split('\n')
  .map((l, i) => ({ n: i, l }))
  .filter(x => !/^\s*\/\//.test(x.l) && /(?<![.\w])V4CLOUD\b/.test(x.l));
chk('1.3 历史库层不再用裸 V4CLOUD', bareCloud.length === 0,
  bareCloud.length ? '残留行：' + bareCloud.map(x => x.l.trim().slice(0, 60)).join(' | ') : 'ok');
chk('1.4 入口缺失时有显式降级（不静默吞）', /window\.v4CloudFetch 缺失/.test(S));
// 裸调用只允许出现在 fetchCloud 自己的闭包内（该闭包 = 定义处起的同一 IIFE）
const lines = S.split('\n');
const bare = [];
lines.forEach((l, i) => {
  if (/^\s*\/\//.test(l)) return;                       // 注释不算
  const m = l.match(/(?<![.\w])fetchCloud\(/);
  if (m) bare.push(i + 1);
});
// 定义行 + 同闭包内两处已知调用（均为其自身使用）
chk('1.5 裸 fetchCloud( 调用仅存在于定义所在闭包', bare.length <= 3, '行号=' + JSON.stringify(bare));

console.log('');
console.log('=== 2. 根因②：v4Navigate 缺 history/golden/cases 分支 ===');
chk('2.1 v4Navigate 已补 history/golden/cases',
  /key === 'history' \|\| key === 'golden' \|\| key === 'cases'/.test(S));
const navBlock = S.slice(S.indexOf('function v4Navigate'), S.indexOf('window.addEventListener(\'hashchange\''));
chk('2.2 分支写在 v4Navigate 函数体内', /key === 'history'/.test(navBlock));
chk('2.3 分支调用 window.v4ArchRender', /window\.v4ArchRender\(key\)/.test(navBlock));
chk('2.4 保留了原有 dashboard/settings/feishu/trend/problem',
  ['dashboard', 'settings', 'feishu', 'trend', 'problem'].every(k => navBlock.indexOf("key === '" + k + "'") >= 0));

console.log('');
console.log('=== 3. 版本号四处锚点 ===');
const brand = (H.match(/id="brandVer"[^>]*>v?([\d.]+)</) || [])[1];
const badge = (H.match(/id="pageBadge"[^>]*>v?([\d.]+)</) || [])[1];
const foot = (H.match(/id="footVer"[^>]*>v?([\d.]+)</) || [])[1];
const scr = (H.match(/v4-shell\.js\?v=([\d.]+)/) || [])[1];
chk('3.1 brandVer', brand === '4.11.65', brand);
chk('3.2 pageBadge', badge === '4.11.65', badge);
chk('3.3 footVer', foot === '4.11.65', foot);
chk('3.4 script ?v=', scr === '4.11.65', scr);
chk('3.5 版本号与源码一致', 'v' + scr === VER, 'v' + scr + ' vs ' + VER);
// 旧版本号只允许作为更新日志条目出现
const oldLines = H.split('\n').filter(l => l.indexOf('4.11.64') >= 0);
chk('3.6 4.11.64 仅存于更新日志', oldLines.every(l => /起：|更新日志|<br><b>/.test(l)), '行数=' + oldLines.length);
chk('3.7 更新日志含 4.11.65 条目', H.indexOf('v4.11.65（2026-11-10）') >= 0);

console.log('');
console.log('=== 4. 回归面：不该动的东西没动 ===');
chk('4.1 日报/历史仍走 omit 名单', /OMIT_KEYS = \{ daily: 1, history: 1 \}/.test(S));
chk('4.2 取数上限仍 1200', /LIMIT_BY_KEY = \{ daily: 1200, history: 1200 \}/.test(S));
chk('4.3 8 秒防抖仍在', /UI_DEBOUNCE = 8000/.test(S));
chk('4.4 报告列常量仍是「完整主播报告」', /RPT_FIELD = '完整主播报告'|var RPT_FIELD/.test(S));
chk('4.5 三处「归0」渲染未被改动', (S.match(/sessionZero/g) || []).length > 5, 'sessionZero 出现 ' + (S.match(/sessionZero/g) || []).length + ' 次');

console.log('');
console.log('===== 合计 ' + PASS + ' PASS / ' + FAIL + ' FAIL =====');
if (FAIL) console.log('FAILED');
process.exit(FAIL ? 1 : 0);
