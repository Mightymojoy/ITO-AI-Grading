// 验证 2026-09-17 清理后的三条链路：
//   A. 非本地（模拟线上）→ v4.11.9 拦截这次必须真的生效（此前是死代码，静默放行）
//   B. 本地 127.0.0.1 → 拦截不介入，转写功能原样保留
//   C. index.html 下发的脚本版本参数 = 4.11.14，三处版本徽标一致
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');

const REPO = process.cwd();
const PORT = '8951';
const CHROME = 'C:\\Users\\QwQ\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
const FAKE_HOST = 'ito-demo.local';   // 由 --host-resolver-rules 解析到 127.0.0.1

const results = [];
function chk(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ← ' + detail : ''}`);
}

(async () => {
  const srv = spawn(process.execPath, ['v4/_v4_local_server.js', PORT, '--noopen'], {
    cwd: REPO, stdio: 'pipe'
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', () => {});
  await new Promise(r => setTimeout(r, 4000));

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--no-proxy-server',
           `--host-resolver-rules=MAP ${FAKE_HOST} 127.0.0.1`]
  });

  async function probe(url, label) {
    const page = await browser.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    page.on('dialog', async d => { dialogs.push(d.message()); try { await d.accept(); } catch (e) {} });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    const info = await page.evaluate(() => {
      const badge = document.getElementById('pageBadge');
      const foot = document.getElementById('footVer');
      const btn = document.getElementById('visionAutoBtn');
      const j = window.V4Jobs;
      return {
        host: location.hostname,
        badge: badge ? badge.textContent.trim() : null,
        foot: foot ? foot.textContent.trim() : null,
        btnDisabled: btn ? !!btn.disabled : null,
        btnOpacity: btn ? btn.style.opacity : null,
        hasJobs: !!j,
        frSrc: (j && j.fullReport) ? String(j.fullReport) : null,
        trSrc: (j && j.transcribe) ? String(j.transcribe) : null,
      };
    });
    return { page, info, errors, dialogs };
  }

  // ================= A. 模拟线上 =================
  console.log('\n########## A. 非本地访问（Mock 线上 HTTPS 场景）##########');
  console.log(`  URL: http://${FAKE_HOST}:${PORT}/v4/index.html`);
  const A = await probe(`http://${FAKE_HOST}:${PORT}/v4/index.html`, 'A');
  console.log('  host =', A.info.host, ' badge =', A.info.badge, ' foot =', A.info.foot);
  chk('A1 页面加载成功（host 非 localhost）', A.info.host === FAKE_HOST, 'host=' + A.info.host);
  chk('A2 V4Jobs 已就绪', A.info.hasJobs === true);
  chk('A3 fullReport 已被替换为拦截函数', /cloud-blocked/.test(A.info.frSrc || ''), (A.info.frSrc || '').slice(0, 60));
  chk('A4 transcribe 已被替换为拦截函数', /cloud-blocked/.test(A.info.trSrc || ''), (A.info.trSrc || '').slice(0, 60));
  chk('A5 「一键完整日报」按钮已置灰', A.info.btnDisabled === true, 'opacity=' + A.info.btnOpacity);
  chk('A6 零未捕获异常', A.errors.length === 0, A.errors.join(' | ').slice(0, 160));

  // 真调用一次：被拦截应 reject('cloud-blocked-fullReport')，且不触发任何转写
  const callRes = await A.page.evaluate(async () => {
    try { await window.V4Jobs.fullReport(); return 'NO-REJECT'; }
    catch (e) { return 'rejected:' + (e && e.message); }
  });
  chk('A7 真调用被拒绝（不再静默放行）', callRes === 'rejected:cloud-blocked-fullReport', callRes);
  chk('A8 弹出了引导文案', A.dialogs.length > 0, '对话框数=' + A.dialogs.length);
  const guide = A.dialogs[0] || '';
  chk('A9 引导文案含换行（转义 bug 已修）', guide.includes('\n'), '行数=' + (guide.split('\n').length));
  chk('A10 文案不再错写 Mixed Content', !guide.includes('Mixed Content'), guide.slice(0, 48));
  chk('A11 文案指向真实原因/离线包', /本地网络访问|离线引擎包/.test(guide));
  await A.page.screenshot({ path: path.join(REPO, '_v4验证截图', 'v41115_mockcloud.png') });

  // ================= B. 本地模式 =================
  console.log('\n########## B. 本地 127.0.0.1（真实使用路径）##########');
  const B = await probe(`http://127.0.0.1:${PORT}/v4/index.html`, 'B');
  console.log('  host =', B.info.host, ' badge =', B.info.badge);
  chk('B1 host 为 127.0.0.1', B.info.host === '127.0.0.1');
  chk('B2 fullReport 未被拦截（原功能保留）', !/cloud-blocked/.test(B.info.frSrc || ''));
  chk('B3 transcribe 未被拦截（原功能保留）', !/cloud-blocked/.test(B.info.trSrc || ''));
  chk('B4 按钮未被置灰', B.info.btnDisabled === false, 'disabled=' + B.info.btnDisabled);
  chk('B5 零未捕获异常', B.errors.length === 0, B.errors.join(' | ').slice(0, 160));
  await B.page.screenshot({ path: path.join(REPO, '_v4验证截图', 'v41115_local.png') });

  // ================= C. 版本一致性 =================
  console.log('\n########## C. 版本号一致性 ##########');
  const html = await (await fetch(`http://127.0.0.1:${PORT}/v4/index.html`)).text();
  const vers = [...html.matchAll(/([\w\-.]+\.js)\?v=([\d.]+)/g)].map(m => m[1] + '?v=' + m[2]);
  console.log('  script 参数:', vers.join('  '));
  const V4ONLY = ['app-core.js','semantic-core.js','v4-shell.js','workflow.js'];
  const v4scripts = vers.filter(v => V4ONLY.some(n => v.startsWith(n)));
  chk('C1 四个 v4 脚本参数全为 4.11.14', v4scripts.every(v => v.endsWith('?v=4.11.14')), v4scripts.join(','));
  chk('C2 页面徽标 = v4.11.14', B.info.badge === 'v4.11.14', 'badge=' + B.info.badge);
  chk('C3 页脚版本 = v4.11.14', B.info.foot === 'v4.11.14', 'foot=' + B.info.foot);
  chk('C4 可见文本无 v4.11.11 残留', !html.includes('v4.11.11'));
  chk('C5 页面无 cloud-five-pi 残留', !html.includes('cloud-five-pi'));

  await browser.close();
  srv.kill();
  await new Promise(r => setTimeout(r, 800));

  const fail = results.filter(r => !r.pass);
  console.log('\n================ 汇总 ================');
  console.log(`  通过 ${results.length - fail.length} / ${results.length}`);
  if (fail.length) {
    console.log('  失败项：');
    fail.forEach(f => console.log('    ✗', f.name, '|', f.detail));
    process.exitCode = 1;
  } else {
    console.log('  全部通过 ✓');
  }
})();
