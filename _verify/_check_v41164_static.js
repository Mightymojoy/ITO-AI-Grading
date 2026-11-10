// v4.11.64 静态自检：确认「1254607 重试 + 前端自动重试 + 兜底换 lastGood」三件事都已落到代码里。
// 铁律：断言只查语义标志，不查行号；版本号只查锚点，不查更新日志（日志里必然有历史版本号）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const api = read('api/feishu-read.js');
const shell = read('v4/v4-shell.js');
const html = read('v4/index.html');

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  OK  ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '   ' + detail : '')); }
}
const cnt = (s, k) => s.split(k).length - 1;

console.log('=== 1. api/feishu-read.js：1254607 重试 ===');
chk('1.1 有 RETRY_DELAYS 常量', api.includes('RETRY_DELAYS'));
chk('1.2 有 httpsJsonRetry 函数', api.includes('async function httpsJsonRetry'));
chk('1.3 识别 1254607', api.includes('1254607'));
chk('1.4 识别 429 限流', api.includes('c === 429'));
chk('1.5 保留 1254045 兜底语义（不重试、退回全字段）',
  api.includes("Number(r.code) !== 1254045"), '1254045 出现 ' + cnt(api, '1254045') + ' 次');
chk('1.6 记录请求走重试', /httpsJsonRetry\(\s*\{\s*hostname:'open\.feishu\.cn',\s*path:\s*base/.test(api.replace(/\n\s*/g, ' ')) || api.includes("'records table=' + tableId"));
chk('1.7 field_names 请求走重试', api.includes("'fields-filter table=' + tableId"));
chk('1.8 字段元数据只重试 1 次（有降级不该久等）',
  /'fields table=' \+ tableId, 1\)/.test(api));
chk('1.9 响应仍带 setEncoding(utf8)（编码铁律）', api.includes("res.setEncoding('utf8')"));

console.log('\n=== 2. v4/v4-shell.js：自动重试与兜底 ===');
chk('2.1 有 lastGood 结构', shell.includes('lastGood: {}') && shell.includes('V4CLOUD.lastGood[key]'));
chk('2.2 成功时记录 lastGood', /if\(d && d\.rows && d\.rows\.length\) V4CLOUD\.lastGood\[key\] = /.test(shell));
chk('2.3 失败后自动重试一次（5 秒）', shell.includes('5 秒后自动重试一次') && shell.includes('}, 5000);'));
chk('2.4 兜底优先 lastGood', shell.includes("source: 'lastGood'"));
chk('2.5 兜底次选静态快照', shell.includes("source: 'snapshot'"));
chk('2.6 红字区分两种兜底', shell.includes('飞书暂不可读（表格正在重算）') && shell.includes('当前为本地快照'));
chk('2.7 并发去重 INFLIGHT', shell.includes('V4CLOUD.inflight') && shell.includes('if(INFLIGHT[key]) return INFLIGHT[key];'));
chk('2.8 立即同步清 inflight', cnt(shell, 'delete window.V4CLOUD.inflight[ik]') >= 1);
chk('2.9 重新载入清 inflight', cnt(shell, 'delete V4CLOUD.inflight[ik]') >= 1);
chk('2.10 仍保留 READ_SLIM 逃生阀', shell.includes("localStorage.getItem('v4read_slim')"));
chk('2.11 仍保留 fallback 红字机制', shell.includes("document.getElementById('fsWarn')"));

console.log('\n=== 3. 版本号一致性 ===');
const m = shell.match(/var V4_VERSION = '([^']+)'/);
chk('3.1 V4_VERSION = v4.11.64', m && m[1] === 'v4.11.64', m ? m[1] : 'N/A');
for (const [name, re] of [['brandVer', /id="brandVer"[^>]*>v?([\d.]+)</],
  ['pageBadge', /id="pageBadge"[^>]*>v?([\d.]+)</],
  ['footVer', /id="footVer"[^>]*>v?([\d.]+)</],
  ['script', /v4-shell\.js\?v=([\d.]+)/]]) {
  const mm = html.match(re);
  chk('3.2 ' + name + ' = 4.11.64', mm && mm[1] === '4.11.64', mm ? mm[1] : 'N/A');
}
const oldLines = html.split('\n').filter(l => l.includes('4.11.63'));
chk('3.3 4.11.63 仅存于更新日志历史条目',
  oldLines.length === 1 && oldLines[0].includes('4.11.63（2026-11-09）'),
  '出现行数=' + oldLines.length);

console.log('\n===== ' + pass + ' PASS / ' + fail + ' FAIL =====');
process.exit(fail ? 1 : 0);
