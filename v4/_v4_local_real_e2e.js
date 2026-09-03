// v4.9.0 本地工作台 真实业务数据回归：08-20 基准录屏 SRT → 真实语义评分
// 用法：node v4/_v4_local_real_e2e.js <srt-源路径> <productKey: auto|truffle_2|...> [主播名] [日期] [直播间]
// 例：node v4/_v4_local_real_e2e.js "D:\...\曲姝锜\曲姝锜.srt" auto 曲姝锜 2026-08-20 轻熟质享客
// 前置：node v4/_v4_local_server.js 8791 --noopen （已注入 DEEPSEEK_API_KEY）
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/QwQ/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8791/v4/index.html';

const SRT_SRC = process.argv[2];
const PRODUCT = process.argv[3] || 'auto';
const HOST    = process.argv[4] || 'unknown';
const DATE    = process.argv[5] || '2026-08-20';
const STUDIO  = process.argv[6] || '轻熟质享客';
if (!SRT_SRC || !fs.existsSync(SRT_SRC)) { console.error('SRT 源不存在:', SRT_SRC); process.exit(2); }

(async () => {
  // 1) 复制 SRT 到 v4 目录并改名为 autoDetectMeta 可解析的「主播_日期_直播间_原文.srt」格式
  const dst = path.join(__dirname, `_${HOST}_${DATE}_${STUDIO}_原文.srt`);
  fs.copyFileSync(SRT_SRC, dst);
  const size = fs.statSync(dst).size;
  console.log('[1] SRT 已就位:', dst, '(' + size + ' bytes)');

  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('semantic_enabled', 'true');
    localStorage.removeItem('semantic_api_url');     // 验证本地自动推导
    localStorage.removeItem('grading_history_v1');   // 清历史数唯一性
  });
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(2000);

  // 2) 上传 + 选品（auto 时不显式选 productSelect，走自动识别）
  await page.setInputFiles('#fileInput', dst);
  if (PRODUCT !== 'auto') {
    await page.evaluate((v) => {
      const sel = document.getElementById('productSelect');
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
    }, PRODUCT);
  }
  await page.waitForTimeout(400);

  // 3) 触发评分
  await page.evaluate(() => { try { run(); } catch (e) { window.__runErr = String(e && e.message || e); } });
  const runErr = await page.evaluate(() => window.__runErr || '');
  if (runErr) console.log('[x] run() 抛错:', runErr);
  console.log('[2] 已触发评分，等待语义判定…（DeepSeek ~' + Math.round(size / 500) + 's）');

  // 4) 轮询状态条
  let status = '';
  const t0 = Date.now();
  const timeout = 120000;   // 08-20 真实 SRT 比样例长，给 2min
  while (Date.now() - t0 < timeout) {
    await page.waitForTimeout(3000);
    status = await page.evaluate(() => {
      const el = document.getElementById('semStatus');
      return el && el.style.display !== 'none' ? el.textContent : '';
    }).catch(() => '');
    if (/评分完成：按【语义达标】判定/.test(status) || /已降级为关键词/.test(status) || /失败|异常/.test(status)) break;
    if (!/语义判定中/.test(status) && status) break;
  }

  // 5) 收集结果
  const result = await page.evaluate(() => {
    const histRaw = localStorage.getItem('grading_history_v1');
    let hist = [];
    try { hist = JSON.parse(histRaw || '[]'); } catch (e) {}
    const st = document.getElementById('semStatus');
    const resultBox = document.getElementById('result');
    // 提取各卡分数（从结果区文本扫描）
    const txt = resultBox ? resultBox.textContent : '';
    return {
      status: st ? st.textContent : '(无状态条)',
      histCount: Array.isArray(hist) ? hist.length : 'parse-fail',
      histLast: Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null,
      resultSnippet: txt.slice(0, 400)
    };
  });

  console.log('\n=== 真实业务数据回归结果 ===');
  console.log('主播:', HOST, '| 直播间:', STUDIO, '| 日期:', DATE, '| 产品:', PRODUCT);
  console.log('状态条:', result.status);
  console.log('历史记录数:', result.histCount);
  if (result.histLast) {
    const h = result.histLast;
    console.log('本次评分: 总分=' + h.total + ' | c1=' + h.c1Score + ' | 等级=' + (h.grade || '-') + ' | 落库产品=' + h.product);
  }
  if (errors.length) {
    console.log('页面错误(' + errors.length + '):');
    errors.slice(0, 5).forEach(e => console.log('  ' + e));
  }

  await page.evaluate(() => { location.hash = '#/daily'; });
  await page.waitForTimeout(1500);
  const shot = path.join(__dirname, '_real_shot_daily.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log('截图已存', shot);

  await browser.close();

  // 清理副本（不入仓）
  try { fs.unlinkSync(dst); } catch (e) {}

  const pass = /评分完成：按【语义达标】判定/.test(result.status) && result.histCount === 1;
  console.log(pass ? '\n=== REAL E2E PASS ===' : '\n=== REAL E2E FAIL ===');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('真实回归异常:', e); process.exit(1); });
