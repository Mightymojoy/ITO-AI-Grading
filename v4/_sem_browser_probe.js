// v4.9.0 浏览器实测：打开 v4 页面 → 启用语义 → 探测评分入口与语义模块
// 用法：node v4/_sem_browser_probe.js
const path = require('path');
const { chromium } = require('C:/Users/QwQ/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8790/v4/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  // 1) 先设 localStorage（域名锁定 127.0.0.1:8790）
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('semantic_enabled', 'true');
    localStorage.setItem('semantic_api_url', 'http://127.0.0.1:8791/semantic-judge');
  });
  await page.reload({ waitUntil: 'load', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 2) 截图首页
  await page.screenshot({ path: path.join(__dirname, '_sem_shot_home.png'), fullPage: false });

  // 3) 探测关键全局
  const probe = await page.evaluate(() => {
    const has = n => typeof window[n] !== 'undefined';
    const fnNames = Object.keys(window).filter(k => /^(run|grade|batch|transcrib|render|pickTop1|collectProblems|addHistory|autoFill|buildReport)/i.test(k) && typeof window[k] === 'function');
    return {
      hasV4SEM: has('V4SEM'),
      hasRunGrading: has('runGrading'),
      hasRun: has('run'),
      semEnabled: (localStorage.getItem('semantic_enabled') || ''),
      apiUrl: (localStorage.getItem('semantic_api_url') || ''),
      v4shellLoaded: !!(window.V4SEM && window.runGrading && window.runGrading.__v49),
      fnNames: fnNames.slice(0, 40),
      errBar: (document.querySelector('[class*=err]') || {}).textContent ? 'YES' : 'no'
    };
  });
  console.log('=== 页面探测 ===');
  console.log(JSON.stringify(probe, null, 2));
  console.log('=== 页面错误(' + errors.length + ') ===');
  errors.slice(0, 8).forEach(e => console.log(e));

  await browser.close();
})().catch(e => { console.error('浏览器实测异常:', e); process.exit(1); });
