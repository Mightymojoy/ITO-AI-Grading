// 本地直调改后的 handler，12 并发打飞书，验证 1254607 重试是否生效。
// 判据：改前实测 2/12 成功；改后应显著提升，且日志里能看到重试记录。
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
// 加载 .env
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const handler = require(path.join(ROOT, 'api', 'feishu-read.js'));

function call(body) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const res = {
      statusCode: 0, _body: null,
      status(c) { this.statusCode = c; return this; },
      json(o) { this._body = o; resolve({ dt: (Date.now() - t0) / 1000, status: this.statusCode, body: o }); return this; },
      setHeader() {}, end(s) { resolve({ dt: (Date.now() - t0) / 1000, status: this.statusCode, body: s }); },
    };
    handler({ method: 'POST', body, headers: {} }, res)
      .catch(e => resolve({ dt: (Date.now() - t0) / 1000, status: 'EXC', body: { error: String(e && e.message || e) } }));
  });
}

const BODY = { action: 'records', key: 'daily', limit: 1200, omit: ['完整主播报告'], stop_at: 1 };

(async () => {
  console.log('=== 12 并发直调 handler（前端真实参数）===');
  console.log('本地直连飞书，与线上走同一段重试代码\n');
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 12 }, () => call(BODY)));
  const wall = (Date.now() - t0) / 1000;

  let ok = 0, retried = 0;
  rs.forEach((r, i) => {
    const b = r.body || {};
    if (b.ok) {
      ok++;
      const rows = (b.rows || []).length;
      console.log('  #' + String(i + 1).padStart(2) + ' ' + r.dt.toFixed(1) + 's  ✅ OK ' + rows + ' 行');
    } else {
      console.log('  #' + String(i + 1).padStart(2) + ' ' + r.dt.toFixed(1) + 's  ❌ ' + String(b.error || b).slice(0, 130));
    }
  });
  console.log('\n总墙钟 ' + wall.toFixed(1) + 's');
  console.log('===== 成功 ' + ok + '/12 =====');
  console.log(ok >= 10 ? '⇒ 重试生效（改前只有 2/12）' : '⇒ 重试不足，仍需前端兜底或加大重试');
  process.exit(ok >= 10 ? 0 : 1);
})();
