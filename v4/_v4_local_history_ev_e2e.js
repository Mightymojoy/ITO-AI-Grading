// v4.10 历史 tab「完整评分记录」展开 E2E：真实 SRT → 语义评分 → 断言 grading_detail_v1 有明细
//  + 历史 tab 明细行可展开（checkbox → .v4his-det 模块分卡 + 逐子点证据）
// 用法：node v4/_v4_local_history_ev_e2e.js <srt-源路径> [主播名] [日期] [直播间]
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
    localStorage.removeItem('grading_detail_v1');
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
  await page.waitForTimeout(1200);   // 等重渲染 + 落库落定

  // 断言 1：grading_detail_v1 已落库（ts 关联 + 模块快照 + evs 证据）
  const lib = await page.evaluate(() => {
    const hist = JSON.parse(localStorage.getItem('grading_history_v1') || '[]');
    const dets = JSON.parse(localStorage.getItem('grading_detail_v1') || '[]');
    const det = dets.length ? dets[dets.length - 1] : null;
    let modN = 0, stdN = 0, evN = 0, firstMod = '', firstEv = '';
    if (det) {
      modN = (det.mods || []).length;
      for (let mi = 0; mi < (det.mods || []).length; mi++) {
        const m = det.mods[mi];
        if (!firstMod && m && m.name) firstMod = m.name;
        for (let si = 0; si < (m.stds || []).length; si++) {
          stdN++;
          const s = m.stds[si];
          if (s.sem && s.sem.evs) { evN += s.sem.evs.length; if (!firstEv && s.sem.evs[0]) firstEv = s.sem.evs[0].quote; }
        }
      }
    }
    const tsMatch = det && hist.length && String(hist[hist.length - 1].ts) === String(det.ts);
    return {
      histN: hist.length, detN: dets.length,
      lastHist: hist.length ? hist[hist.length - 1] : null,
      det: det ? { ts: det.ts, host: det.host, total: det.total, grade: det.grade, semUsed: det.semUsed } : null,
      tsMatch, modN, stdN, evN, firstMod, firstEv
    };
  });
  console.log('\n=== 历史明细落库断言 ===');
  console.log('摘要条数:', lib.histN, '| 明细条数:', lib.detN, '| ts 同源关联:', lib.tsMatch);
  console.log('明细:', JSON.stringify(lib.det));
  console.log('模块数:', lib.modN, '| 子标准数:', lib.stdN, '| 证据行数:', lib.evN);
  console.log('首模块:', lib.firstMod, '| 首证据:', String(lib.firstEv || '').slice(0, 60));

  // 切到历史 tab
  await page.evaluate(() => { location.hash = '#/history'; });
  await page.waitForTimeout(1500);

  // 断言 2：明细行渲染为可展开结构 + 点击后显示完整评分记录
  const htab = await page.evaluate(() => {
    const box = document.getElementById('v4arch-history');
    if (!box) return { found: false };
    const rows = box.querySelectorAll('.v4his-row');
    let tgN = 0, lbN = 0, withDetail = 0, withoutDetail = 0;
    rows.forEach(r => {
      if (r.querySelector('.v4his-tg')) tgN++;
      if (r.querySelector('.v4his-lb')) lbN++;
      const det = r.querySelector('.v4his-det');
      if (det) {
        const hasCard = !!det.querySelector('.v4his-none');
        if (hasCard) withoutDetail++; else withDetail++;
      }
    });
    // 点开第一行
    let opened = null;
    const first = rows[0];
    if (first) {
      const tg = first.querySelector('.v4his-tg');
      if (tg) tg.checked = true;
      const det = first.querySelector('.v4his-det');
      if (det) {
        opened = {
          visible: det.offsetHeight > 0,
          text: det.textContent.replace(/\s+/g, ' ').slice(0, 260),
          hasScore: /分/.test(det.textContent),
          hasEv: /达标|换说法|未讲到|讲错|存疑/.test(det.textContent),
          hasQuote: /「/.test(det.textContent)
        };
      }
    }
    return { found: true, rowN: rows.length, tgN, lbN, withDetail, withoutDetail, opened };
  });
  console.log('\n=== 历史 tab 展开断言 ===');
  console.log('容器找到:', htab.found, '| 明细行数:', htab.rowN, '| checkbox:', htab.tgN, '| label:', htab.lbN);
  console.log('含完整存档行:', htab.withDetail, '| 仅摘要行:', htab.withoutDetail);
  console.log('展开第一行:', JSON.stringify(htab.opened, null, 1));

  // 截图
  await page.evaluate(() => {
    document.querySelectorAll('.v4his-row').forEach((r, i) => {
      const tg = r.querySelector('.v4his-tg');
      if (tg && i === 0) tg.checked = true;
    });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, '_ev_history_shot.png'), fullPage: true });

  await browser.close();
  try { fs.unlinkSync(dst); } catch (e) {}

  const pass = /评分完成：按【语义达标】判定/.test(status)
    && lib.detN >= 1 && lib.tsMatch === true && lib.modN >= 3 && lib.stdN >= 10 && lib.evN >= 5
    && htab.found && htab.rowN >= 1 && htab.tgN >= 1 && htab.lbN >= 1
    && htab.withDetail >= 1
    && htab.opened && htab.opened.visible && htab.opened.hasScore && htab.opened.hasEv;
  console.log(pass ? '\n=== HISTORY EV E2E PASS ===' : '\n=== HISTORY EV E2E FAIL ===');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('E2E 异常:', e); process.exit(1); });
