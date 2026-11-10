// v4.11.66 静态自检：断言必须对「真实代码形态」成立，不能凭上一轮措辞想当然。
// 口径统一从源码现读（版本号、上限常量），不硬编码期望值（铁律 9）。
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(REPO, 'v4', 'v4-shell.js'), 'utf8');
const HTML = fs.readFileSync(path.join(REPO, 'v4', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
};
const grab = (re, s) => { const m = (s || SHELL).match(re); return m ? m[1] : null; };

console.log('=== 1. 版本号（四处锚点，从源码现读，不硬编码）===');
const ver = grab(/var V4_VERSION = '([^']+)'/);
chk('1.1 V4_VERSION 形如 v4.11.x', /^v4\.11\.\d+$/.test(ver || ''), ver);
const num = (ver || '').replace(/^v/, '');
const brands = [...HTML.matchAll(/id="(brandVer|pageBadge|footVer)"[^>]*>v?([\d.]+)</g)]
  .map(m => m[1] + '=' + m[2]);
chk('1.2 三处徽标齐全', brands.length === 3, brands.join(' '));
chk('1.3 三处徽标均等于 V4_VERSION', brands.every(b => b.split('=')[1] === num), brands.join(' '));
const sv = grab(/v4-shell\.js\?v=([\d.]+)/, HTML);
chk('1.4 script ?v= 等于 V4_VERSION', sv === num, 'html=' + sv + ' shell=' + num);
chk('1.5 index.html 内联的 v4.11.66 徽标存在', HTML.includes('>v' + num + '<'));

console.log('');
console.log('=== 2. 预警条容器与函数 ===');
chk('2.1 index.html 有 #fsBanner 容器', /id="fsBanner"/.test(HTML));
chk('2.2 容器默认隐藏', /id="fsBanner"[^>]*style="display:none/.test(HTML));
chk('2.3 v4FsBanner 函数已定义', /function v4FsBanner\s*\(/.test(SHELL));
const syncBody = (() => {
  const i = SHELL.indexOf('function v4FsShowSync(');
  return i < 0 ? '' : SHELL.slice(i, i + 400);
})();
chk('2.4 v4FsShowSync 里调用 v4FsBanner', /try\{\s*v4FsBanner\(\);\s*\}catch/.test(syncBody));

console.log('');
console.log('=== 3. 三档判据都在（红=回退 / 橙=截断 / 橙=临近上限）===');
chk('3.1 回退档走 V4CLOUD.fallback', /window\.V4CLOUD\.fallback\)/.test(SHELL.slice(SHELL.indexOf('function v4FsBanner'))));
chk('3.2 区分 lastGood 与静态快照', SHELL.includes("fb.source === 'lastGood'"));
chk('3.3 截断档读 st.limited', /if\(st\.limited\)\{/.test(SHELL));
chk('3.4 临近上限阈值 85%', /n \/ lim >= 0\.85/.test(SHELL));
chk('3.5 v4FsDaysToLimit 已定义', /function v4FsDaysToLimit\s*\(/.test(SHELL));
chk('3.6 增长率从日期跨度现算（不写死数字）',
  /var span = \(ds\[ds\.length - 1\] - ds\[0\]\) \/ 86400000 \+ 1/.test(SHELL));
chk('3.7 红色档与橙色档文案齐全', SHELL.includes("lv: 'red'") && SHELL.includes("lv: 'orange'"));

console.log('');
console.log('=== 4. 状态与上限贯通 ===');
chk('4.1 V4_FS_STATE 含 limited 字段', /V4_FS_STATE = \{[^}]*limited:/.test(SHELL));
chk('4.2 V4_FS_STATE 含 totalAll 字段', /V4_FS_STATE = \{[^}]*totalAll:/.test(SHELL));
chk('4.3 加载时从 d.limited 赋值', /V4_FS_STATE\.limited = !!d\.limited;/.test(SHELL));
chk('4.4 加载时从 d.total_all 赋值', /V4_FS_STATE\.totalAll = \(typeof d\.total_all === 'number'\)/.test(SHELL));
chk('4.5 换表时复位 limited', /V4_FS_STATE\.limited = false;/.test(SHELL));
chk('4.6 上限经 window 暴露（跨 IIFE 必须走 window）',
  /window\.V4_FS_LIMIT_MAX = \(LIMIT_BY_KEY\[key\] \|\| V4CLOUD\.limit\)/.test(SHELL));

console.log('');
console.log('=== 5. 跨闭包安全（v4.11.65 的坑不许再犯）===');
const bStart = SHELL.indexOf('function v4FsBanner()');
const bEnd = SHELL.indexOf('function v4FeishuLoad(key)', bStart);
const blk = bStart >= 0 && bEnd > bStart ? SHELL.slice(bStart, bEnd) : '';
chk('5.1 取到 v4FsBanner 代码块', blk.length > 500, blk.length + ' 字符');
const bare = [];
for (const name of ['esc', 'V4CLOUD', 'LIMIT_BY_KEY', 'ddate', 'fetchCloud', 'byMonth']) {
  const re = new RegExp('(?<![.\\w$])' + name + '\\s*[(\\[{.]', 'g');
  const hit = (blk.match(re) || []).length;
  if (hit) bare.push(name + '×' + hit);
}
chk('5.2 块内无裸跨闭包引用（除 window. 前缀）', bare.length === 0, bare.join(', ') || '无');
chk('5.3 自带本地转义 _esc', /var _esc = function\(s\)\{/.test(blk));

console.log('');
console.log('=== 6. 两个运维脚本口径与源码一致 ===');
const hc = fs.readFileSync(path.join(REPO, '_verify', '_health_check.py'), 'utf8');
const ar = fs.readFileSync(path.join(REPO, '_verify', '_archive_old_rows.py'), 'utf8');
const shellLimit = grab(/var LIMIT_BY_KEY = \{ daily: (\d+), history: (\d+)/);
const limDaily = shellLimit;   // grab() 只返回第一个捕获组 = daily 的上限
const hcLimit = grab(/LIMIT_MAX = (\d+)/, hc);
chk('6.1 体检脚本上限 == 壳层 LIMIT_BY_KEY.daily', String(hcLimit) === String(limDaily),
  'hc=' + hcLimit + ' shell=' + limDaily);
chk('6.2 归档脚本上限 == 壳层 LIMIT_BY_KEY.daily',
  String(grab(/LIMIT_MAX = (\d+)/, ar)) === String(limDaily));
chk('6.3 体检脚本会算距上限天数', /days_to_limit/.test(hc));
chk('6.4 体检脚本退出码三档', /sys\.exit\(worst\)/.test(hc));
chk('6.5 归档默认演练（须显式 --apply）', /if not args\.apply:/.test(ar));
chk('6.6 归档有 60% 自毁闸门', /pct > 60 and not args\.force/.test(ar));
chk('6.7 归档备份后回读校验', /备份回读校验失败/.test(ar));
chk('6.8 归档缺 record_id 时拒绝删', /缺 record_id/.test(ar));

console.log('');
console.log('======== ' + pass + '/' + (pass + fail) + ' PASS ========');
if (fail) { console.log('未过项：' + fail + ' 个'); process.exit(2); }
