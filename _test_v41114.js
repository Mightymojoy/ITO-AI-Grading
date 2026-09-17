/* v4.11.14 验证（D：版本号唯一真源 + A：云端兜底）
 * 真实 Chromium 打开本地 8791 工作台，断言界面版本号全部由 V4_VERSION 驱动。
 * 用法：NODE_PATH=<workspace>/node_modules node _test_v41114.js
 */
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const REPO = __dirname;
const PORT = 8911;
const CHROME = 'C:\\Users\\QwQ\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
const SHOT_DIR = path.join(REPO, '_v4验证截图');

const PASS = [], FAIL = [];
function check(name, cond, got) {
  (cond ? PASS : FAIL).push(name + (cond ? '' : '  ← 实得: ' + JSON.stringify(got)));
}
function waitReady(port, tries) {
  return new Promise((resolve, reject) => {
    let n = 0;
    (function tick() {
      const req = http.get({ host: '127.0.0.1', port, path: '/v4/index.html' }, res => { res.resume(); resolve(); });
      req.on('error', () => { if (++n > (tries || 40)) return reject(new Error('服务未就绪')); setTimeout(tick, 250); });
    })();
  });
}

(async () => {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const srv = spawn(process.execPath, ['v4/_v4_local_server.js', String(PORT), '--noopen'], { cwd: REPO, stdio: 'pipe' });
  let srvLog = '';
  srv.stdout.on('data', d => srvLog += d.toString());
  srv.stderr.on('data', d => srvLog += d.toString());

  let browser;
  try {
    await waitReady(PORT);
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto(`http://127.0.0.1:${PORT}/v4/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    // ---- 断言 1：常量本身 ----
    const ver = await page.evaluate(() => window.V4_VERSION);
    check('V4_VERSION 常量存在且为 v4.11.14', ver === 'v4.11.14', ver);

    // ---- 断言 2：三处界面版本号全部被运行时覆盖 ----
    const badge = (await page.textContent('#pageBadge') || '').trim();
    const brand = (await page.textContent('#brandVer') || '').trim();
    const foot = (await page.textContent('#footVer') || '').trim();
    check('#pageBadge = v4.11.14', badge === 'v4.11.14', badge);
    check('#brandVer = v4.11.14', brand === 'v4.11.14', brand);
    check('#footVer  = v4.11.14', foot === 'v4.11.14', foot);

    // ---- 断言 3：整页再无 v4.11.11 这种旧徽标残留（排除历史注释外的可见文本）----
    const bodyText = await page.evaluate(() => document.body.innerText);
    check('可见文本中不含 v4.11.11', bodyText.indexOf('v4.11.11') === -1,
      bodyText.split('\n').filter(l => l.indexOf('v4.11.11') !== -1).slice(0, 3));

    await page.screenshot({ path: path.join(SHOT_DIR, 'v41114_dashboard.png') });

    // ---- 断言 4：设置页「版本口径」也走同一个常量 ----
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForTimeout(900);
    const setv = await page.textContent('#set-versions') || '';
    check('设置页版本口径含 v4.11.14', setv.indexOf('v4.11.14') !== -1, setv.slice(0, 80));
    check('设置页版本口径不含 v4.11.13', setv.indexOf('v4.11.13') === -1, setv.slice(0, 80));
    await page.screenshot({ path: path.join(SHOT_DIR, 'v41114_settings.png') });

    // ---- 断言 5：没有未捕获 JS 异常 ----
    check('无未捕获 JS 异常', pageErrors.length === 0, pageErrors.slice(0, 3));

  } catch (e) {
    FAIL.push('执行异常: ' + e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
  }

  console.log('\n=== v4.11.14 验证结果 ===');
  PASS.forEach(p => console.log('PASS  ' + p));
  FAIL.forEach(f => console.log('FAIL  ' + f));
  console.log(`\n合计 ${PASS.length}/${PASS.length + FAIL.length} 通过`);
  console.log('\n--- 服务横幅 ---');
  console.log(srvLog.split('\n').filter(l => /DeepSeek|判定接口|工作台地址/.test(l)).join('\n'));
  process.exit(FAIL.length ? 1 : 0);
})();
