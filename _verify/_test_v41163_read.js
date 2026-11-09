/* v4.11.63 验证：api/feishu-read.js
 * 重点：① field_names 命中 1254045 时能否自动退回全字段（omit 不能成为新的单点故障）
 *       ② stop_at 提前停时 limited 是否如实为 true（防静默截断）
 * 做法：vm 加载真实源文件，导出内部函数 + mock req/res 调 handler，真打飞书。
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DAILY = 'tblQC7Jfzmxp6QJI';

const env = {};
fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach(function(l){
  l = l.trim();
  if(!l || l.charAt(0) === '#' || l.indexOf('=') < 0) return;
  const i = l.indexOf('=');
  env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
});

let src = fs.readFileSync(path.join(ROOT, 'api', 'feishu-read.js'), 'utf8');
src += '\nmodule.exports.__t = { listRecordsPage: listRecordsPage, allFieldsOf: allFieldsOf, dateFieldsOf: dateFieldsOf };\n';

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
vm.runInContext(src, sandbox, { filename: 'feishu-read.js' });

const T = sandbox.module.exports.__t;
const handler = sandbox.module.exports;

let pass = 0, fail = 0;
function chk(name, cond, detail){
  if(cond){ pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + name + '  [' + (detail || '') + ']'); }
}

// handler 需要 token —— 从内部 getToken 拿不到，用 listRecordsPage 的第一枪自己不会取 token。
// 所以这里通过 /fields 拿一个 token：直接改成让 handler 跑，从响应判断。
function callHandler(body){
  return new Promise(function(resolve){
    let code = 200, out = null;
    const res = {
      setHeader: function(){},
      status: function(c){ code = c; return res; },
      json: function(o){ out = o; resolve({ code: code, body: o }); },
      end: function(){ resolve({ code: code, body: out }); }
    };
    const req = { method: 'POST', body: body, query: {} };
    handler(req, res).catch(function(e){ resolve({ code: 500, body: { ok: false, error: String(e && e.message || e) } }); });
  });
}

(async function(){
  // 先拿一个真实 token（内部函数未导出 getToken，这里用 handler 的 /fields 缓存路径间接不可行）
  // ⇒ 直接从飞书取 token 给 listRecordsPage 用
  const https = require('https');
  function post(host, p, body, headers){
    return new Promise(function(resolve, reject){
      const req = https.request({ hostname: host, path: p, method: 'POST', headers: headers }, function(res){
        let d = ''; res.setEncoding('utf8');
        res.on('data', function(c){ d += c; });
        res.on('end', function(){ try{ resolve(JSON.parse(d)); }catch(e){ reject(e); } });
      });
      req.on('error', reject); req.end(body);
    });
  }
  const tb = JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET });
  const tk = await post('open.feishu.cn', '/open-apis/auth/v3/tenant_access_token/internal', tb,
                        { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tb) });
  const token = tk.tenant_access_token;
  chk('0.1 取 token', !!token);

  // ---------- 1. 真实字段名（剔报告列）⇒ 应走 field_names 并成功 ----------
  console.log('\n=== 1. 正常 omit 路径（真实字段名）===');
  const all = await T.allFieldsOf(token, DAILY);
  const keep = all.filter(function(n){ return n !== '完整主播报告'; });
  console.log('  /fields 共 ' + all.length + ' 字段，keep ' + keep.length);
  const t1 = Date.now();
  const r1 = await T.listRecordsPage(token, DAILY, 500, '', '', keep);
  console.log('  耗时 ' + ((Date.now() - t1) / 1000).toFixed(1) + 's');
  chk('1.1 fieldFiltered=true', r1.fieldFiltered === true);
  chk('1.2 行数 > 0', (r1.d.items || []).length > 0, 'rows=' + (r1.d.items || []).length);

  // ---------- 2. 造一个不存在字段 ⇒ 飞书 1254045 ⇒ 必须自动兜底 ----------
  console.log('\n=== 2. 故意混入不存在字段（应自动退回全字段，不报错）===');
  let r2 = null, err2 = '';
  const t2 = Date.now();
  try{
    r2 = await T.listRecordsPage(token, DAILY, 500, '', '', keep.concat(['这个字段不存在_测试']));
  }catch(e){ err2 = (e && e.message) || String(e); }
  console.log('  耗时 ' + ((Date.now() - t2) / 1000).toFixed(1) + 's');
  chk('2.1 没有抛错（兜底生效）', r2 !== null, err2.slice(0, 80));
  if(r2){
    chk('2.2 fieldFiltered=false（如实标记已退回）', r2.fieldFiltered === false);
    chk('2.3 数据仍然完整（行数与前一致）', (r2.d.items || []).length === (r1.d.items || []).length,
        'after=' + (r2.d.items || []).length + ' before=' + (r1.d.items || []).length);
  }

  // ---------- 3. handler：omit 生效 → 无报告列 ----------
  console.log('\n=== 3. handler 带 omit ===');
  const h3 = await callHandler({ action: 'records', key: 'daily', limit: 1200, omit: ['完整主播报告'] });
  chk('3.1 ok=true', h3.body && h3.body.ok === true, JSON.stringify(h3.body && (h3.body.error || '')).slice(0, 80));
  if(h3.body && h3.body.ok){
    chk('3.2 响应里没有「完整主播报告」列', (h3.body.columns || []).indexOf('完整主播报告') < 0,
        'cols=' + (h3.body.columns || []).length);
    chk('3.3 omitted 回显正确', (h3.body.omitted || []).indexOf('完整主播报告') >= 0);
    chk('3.4 fieldFiltered=true', h3.body.fieldFiltered === true);
    chk('3.5 limited=false（1200 足够拉全）', h3.body.limited === false,
        'total=' + h3.body.total + ' total_all=' + h3.body.total_all);
  }

  // ---------- 4. handler：stop_at 提前停 ⇒ limited 必须为 true ----------
  console.log('\n=== 4. handler 带 stop_at 且 limit 很小（模拟截断）===');
  const h4 = await callHandler({ action: 'records', key: 'daily', limit: 100, stop_at: 1, omit: ['完整主播报告'] });
  chk('4.1 ok=true', h4.body && h4.body.ok === true);
  if(h4.body && h4.body.ok){
    chk('4.2 只拿了 100 条', h4.body.total === 100, 'total=' + h4.body.total);
    chk('4.3 limited=true（如实报告被截断）', h4.body.limited === true, 'limited=' + h4.body.limited);
  }

  // ---------- 5. 不带 omit = 旧行为 ----------
  console.log('\n=== 5. 不传 omit（旧行为，默认参数零影响）===');
  const h5 = await callHandler({ action: 'records', key: 'daily', limit: 5 });
  chk('5.1 ok=true', h5.body && h5.body.ok === true);
  if(h5.body && h5.body.ok){
    chk('5.2 omitted 为空', (h5.body.omitted || []).length === 0);
    chk('5.3 fieldFiltered=false', h5.body.fieldFiltered === false);
  }

  console.log('\n================ ' + pass + ' PASS / ' + fail + ' FAIL ================');
  process.exit(fail ? 1 : 0);
})().catch(function(e){
  console.error('异常终止:', e && e.stack || e);
  process.exit(2);
});
