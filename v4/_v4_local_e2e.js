// v4.9.0 本地化工作台端到端回归：单端口一体化服务（静态+判定同源）→ 真实语义评分
// 关键验证：页面从 127.0.0.1:8791 打开时【不手动设置 semantic_api_url】，
//          语义模块自动推导 location.origin + /semantic-judge 并完成真实语义判定
// 前置：node v4/_v4_local_server.js 8791 --noopen （已注入 Key）
// 用法：node v4/_v4_local_e2e.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/QwQ/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8791/v4/index.html';

const SRT = `1
00:00:12,000 --> 00:00:20,000
经常出差的朋友注意了，这个箱子非常适合你，不需要把整个箱子打开，站立状态直接就能快速拿取电脑，还保护隐私。

2
00:00:45,000 --> 00:00:58,000
20寸的只有4.2公斤，比两瓶矿泉水还轻，单手就能拎上高铁行李架。29寸的是4.9千克，112升的大容量。

3
00:01:30,000 --> 00:01:48,000
四层全新的PC材质，德国进口科思创，抗压性抗冲击性都比普通箱子更好，箱子虽然轻但特别坚韧，压不坏。

4
00:02:10,000 --> 00:02:28,000
360度静音万向轮，越负重越好推，赶高铁赶飞机的时候完全不会拖后腿，轮子顺滑到可以空箱滑行。

5
00:02:50,000 --> 00:03:05,000
里料是7A级抗菌和防渗水，99%的抗菌率，贴身衣物放心放，梅雨季也不怕里面受潮。

6
00:03:30,000 --> 00:03:55,000
你看这个前开盖，一按就弹出来了，给大家展示一下，电脑放在这个独立隔层，三个隔层收纳起来之后像一个大通仓，空间利用率很高。

7
00:04:20,000 --> 00:04:40,000
整箱360天换新，五年免费维修，售后完全不用操心。你一年两年才用一次的，我都不建议你买它，它给高频差旅的人准备的。

8
00:05:00,000 --> 00:05:15,000
高频差旅直接看20寸，家庭出行看29寸，确认好尺寸，拍二号链接，今天下单明天就能用上。`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // 关键：不设 semantic_api_url → 验证本地自动推导；只开语义开关 + 清历史数唯一性
  await page.evaluate(() => {
    localStorage.setItem('semantic_enabled', 'true');
    localStorage.removeItem('semantic_api_url');
    localStorage.removeItem('grading_history_v1');
  });
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(2000);

  // 0) 验证页面健康 + V4SEM + 推导出的判定地址（从语义模块请求侧取证）
  const probe = await page.evaluate(() => {
    const el = document.getElementById('semStatus');
    return {
      v4sem: typeof window.V4SEM === 'object',
      semStatusDom: !!el,
      origin: window.location.origin
    };
  });
  console.log('[0] 页面探针:', JSON.stringify(probe));

  // 1) 上传逐字稿 + 选品（合规文件名：主播_日期_直播间_原文）
  const srtPath = path.join(__dirname, '_曲姝锜_2026-09-03_轻熟质享客_原文.srt');
  fs.writeFileSync(srtPath, SRT, 'utf8');
  await page.setInputFiles('#fileInput', srtPath);
  await page.evaluate(() => {
    const sel = document.getElementById('productSelect');
    sel.value = 'pistachio_2';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);

  // 2) 触发评分
  await page.evaluate(() => { try { run(); } catch (e) { window.__runErr = String(e && e.message || e); } });
  const runErr = await page.evaluate(() => window.__runErr || '');
  if (runErr) console.log('[x] run() 抛错:', runErr);
  console.log('[1] 已触发评分，等待语义判定…（DeepSeek ~20s）');

  // 3) 轮询状态条（含降级判定）
  let status = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    await page.waitForTimeout(3000);
    status = await page.evaluate(() => {
      const el = document.getElementById('semStatus');
      return el && el.style.display !== 'none' ? el.textContent : '';
    }).catch(() => '');
    if (/评分完成：按【语义达标】判定/.test(status) || /已降级为关键词/.test(status) || /失败|异常/.test(status)) break;
    if (!/语义判定中/.test(status) && status) break;
  }

  // 4) 收集结果
  const result = await page.evaluate(() => {
    const histRaw = localStorage.getItem('grading_history_v1');
    let hist = [];
    try { hist = JSON.parse(histRaw || '[]'); } catch (e) {}
    const st = document.getElementById('semStatus');
    const resultBox = document.getElementById('result');
    return {
      status: st ? st.textContent : '(无状态条)',
      histCount: Array.isArray(hist) ? hist.length : 'parse-fail',
      histLast: Array.isArray(hist) && hist.length ? JSON.stringify(hist[hist.length - 1]).slice(0, 260) : '',
      resultLen: resultBox ? resultBox.textContent.length : 0
    };
  });

  console.log('=== 本地化工作台实测结果 ===');
  console.log('状态条:', result.status);
  console.log('历史记录数:', result.histCount, '(应为 1)');
  if (result.histLast) console.log('最近一条:', result.histLast);
  console.log('页面错误(' + errors.length + '):');
  errors.slice(0, 6).forEach(e => console.log('  ' + e));

  await page.evaluate(() => { location.hash = '#/daily'; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, '_v4local_shot_daily.png'), fullPage: true });
  console.log('截图已存 v4/_v4local_shot_daily.png');

  await browser.close();
  const pass = /评分完成：按【语义达标】判定/.test(result.status) && result.histCount === 1;
  console.log(pass ? '=== E2E PASS：语义判定 + 落库唯一 ===' : '=== E2E FAIL ===');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('本地化工作台实测异常:', e); process.exit(1); });
