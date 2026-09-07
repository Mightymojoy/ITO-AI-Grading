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
    if (/语义评分完成|关键词评分完成|已降级为关键词评分/.test(status) || /已降级为关键词/.test(status)) break;
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

  // 断言 3：v4.10.3 数据补存——头部概要（strength/problem/tagline/bestKey/worstKey）+ 模块 weight/weighted
  const v4103 = await page.evaluate(() => {
    const dets = JSON.parse(localStorage.getItem('grading_detail_v1') || '[]');
    if (!dets.length) return { ok: false, reason: 'no detail' };
    const d = dets[dets.length - 1];
    const mods = d.mods || [];
    let withWeight = 0, withWeighted = 0;
    for (let i = 0; i < mods.length; i++) {
      if (mods[i].weight != null) withWeight++;
      if (mods[i].weighted != null) withWeighted++;
    }
    return {
      ok: true,
      hasStrength: typeof d.strength === 'string' && d.strength.length > 0,
      hasProblem: typeof d.problem === 'string' && d.problem.length > 0,
      hasTagline: typeof d.tagline === 'string' && d.tagline.length > 0,
      hasBestKey: typeof d.bestKey === 'string' && d.bestKey.length > 0,
      hasWorstKey: typeof d.worstKey === 'string' && d.worstKey.length > 0,
      hasBestStdId: typeof d.bestStdId === 'string' && d.bestStdId.length > 0,
      hasWorstStdId: typeof d.worstStdId === 'string' && d.worstStdId.length > 0,
      modN: mods.length, withWeight, withWeighted,
      strength: d.strength, problem: d.problem, tagline: d.tagline,
      bestKey: d.bestKey, worstKey: d.worstKey
    };
  });
  console.log('\n=== v4.10.3 数据补存断言 ===');
  console.log(JSON.stringify(v4103, null, 2));

  // 断言 4：v4.10.3 渲染——展开可见头部概要 + 模块胶囊 + 子点三态徽标 + 命中/未命中分块
  const v4103Render = await page.evaluate(() => {
    const box = document.getElementById('v4arch-history');
    if (!box) return { found: false };
    const rows = box.querySelectorAll('.v4his-row');
    const first = rows[0];
    if (!first) return { found: true, rowN: 0 };
    const tg = first.querySelector('.v4his-tg');
    if (tg) tg.checked = true;
    const det = first.querySelector('.v4his-det');
    if (!det) return { found: true, hasDet: false };
    const txt = det.textContent;
    return {
      found: true, hasDet: true,
      visible: det.offsetHeight > 0,
      // 头部概要区（核心优势/核心问题/最优能力/最弱能力/一句话总评）
      hasStrength: txt.indexOf('核心优势') >= 0,
      hasProblem: txt.indexOf('核心问题') >= 0,
      hasBest: txt.indexOf('最优能力') >= 0,
      hasWorst: txt.indexOf('最弱能力') >= 0,
      hasTagline: txt.indexOf('一句话总评') >= 0,
      hasBigTotal: /^\s*(\d{1,3})\s/.test(det.innerHTML.slice(0, 200)) || /\b\d{2,3}<\//.test(det.innerHTML.slice(0, 500)),
      // 模块胶囊区——能力分大字号 + 加权 + 权重
      hasWeightChip: txt.indexOf('权重 ') >= 0,
      hasWeightedChip: txt.indexOf('加权 ') >= 0,
      hasNotCounted: txt.indexOf('不计入总分') >= 0,
      // 子点三态徽标
      hasCompleteChip: txt.indexOf('完成度 ') >= 0,
      hasQualityChip: txt.indexOf('质量 ') >= 0,
      hasStdScore: /分\s*<\/span>/.test(det.innerHTML) || /\d+\s*分/.test(txt),
      // 命中 / 未命中分块
      hasHitBlock: txt.indexOf('命中（') >= 0,
      hasMissBlock: txt.indexOf('未命中（') >= 0,
      // 评判标准原句
      hasCriteria: txt.indexOf('评判标准：') >= 0
    };
  });
  console.log('\n=== v4.10.3 渲染断言 ===');
  console.log(JSON.stringify(v4103Render, null, 2));

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

  const pass = /语义评分完成|关键词评分完成|已降级为关键词评分/.test(status)
    && lib.detN >= 1 && lib.tsMatch === true && lib.modN >= 3 && lib.stdN >= 10 && lib.evN >= 5
    && htab.found && htab.rowN >= 1 && htab.tgN >= 1 && htab.lbN >= 1
    && htab.withDetail >= 1
    && htab.opened && htab.opened.visible && htab.opened.hasScore && htab.opened.hasEv
    // v4.10.3 数据补存 + 渲染升级
    && v4103.ok && v4103.hasStrength && v4103.hasProblem && v4103.hasTagline
    && v4103.hasBestKey && v4103.hasWorstKey && v4103.hasBestStdId && v4103.hasWorstStdId
    && v4103.modN >= 3 && v4103.withWeight >= 3 && v4103.withWeighted >= 3
    && v4103Render.found && v4103Render.hasDet && v4103Render.visible
    && v4103Render.hasStrength && v4103Render.hasProblem && v4103Render.hasBest && v4103Render.hasWorst && v4103Render.hasTagline
    && v4103Render.hasWeightChip && v4103Render.hasWeightedChip && v4103Render.hasNotCounted
    && v4103Render.hasCompleteChip && v4103Render.hasQualityChip && v4103Render.hasStdScore
    && v4103Render.hasHitBlock && v4103Render.hasMissBlock && v4103Render.hasCriteria;
  console.log(pass ? '\n=== HISTORY EV E2E PASS ===' : '\n=== HISTORY EV E2E FAIL ===');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('E2E 异常:', e); process.exit(1); });
