// v4.9.2 判定依据展示 E2E：真实 SRT → 语义评分 → 断言每卡出现「查看判定依据」逐子点证据
// 用法：node v4/_v4_local_ev_e2e.js <srt-源路径> [主播名] [日期] [直播间]
// 前置：node v4/_v4_local_server.js 8791 --noopen（Key 从 sem_key_local.txt 注入）
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/QwQ/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8791/v4/index.html';

const SRT_SRC = process.argv[2];
const HOST   = process.argv[3] || '曲姝锜';
const DATE   = process.argv[4] || '2026-08-19';
const STUDIO = process.argv[5] || '轻熟质享客';
if (!SRT_SRC || !fs.existsSync(SRT_SRC)) { console.error('SRT 源不存在:', SRT_SRC); process.exit(2); }

(async () => {
  const dst = path.join(__dirname, `_${HOST}_${DATE}_${STUDIO}_原文.srt`);
  fs.copyFileSync(SRT_SRC, dst);
  console.log('[1] SRT 已就位:', dst, '(' + fs.statSync(dst).size + ' bytes)');

  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('semantic_enabled', 'true');
    localStorage.removeItem('semantic_api_url');
    localStorage.removeItem('grading_history_v1');
  });
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(2000);

  // 上传 + 触发评分
  await page.setInputFiles('#fileInput', dst);
  await page.waitForTimeout(400);
  await page.evaluate(() => { try { run(); } catch (e) { window.__runErr = String(e && e.message || e); } });
  const runErr = await page.evaluate(() => window.__runErr || '');
  if (runErr) console.log('[x] run() 抛错:', runErr);

  // 等语义完成
  let status = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await page.waitForTimeout(3000);
    status = await page.evaluate(() => {
      const el = document.getElementById('semStatus');
      return el && el.style.display !== 'none' ? el.textContent : '';
    }).catch(() => '');
    if (/评分完成：按【语义达标】判定/.test(status) || /已降级为关键词/.test(status)) break;
  }
  await page.waitForTimeout(1200);   // 等重渲染 + attach 落定

  // 断言：判定依据展开块
  const ev = await page.evaluate(() => {
    const cards = document.querySelectorAll('#modules .std');
    let semCards = 0, rows = 0, tagStats = {}, withQuote = 0, withReason = 0, samples = [];
    cards.forEach(card => {
      const lb = card.querySelector('.semEvLb');
      if (!lb) return;
      semCards++;
      const bd = card.querySelector('.semEvBd');
      const rws = bd ? bd.querySelectorAll('.semEvRow') : [];
      rws.forEach(r => {
        rows++;
        const tag = r.querySelector('.semEvTag');
        const t = tag ? tag.textContent.trim() : '?';
        tagStats[t] = (tagStats[t] || 0) + 1;
        const q = r.querySelector('.semEvQ');
        if (q && q.textContent.trim().length > 1) withQuote++;
        const rs = r.querySelector('.semEvRs');
        if (rs && rs.textContent.trim().length > 1) withReason++;
      });
      const stdId = card.querySelector('.std-id');
      const sc = card.querySelector('.sc');
      if (samples.length < 3) samples.push({ card: stdId ? stdId.textContent.trim() : '?', score: sc ? sc.textContent.trim() : '?', rows: rws.length });
    });
    const firstBd = document.querySelector('#modules .semEvBd');
    const firstSample = firstBd ? firstBd.textContent.replace(/\s+/g, ' ').slice(0, 220) : '';
    const statusEl = document.getElementById('semStatus');
    return {
      status: statusEl ? statusEl.textContent : '(无)',
      cardsTotal: cards.length, semCards, rows, tagStats, withQuote, withReason, samples, firstSample,
      total: (document.getElementById('score') || {}).textContent || ''
    };
  });

  console.log('\n=== 判定依据展示 E2E 结果 ===');
  console.log('主播:', HOST, '| 日期:', DATE, '| 直播间:', STUDIO);
  console.log('状态条:', ev.status);
  console.log('评分卡总数:', ev.cardsTotal, '| 带判定依据卡:', ev.semCards, '| 证据行合计:', ev.rows);
  console.log('徽标分布:', JSON.stringify(ev.tagStats));
  console.log('带原文引文行:', ev.withQuote, '| 带判定理由行:', ev.withReason);
  console.log('抽查卡:', JSON.stringify(ev.samples));
  console.log('首卡展开区示例:', ev.firstSample);
  if (errors.length) { console.log('页面错误(' + errors.length + '):'); errors.slice(0, 5).forEach(e => console.log('  ' + e)); }

  await page.evaluate(() => { location.hash = '#/daily'; });
  await page.waitForTimeout(1500);
  // 展开前两张卡的判定依据以便截图（checkbox checked 状态）
  await page.evaluate(() => {
    document.querySelectorAll('#modules .std').forEach((c, i) => {
      const tg = c.querySelector('.semEvTg');
      if (tg && i < 2) tg.checked = true;
    });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, '_ev_shot.png'), fullPage: true });
  await browser.close();
  try { fs.unlinkSync(dst); } catch (e) {}

  const pass = /评分完成：按【语义达标】判定/.test(ev.status)
    && ev.semCards >= 1 && ev.rows >= 5
    && (ev.tagStats['达标'] || 0) >= 1
    && ev.withQuote >= 1 && ev.withReason >= 1;
  console.log(pass ? '\n=== EV E2E PASS ===' : '\n=== EV E2E FAIL ===');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('E2E 异常:', e); process.exit(1); });
