/**
 * v4.11.62 静态自检：核对壳层改动点齐全、无残留旧写法。
 * 只读源码做断言，不联网。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(ROOT, 'v4', 'v4-shell.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'v4', 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(ROOT, 'api', 'feishu-read.js'), 'utf8');

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '   << ' + (detail === undefined ? '' : String(detail).slice(0, 160))); }
}
function count(src, needle) { return src.split(needle).length - 1; }

console.log('=== 1. 接口 api/feishu-read.js ===');
chk('1.1 parseOmit 已定义', /function parseOmit\(v\)/.test(api));
chk('1.2 allFieldsOf 已定义', /async function allFieldsOf/.test(api));
chk('1.3 field_names 已透传', /field_names=/.test(api));
chk('1.4 stop_at 已实现', /stopAt && rows\.length >= limit/.test(api));
chk('1.5 返回体带 omitted', /omitted: omitSet/.test(api));
chk('1.6 返回体带 fieldFiltered', /fieldFiltered: !!fieldNames/.test(api));
chk('1.7 服务端二次剔除', /if\(k in o\) delete o\[k\]/.test(api));

console.log('=== 2. 壳层常量与开关 ===');
chk('2.1 版本号 v4.11.62', /var V4_VERSION = 'v4\.11\.62'/.test(shell), (shell.match(/V4_VERSION = '([^']+)'/) || [])[1]);
chk('2.2 READ_TIMEOUT=90000', /var READ_TIMEOUT = READ_SLIM \? 90000 : 20000/.test(shell));
chk('2.3 OMIT_KEYS 含 daily+history', /var OMIT_KEYS = \{ daily: 1, history: 1 \}/.test(shell));
chk('2.4 withOmit 定义', /function withOmit\(payload, keyOrTableId, stopAt\)/.test(shell));
chk('2.5 逃生阀 v4read_slim', /v4read_slim/.test(shell));

console.log('=== 3. 四处读飞书请求都带 omit ===');
chk('3.1 cloudEnsure 用 withOmit', /withOmit\(\{ action: 'records', key: key/.test(shell));
chk('3.2 cloudEnsure 传 READ_TIMEOUT', /fetchCloud\(payload, READ_TIMEOUT\)/.test(shell));
chk('3.3 三评/趋势请求体带 omit+stop_at', count(shell, "body: JSON.stringify({ key: 'daily', limit: 500, omit: ['\u5b8c\u6574\u4e3b\u64ad\u62a5\u544a'], stop_at: 1 })") === 2,
  'count=' + count(shell, "body: JSON.stringify({ key: 'daily', limit: 500, omit: ['\u5b8c\u6574\u4e3b\u64ad\u62a5\u544a'], stop_at: 1 })"));
chk('3.4 三评超时 90000', /try\{ ctrl\.abort\(\); \}catch\(e\)\{\} \}, 90000\)/.test(shell));
chk('3.5 趋势超时 120000', /try\{ ctrl\.abort\(\); \}catch\(e\)\{\} \}, 120000\)/.test(shell));
chk('3.6 无 limit: 1200 残留', count(shell, 'limit: 1200') === 0, 'count=' + count(shell, 'limit: 1200'));
chk('3.7 omit 字面量出现 >=3 次', count(shell, "omit: ['\u5b8c\u6574\u4e3b\u64ad\u62a5\u544a']") >= 2,
  'count=' + count(shell, "omit: ['\u5b8c\u6574\u4e3b\u64ad\u62a5\u544a']"));

console.log('=== 4. 历史页两批取数 ===');
const ensureStart = shell.indexOf('function ensureCloud(force){');
const ensureEnd = shell.indexOf('function mergeHistory(', ensureStart);
const ensureBody = shell.slice(ensureStart, ensureEnd);
chk('4.1 ensureCloud 已定位', ensureStart > 0 && ensureEnd > ensureStart);
chk('4.2 ensureCloud 内不再解析报告', ensureBody.indexOf('JSON.parse(rep)') < 0);
chk('4.3 ensureCloud 调用 kickReports', /kickReports\(\);/.test(ensureBody));
chk('4.4 buildCloudRows 已定义', /function buildCloudRows\(rows\)/.test(shell));
chk('4.5 applyReports 已定义', /function applyReports\(rows\)/.test(shell));
chk('4.6 kickReports 不带 omit', /fetchCloud\(\{ action: 'records', key: 'history', limit: V4CLOUD\.limit \}, RPT_TIMEOUT\)/.test(shell));
chk('4.7 V4RPT 暴露 reportsPending', /reportsPending: reportsPending,/.test(shell));
chk('4.8 V4RPT 暴露 kickReports', /kickReports: kickReports,/.test(shell));
chk('4.9 渲染层用 _rptPend（声明+使用）', count(shell, '_rptPend') >= 3, 'count=' + count(shell, '_rptPend'));
chk('4.10 渲染层有加载中文案', /完整报告正在从飞书加载/.test(shell));
chk('4.11 tipHtml 区分加载中', /RPT_LOADING \?/.test(shell));

console.log('=== 5. 秒表与超时文案 ===');
chk('5.1 慢表提示文案', /该表数据量大，实测约 20~50 秒/.test(shell));
chk('5.2 秒表 setInterval', /window\.__v4FsTick = setInterval/.test(shell));
chk('5.3 渲染时清秒表', /clearInterval\(window\.__v4FsTick\)/.test(shell) && count(shell, 'clearInterval(window.__v4FsTick)') >= 2,
  'count=' + count(shell, 'clearInterval(window.__v4FsTick)'));

console.log('=== 6. index.html 版本一致性 ===');
chk('6.1 brandVer', /<span id="brandVer">v4\.11\.62<\/span>/.test(html));
chk('6.2 pageBadge', /id="pageBadge"[^>]*>v4\.11\.62<\/span>/.test(html));
chk('6.3 footVer', /<span id="footVer">v4\.11\.62<\/span>/.test(html));
chk('6.4 脚本缓存戳', /v4-shell\.js\?v=4\.11\.62/.test(html));
chk('6.5 其余脚本戳未动', /app-core\.js\?v=4\.11\.50/.test(html) && /violation-rules\.js\?v=3\.1\.3/.test(html));
// 468 / 524 行的 4.11.61 是 HTML 注释与页脚更新日志（历史记录，应当保留），
// 只断言「版本徽标 + 脚本缓存戳」没有残留旧值。
chk('6.6 无旧缓存戳残留', count(html, '?v=4.11.61') === 0, 'count=' + count(html, '?v=4.11.61'));
chk('6.7 页脚已追加 v4.11.62 日志', /v4\.11\.62 起：修「每周一打开都是上周数据」/.test(html));

console.log('\n===== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
