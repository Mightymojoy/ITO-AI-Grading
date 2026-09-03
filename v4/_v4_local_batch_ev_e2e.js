// v4.9.3 批量 TOP1 比较卡证据展示 E2E：2 份真实 SRT 全链路批量 → 断言 batchCompare 容器内 .std 卡有判定依据
// 用法：node v4/_v4_local_batch_ev_e2e.js
// 前置：node v4/_v4_local_server.js 8791 --noopen（Key 从 sem_key_local.txt 注入）
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/QwQ/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8791/v4/index.html';

// 2 份真实 SRT（合规命名）
const SRC1 = 'D:/E盘文件/26年7月14日 更新存储路径/主播AI评分系统_开发/grading-v2/samples/2026.8.19-轻熟-曲姝锜-Truffle Pro_原文.srt';
const SRC2 = 'D:/E盘文件/26年7月14日 更新存储路径/主播AI评分系统_开发/grading-v2/samples/2026.8.18-综合-赵亚男_原文.srt';
const DST1 = path.join(__dirname, '_曲姝锜_2026-08-19_轻熟质享客_原文.srt');
const DST2 = path.join(__dirname, '_赵亚男_2026-08-18_综合_原文.srt');

(async () => {
  fs.copyFileSync(SRC1, DST1);
  fs.copyFileSync(SRC2, DST2);
  console.log('[1] 已复制 2 份 SRT 到 v4/ 目录（合规命名）');

  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      const loc = m.location();
      errors.push('CONSOLE: ' + m.text().slice(0, 150) + (loc && loc.url ? ' @ ' + loc.url : ''));
    }
  });
  page.on('requestfailed', req => {
    errors.push('REQFAIL: ' + req.url() + ' · ' + (req.failure() ? req.failure().errorText : '?'));
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('semantic_enabled', 'true');
    localStorage.removeItem('semantic_api_url');
    localStorage.removeItem('grading_history_v1');
  });
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(2000);

  // 切到批量 TOP1 页
  await page.evaluate(() => { location.hash = '#/batch'; });
  await page.waitForTimeout(800);

  // 上传 2 份 SRT（multiple）
  await page.setInputFiles('#batchInput', [DST1, DST2]);
  await page.waitForTimeout(500);

  // 触发批量评分
  await page.evaluate(() => {
    try { batchRun(); } catch (e) { window.__batchErr = String(e && e.message || e); }
  });
  const batchErr = await page.evaluate(() => window.__batchErr || '');
  if (batchErr) console.log('[x] batchRun 抛错:', batchErr);
  console.log('[2] 已触发批量评分，等待 2 份 SRT 全部完成语义判定（~80s）…');

  // 等所有 r.__semDone + results.length === 2（通过 window._v4LastBatchResults 跟踪）
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 180000) {
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => {
      const all = window._v4LastBatchResults || [];
      if (all.length < 2) return { ok:false, n:all.length };
      const doneN = all.filter(r => r && r.__semDone).length;
      return { ok: doneN === 2, n: all.length, done: doneN };
    }).catch(() => ({ok:false, n:0}));
    if (st.ok) { ready = true; console.log('[3] 全部完成，results=' + st.n + ' done=' + st.done); break; }
  }
  if (!ready) { console.log('[x] 等待批量完成超时'); await browser.close(); process.exit(2); }

  await page.waitForTimeout(2000);   // 让 attachSemEvidence + renderBatchCompare 落定

  // 断言：批量比较卡内 .std 卡是否有判定依据 + v4.9.5 id 唯一性 + label for 精确匹配
  const ev = await page.evaluate(() => {
    const batch = document.getElementById('batchCompare');
    const all = document.querySelectorAll('.std');
    let inBatch = 0, evInBatch = 0, mismatchedLabel = 0;
    const idSet = new Set(), dupIds = [];
    all.forEach(c => {
      const inB = batch && batch.contains(c);
      if (inB) {
        inBatch++;
        const tg = c.querySelector('.semEvTg');
        const lb = c.querySelector('.semEvLb');
        if (tg && lb) {
          evInBatch++;
          const tid = tg.id || '';
          const lfor = lb.getAttribute('for') || '';
          if (tid !== lfor) mismatchedLabel++;        // v4.9.5：每卡 label for 必须等于自己 checkbox id（防批量同 id 错乱）
          if (tid) {
            if (idSet.has(tid)) dupIds.push(tid);
            else idSet.add(tid);
          }
        }
      }
    });
    return {
      batchDisplay: batch ? batch.style.display : '?',
      stdsTotal: all.length,
      stdsInBatch: inBatch,
      stdsWithEvidenceInBatch: evInBatch,
      mismatchedLabel: mismatchedLabel,
      dupIds: dupIds,
      batchVisible: batch && batch.offsetHeight > 0
    };
  });

  console.log('\n=== 批量 TOP1 证据展示 E2E 结果 ===');
  console.log('批量容器可见:', ev.batchVisible, '| display:', ev.batchDisplay);
  console.log('全文档 .std 卡总数:', ev.stdsTotal, '| 在 batchCompare 容器内:', ev.stdsInBatch);
  console.log('批量容器内带判定依据卡:', ev.stdsWithEvidenceInBatch, '/', ev.stdsInBatch);
  console.log('v4.9.5 id 唯一性: 重复 id =', ev.dupIds.length, ev.dupIds.length ? '[' + ev.dupIds.slice(0,3).join(',') + ']' : '');
  console.log('v4.9.5 label for 错配卡:', ev.mismatchedLabel);
  console.log('页面错误数:', errors.length);
  if (errors.length) errors.slice(0, 5).forEach(e => console.log('  ' + e));

  // 截图（先展开前 2 张卡）
  await page.evaluate(() => {
    document.querySelectorAll('#batchCompare .std').forEach((c, i) => {
      const tg = c.querySelector('.semEvTg');
      if (tg && i < 2) tg.checked = true;
    });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, '_ev_batch_shot.png'), fullPage: true });
  await browser.close();

  // 清理副本
  try { fs.unlinkSync(DST1); fs.unlinkSync(DST2); } catch (e) {}

  const pass = ev.batchVisible && ev.stdsInBatch >= 20
    && ev.stdsWithEvidenceInBatch >= 15
    && ev.stdsWithEvidenceInBatch === ev.stdsInBatch
    && ev.mismatchedLabel === 0
    && ev.dupIds.length === 0;
  console.log(pass ? '\n=== BATCH EV E2E PASS ===' : '\n=== BATCH EV E2E FAIL ===');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('E2E 异常:', e); process.exit(1); });