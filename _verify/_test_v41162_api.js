/**
 * v4.11.62 接口自检：本地直接调用 api/feishu-read.js 的 handler（真实打飞书）
 * 验证 omit / stop_at 行为，以及「不传参数时行为与旧版一致」。
 * 只读，不写飞书。
 */
const path = require('path');
const fs = require('fs');

// ---- 载入 .env 到 process.env（handler 从这里读凭证）----
const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
envTxt.split(/\r?\n/).forEach(function (line) {
  line = line.trim();
  if (!line || line.charAt(0) === '#' || line.indexOf('=') < 0) return;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  if (!process.env[k]) process.env[k] = v;
});

const handler = require(path.join(__dirname, '..', 'api', 'feishu-read.js'));
const RPT = '\u5b8c\u6574\u4e3b\u64ad\u62a5\u544a';   // 完整主播报告

function call(body) {
  return new Promise(function (resolve) {
    const res = {
      code: 0, body: null,
      setHeader: function () {},
      status: function (c) { this.code = c; return this; },
      json: function (o) { this.body = o; resolve(o); },
      end: function () {}
    };
    const t0 = Date.now();
    Promise.resolve(handler({ method: 'POST', body: body }, res))
      .then(function () { res.__ms = Date.now() - t0; })
      .catch(function (e) { resolve({ ok: false, error: 'THROW: ' + e.message }); });
  });
}

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '   << ' + (detail === undefined ? '' : detail)); }
}

(async function () {
  console.log('=== A. daily 全字段（不传 omit，对照旧行为）===');
  let t = Date.now();
  let a = await call({ action: 'records', key: 'daily', limit: 500 });
  console.log('  ' + ((Date.now() - t) / 1000).toFixed(1) + 's  ok=' + a.ok + ' rows=' + (a.rows || []).length +
    ' cols=' + (a.columns || []).length + ' mb~' + (JSON.stringify(a.rows || []).length / 1048576).toFixed(1));
  chk('A1 ok=true', a.ok === true, JSON.stringify(a).slice(0, 200));
  if (a.ok) {
    chk('A2 有报告列', (a.columns || []).indexOf(RPT) >= 0);
    chk('A3 omitted 为空', Array.isArray(a.omitted) && a.omitted.length === 0, JSON.stringify(a.omitted));
    chk('A4 fieldFiltered=false', a.fieldFiltered === false, a.fieldFiltered);
    chk('A5 行数 474', (a.rows || []).length === 474, (a.rows || []).length);
  }

  console.log('=== B. daily + omit（本次改动主路径）===');
  t = Date.now();
  let b = await call({ action: 'records', key: 'daily', limit: 500, omit: ['\u5b8c\u6574\u4e3b\u64ad\u62a5\u544a'], stop_at: 1 });
  console.log('  ' + ((Date.now() - t) / 1000).toFixed(1) + 's  ok=' + b.ok + ' rows=' + (b.rows || []).length +
    ' cols=' + (b.columns || []).length);
  chk('B1 ok=true', b.ok === true, JSON.stringify(b).slice(0, 200));
  if (b.ok) {
    chk('B2 无报告列', (b.columns || []).indexOf(RPT) < 0, (b.columns || []).join(','));
    chk('B3 omitted 回显', (b.omitted || []).indexOf(RPT) >= 0, JSON.stringify(b.omitted));
    chk('B4 fieldFiltered=true', b.fieldFiltered === true, b.fieldFiltered);
    chk('B5 行数仍 474（一条不少）', (b.rows || []).length === 474, (b.rows || []).length);
    chk('B6 行内无该字段', (b.rows || []).every(function (r) { return !(RPT in r); }));
    const dates = (b.rows || []).map(function (r) { return String(r['\u65e5\u671f'] || '').slice(0, 10); }).sort();
    chk('B7 最新日期 2026-11-08', dates[dates.length - 1] === '2026-11-08', dates[dates.length - 1]);
    chk('B8 日期列未被破坏', /^\d{4}-\d{2}-\d{2}$/.test(dates[dates.length - 1] || ''), dates[dates.length - 1]);
  }

  console.log('=== C. daily + stop_at + limit=100（提前停页）===');
  t = Date.now();
  let c = await call({ action: 'records', key: 'daily', limit: 100, omit: ['\u5b8c\u6574\u4e3b\u64ad\u62a5\u544a'], stop_at: 1 });
  const cms = Date.now() - t;
  console.log('  ' + (cms / 1000).toFixed(1) + 's  ok=' + c.ok + ' rows=' + (c.rows || []).length);
  chk('C1 ok=true', c.ok === true);
  if (c.ok) {
    chk('C2 行数=100', (c.rows || []).length === 100, (c.rows || []).length);
    const cd = (c.rows || []).map(function (r) { return String(r['\u65e5\u671f'] || '').slice(0, 10); }).sort();
    chk('C3 仍含最新 2026-11-08（头在前）', cd[cd.length - 1] === '2026-11-08', cd[cd.length - 1]);
  }

  console.log('=== D. history + omit（历史页摘要批次）===');
  t = Date.now();
  let d = await call({ action: 'records', key: 'history', limit: 800, omit: ['\u5b8c\u6574\u4e3b\u64ad\u62a5\u544a'] });
  console.log('  ' + ((Date.now() - t) / 1000).toFixed(1) + 's  ok=' + d.ok + ' rows=' + (d.rows || []).length +
    ' cols=' + (d.columns || []).length);
  chk('D1 ok=true', d.ok === true);
  if (d.ok) {
    chk('D2 无报告列', (d.columns || []).indexOf(RPT) < 0);
    chk('D3 行数 703（全量）', (d.rows || []).length === 703, (d.rows || []).length);
    chk('D4 关键列还在', ['\u603b\u5206', 'c1\u4ea7\u54c1\u7406\u89e3', '\u4e3b\u64ad', '\u7b49\u7ea7'].every(function (k) {
      return (d.columns || []).indexOf(k) >= 0;
    }), (d.columns || []).join(','));
  }

  console.log('\n===== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})();
