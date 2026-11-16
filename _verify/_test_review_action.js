/* v4.11.67 review action 直测：本地起 handler（不依赖 Vercel 部署），验证 4 列能取到。
 * 用法：node _verify/_test_review_action.js
 */
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..');

// 加载 .env（Vercel 环境变量在本地不存在）
const envPath = REPO + '/.env';
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const i = line.indexOf('=');
    if (i < 0) return;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  });
}
// 飞书必须直连（平台注入的代理会让飞书返 400）
process.env.NO_PROXY = '*';
process.env.HTTP_PROXY = '';
process.env.HTTPS_PROXY = '';
process.env.http_proxy = '';
process.env.https_proxy = '';

const handler = require(REPO + '/api/feishu-read.js');

function call(body) {
  return new Promise((resolve) => {
    const req = { method: 'POST', body: body, query: {} };
    let statusCode = 200;
    const res = {
      setHeader() {},
      status(c) { statusCode = c; return res; },
      json(o) { resolve({ status: statusCode, body: o }); return res; },
      end() { resolve({ status: statusCode, body: null }); return res; }
    };
    Promise.resolve(handler(req, res)).catch(e => resolve({ status: 500, body: { ok: false, error: String(e && e.message || e) } }));
  });
}

(async () => {
  console.log('=== 1. action=review 取 4 列 ===');
  const t0 = Date.now();
  const r = await call({ action: 'review' });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const b = r.body || {};
  console.log('HTTP', r.status, ' 耗时', dt + 's  ok=', b.ok, ' total_all=', b.total_all,
    ' table=', b.table_id, ' field_filtered=', b.field_filtered);
  if (!b.ok) { console.log('❌ 失败:', JSON.stringify(b).slice(0, 400)); process.exit(1); }

  const rows = b.rows || [];
  if (!rows.length) { console.log('❌ 无数据'); process.exit(1); }

  const sample = rows[0];
  console.log('   首行键:', Object.keys(sample).join(', '));
  const need = ['主播', '日期', '复核违规', '误判内容'];
  const miss = need.filter(k => !(k in sample));
  console.log('   4 列齐备:', miss.length === 0 ? '✅' : '❌ 缺 ' + miss.join(','));
  console.log('   样例:', JSON.stringify({
    主播: sample['主播'], 日期: sample['日期'],
    复核违规: sample['复核违规'],
    误判内容: String(sample['误判内容'] || '').slice(0, 60)
  }, null, 0));

  // 分布核对（应与直连飞书一致：否 321 / 是 111 / 空 67）
  const cnt = { 是: 0, 否: 0, 空: 0 };
  rows.forEach(x => {
    const v = String(x['复核违规'] || '').trim();
    if (v === '是') cnt.是++; else if (v === '否') cnt.否++; else cnt.空++;
  });
  console.log('\n=== 2. 复核结论分布 ===');
  console.log('   否(不违规)=%d  是(违规)=%d  空(未复核)=%d  合计=%d',
    cnt.否, cnt.是, cnt.空, rows.length);

  // 「误判内容」两类都要有内容
  const noWith = rows.filter(x => String(x['复核违规']).trim() === '否' && String(x['误判内容'] || '').trim()).length;
  const yesWith = rows.filter(x => String(x['复核违规']).trim() === '是' && String(x['误判内容'] || '').trim()).length;
  console.log('   复核=否 且误判内容非空:', noWith);
  console.log('   复核=是 且误判内容非空:', yesWith, '← 这类绝不能被当成误判');

  // 日期形态
  const dtSample = rows.slice(0, 3).map(x => x['日期']);
  console.log('\n=== 3. 日期字段形态 ===');
  console.log('   样例:', JSON.stringify(dtSample));
  const isNum = dtSample.every(v => typeof v === 'number' || /^\d{12,13}$/.test(String(v)));
  console.log('   是否毫秒时间戳:', isNum ? '是（前端需转换）' : '否（已是字符串）');
  if (isNum) {
    const one = Number(dtSample[0]);
    console.log('   转换示例:', new Date(one).toISOString().slice(0, 10));
  }

  const out = REPO + '/_verify/_review_action_sample.json';
  fs.writeFileSync(out, JSON.stringify({ total: rows.length, cnt, rows: rows.slice(0, 5) }, null, 1), 'utf8');
  console.log('\n样例已落盘:', out);
  console.log('\n✅ review action 可用');
})();
