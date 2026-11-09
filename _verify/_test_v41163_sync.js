/* v4.11.63 验证：api/feishu-sync.js 的 listRecords 是否真能拉到表尾
 * 核心命题：修复前「查旧行」只能看到前 200 行 ⇒ 尾部记录永远找不到 ⇒ 每次评分多一条
 *           修复后「查旧行」能覆盖全表 703 行 ⇒ 能找到并删掉旧行
 * 做法：用 vm 加载真实源文件（不复制逻辑），额外导出内部函数后真打飞书。
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), https = require('https');

const ROOT = path.join(__dirname, '..');
const HIST = 'tblkN1e6yCtXl5bG';

// ---------- 读 .env ----------
const env = {};
fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach(function(l){
  l = l.trim();
  if(!l || l.charAt(0) === '#' || l.indexOf('=') < 0) return;
  const i = l.indexOf('=');
  env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
});

// ---------- vm 加载真实源码 ----------
let src = fs.readFileSync(path.join(ROOT, 'api', 'feishu-sync.js'), 'utf8');
src += '\nmodule.exports.__t = { listRecords: listRecords, findRecordsByHostDate: findRecordsByHostDate, findRecordByField: findRecordByField, getToken: getToken };\n';

const sandbox = {
  module: { exports: {} }, exports: {}, require: require, console: console,
  process: { env: Object.assign({}, process.env, env) },
  Buffer: Buffer, setTimeout: setTimeout, clearTimeout: clearTimeout,
  encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
  Date: Date, JSON: JSON, Math: Math, String: String, Number: Number,
  Object: Object, Array: Array, Error: Error, Promise: Promise, isFinite: isFinite
};
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'feishu-sync.js' });

const T = sandbox.module.exports.__t;
const BASE = env.FEISHU_BASE_TOKEN;

function rawPage(ps, pageToken, token){
  return new Promise(function(resolve, reject){
    let p = '/open-apis/bitable/v1/apps/' + BASE + '/tables/' + HIST + '/records?page_size=' + ps;
    if(pageToken) p += '&page_token=' + encodeURIComponent(pageToken);
    const req = https.request({
      hostname: 'open.feishu.cn', path: p, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }          // ← 必须带，否则 0 行是鉴权失败而非分页限制
    }, function(res){
      let d = ''; res.setEncoding('utf8');
      res.on('data', function(c){ d += c; });
      res.on('end', function(){ try{ resolve(JSON.parse(d)); }catch(e){ reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(120000, function(){ req.destroy(new Error('timeout')); });
    req.end();
  });
}

let pass = 0, fail = 0;
function chk(name, cond, detail){
  if(cond){ pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + '  [' + (detail || '') + ']'); }
}

(async function(){
  console.log('=== 准备：取 token ===');
  const token = await T.getToken();
  console.log('  token ok=' + !!token);

  // ---------- 1. 全量分页：应覆盖 703 行 ----------
  console.log('\n=== 1. listRecords 全量分页（修复后）===');
  const t0 = Date.now();
  const all = await T.listRecords(token, HIST);
  const dt = (Date.now() - t0) / 1000;
  console.log('  拉到 ' + all.length + ' 行，耗时 ' + dt.toFixed(1) + 's');
  chk('1.1 行数 > 200（突破旧的单页上限）', all.length > 200, 'rows=' + all.length);
  // ⚠️ 不写死具体行数：表会持续增长，2026-11-09 清理重复行后是 563。
  //   这里只验证「确实翻了页」——单页上限 500，翻页生效则必然 ≥ 500 或 has_more 为假。
  chk('1.2 至少拉满一页（500）或表本身就小于一页', all.length >= 500, 'rows=' + all.length);

  // 表尾记录是否存在：不写死主播名（历史表里有「曲曲姝锜」这类脏名字），
  // 改用「表尾这些行是否落在第一页之外」来直接证明分页真的翻到了后面。
  const tailRecs = all.slice(-50);
  chk('1.3 表尾 50 条已拉到（不再是空）', tailRecs.length === 50, 'tail=' + tailRecs.length);

  // ---------- 2. 对照：旧的「只拉第一页 200 行」看不到尾部 ----------
  console.log('\n=== 2. 对照组：旧实现（page_size=200 且不翻页）===');
  const p1 = await rawPage(200, '', token);
  const oldRows = (p1.data && p1.data.items) || [];
  console.log('  旧实现只能看到 ' + oldRows.length + ' 行（has_more=' + (p1.data && p1.data.has_more) +
              ', code=' + p1.code + '）');
  const oldIds = Object.create(null);
  oldRows.forEach(function(r){ oldIds[r.record_id] = 1; });
  const missed = tailRecs.filter(function(r){ return !oldIds[r.record_id]; }).length;
  console.log('  表尾 50 条里，旧实现看不到的：' + missed + ' 条');
  chk('2.1 旧实现确实漏掉表尾记录', missed > 0, 'missed=' + missed + '/50');
  chk('2.2 旧实现行数被单页卡住', oldRows.length === 200, 'old=' + oldRows.length);

  // ---------- 3. 去重函数：能真的找到「同人同日」的记录 ----------
  // ⚠️ 不写死「某人某日有 N 条」：重复行已于 2026-11-09 清理过，写死数字必然过期。
  //   改为动态：从表尾（=最新）取样本，要求 findRecordsByHostDate 能命中这条记录本身。
  //   这正是 upsert「先删旧行」的唯一依据 —— 命中不了就会一直新增。
  console.log('\n=== 3. findRecordsByHostDate（upsert 的「先删」依据）===');
  const probes = [];
  for(let i = all.length - 1; i >= 0 && probes.length < 3; i -= Math.max(1, Math.floor(all.length / 6))){
    const f = all[i].fields || {};
    const h = String(f['主播'] || '').trim();
    const d = String(f['日期'] || '').slice(0, 10);
    if(h && /^\d{4}-\d{1,2}-\d{1,2}/.test(d)) probes.push({ host: h, date: d, id: all[i].record_id });
  }
  chk('3.0 取到表尾样本', probes.length === 3, 'n=' + probes.length);
  for(const p of probes){
    const hits = await T.findRecordsByHostDate(token, HIST, p.host, p.date);
    const found = hits.some(function(r){ return r.record_id === p.id; });
    chk('3.x 能定位到 ' + p.host + ' ' + p.date + ' 的记录', found,
        'hit=' + hits.length + ' 目标=' + (found ? '命中' : '未命中'));
  }

  // ---------- 4. 空 tableId 时保持旧语义 ----------
  console.log('\n=== 4. 边界：tableId 为空 ===');
  const empty = await T.listRecords(token, '');
  chk('4.1 空 tableId 返回空数组（不抛错，调用方有 skipped 守卫）', Array.isArray(empty) && empty.length === 0);

  // ---------- 5. 错误不再被吞成「空数组」 ----------
  console.log('\n=== 5. 边界：表 ID 非法时应抛错而不是返回 [] ===');
  let threw = false, msg = '';
  try{ await T.listRecords(token, 'tblNOTEXIST000000'); }
  catch(e){ threw = true; msg = (e && e.message) || String(e); }
  chk('5.1 非法表 ID 抛错（不再静默返回空）', threw, msg.slice(0, 70));

  console.log('\n================ ' + pass + ' PASS / ' + fail + ' FAIL ================');
  process.exit(fail ? 1 : 0);
})().catch(function(e){
  console.error('异常终止:', e && e.stack || e);
  process.exit(2);
});
