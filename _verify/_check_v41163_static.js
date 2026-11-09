/* v4.11.63 静态自检：确认本批 6 项改动都真的落在文件里，且没有残留旧写法。
 * 只读文件、不发网络请求。任一条 FAIL 说明改动没落地或被覆盖。
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(ROOT, 'v4', 'v4-shell.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'v4', 'index.html'), 'utf8');
const sync = fs.readFileSync(path.join(ROOT, 'api', 'feishu-sync.js'), 'utf8');
const read = fs.readFileSync(path.join(ROOT, 'api', 'feishu-read.js'), 'utf8');

let pass = 0, fail = 0;
function chk(name, cond, detail){
  if(cond){ pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + '  [' + (detail || '') + ']'); }
}
function cnt(s, sub){ return s.split(sub).length - 1; }

console.log('=== 1. api/feishu-sync.js（历史评分重复的根因）===');
chk('1.1 listRecords 用了 page_size=500', sync.indexOf('records?page_size=500') >= 0);
chk('1.2 listRecords 有翻页 page_token', sync.indexOf("'&page_token='+encodeURIComponent(pageToken)") >= 0);
chk('1.3 listRecords 有循环护栏 guard < 40', /guard < 40/.test(sync));
chk('1.4 查询失败改为抛错', sync.indexOf("throw new Error('拉取记录失败（table='") >= 0);
chk('1.5 不再静默 return [] 吞错（旧写法已消失）',
    sync.indexOf("if(r.code !== 0) return [];") < 0,
    'count=' + cnt(sync, 'if(r.code !== 0) return [];'));
// 注意：注释里会写「原实现 page_size=200」作历史说明，所以这里只判**真实请求路径**
chk('1.6 旧的 200 行分页请求已消失', cnt(sync, 'records?page_size=200') === 0,
    'count=' + cnt(sync, 'records?page_size=200'));
chk('1.7 明星整改表读取提到循环外（detailRecs）', sync.indexOf('const detailRecs = starList.length ? await listRecords(token, TBL.detail) : [];') >= 0);
chk('1.8 循环内不再重复拉全表', sync.indexOf('const existRecs = await listRecords(token, TBL.detail);') < 0);
chk('1.9 history 写入有 try/catch 兜底', sync.indexOf('查询旧行失败，本条未写入') >= 0);

console.log('\n=== 2. api/feishu-read.js（omit 兜底 + limited 如实）===');
chk('2.1 有 1254045 判断', sync && read.indexOf('1254045') >= 0);
chk('2.2 命中后重试一次（第二枪不带 field_names）',
    read.indexOf("console.log('[feishu-read] field_names 被拒") >= 0);
chk('2.3 listRecordsPage 返回 fieldFiltered', /return \{ d: r2\.data \|\| \{\}, fieldFiltered: false \}/.test(read));
chk('2.4 有 stoppedEarly 记录提前停', read.indexOf('stoppedEarly') >= 0);
chk('2.5 limited 包含 stoppedEarly', /limited: \(totalAll > rows\.length\) \|\| stoppedEarly/.test(read));
chk('2.6 响应 fieldFiltered 用实际值（不是 !!fieldNames）',
    read.indexOf('fieldFiltered: usedFieldFilter') >= 0 && read.indexOf('fieldFiltered: !!fieldNames') < 0);

console.log('\n=== 3. v4/v4-shell.js（上限 / 警示 / 同步按钮）===');
chk('3.1 V4_VERSION = v4.11.63', /var V4_VERSION = 'v4\.11\.63'/.test(shell));
chk('3.2 日报上限 1200', /daily: 1200, history: 1200/.test(shell));
chk('3.3 旧上限 500 已消失', shell.indexOf('daily: 500, history: 800') < 0);
chk('3.4 V4CLOUD.limit = 1200', /limit: 1200/.test(shell));
chk('3.5 V4CLOUD 有 fallback 容器', /fallback: \{\}/.test(shell));
chk('3.6 成功时清除 fallback', shell.indexOf('delete V4CLOUD.fallback[key]') >= 0);
chk('3.7 失败时写入 fallback（含 reason/syncedAt）',
    shell.indexOf('V4CLOUD.fallback[key] = {') >= 0 && shell.indexOf('syncedAt: (d && d.syncedAt)') >= 0);
chk('3.8 v4FsShowSync 渲染 fsWarn', shell.indexOf("document.getElementById('fsWarn')") >= 0);
chk('3.9 警示文案含「当前为本地快照」', shell.indexOf('当前为本地快照') >= 0);
chk('3.10 按钮绑定 fsSyncNowBtn', shell.indexOf("document.getElementById('fsSyncNowBtn')") >= 0);
chk('3.11 按钮会清 V4CLOUD.cache 与 fallback',
    /window\.V4CLOUD\.cache = \{\};[\s\S]{0,80}window\.V4CLOUD\.fallback = \{\};/.test(shell));
chk('3.12 状态行颜色会复位（防红字残留）', shell.indexOf("st.style.color = 'var(--text3)'") >= 0);

console.log('\n=== 4. v4/index.html（按钮 DOM + 版本号）===');
chk('4.1 有 fsSyncNowBtn 按钮', html.indexOf('id="fsSyncNowBtn"') >= 0);
chk('4.2 有 fsWarn 警示位', html.indexOf('id="fsWarn"') >= 0);
// 页脚更新日志里会保留「· v4.11.62 起：…」作为版本沿革，所以只判四处「当前版本号」位置
chk('4.3 版本号四处无 4.11.62 残留',
    cnt(html, '>v4.11.62<') === 0 && cnt(html, '?v=4.11.62') === 0,
    'tag=' + cnt(html, '>v4.11.62<') + ' qs=' + cnt(html, '?v=4.11.62'));
chk('4.4 brandVer/pageBadge/footVer/script 全为 4.11.63', cnt(html, '4.11.63') >= 4, 'count=' + cnt(html, '4.11.63'));
chk('4.5 页脚有 v4.11.63 更新日志', html.indexOf('v4.11.63（2026-11-09）') >= 0);

console.log('\n================ ' + pass + ' PASS / ' + fail + ' FAIL ================');
process.exit(fail ? 1 : 0);
