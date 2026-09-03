// 批量证据注入诊断：dump details/summary/results 结构，定位 semEvBatchAttach 匹配失败点
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/QwQ/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8791/v4/index.html';
const SRC1 = 'D:/E盘文件/26年7月14日 更新存储路径/主播AI评分系统_开发/grading-v2/samples/2026.8.19-轻熟-曲姝锜-Truffle Pro_原文.srt';
const SRC2 = 'D:/E盘文件/26年7月14日 更新存储路径/主播AI评分系统_开发/grading-v2/samples/2026.8.18-综合-赵亚男_原文.srt';
const DST1 = path.join(__dirname, '_曲姝锜_2026-08-19_轻熟质享客_原文.srt');
const DST2 = path.join(__dirname, '_赵亚男_2026-08-18_综合_原文.srt');

(async () => {
  fs.copyFileSync(SRC1, DST1);
  fs.copyFileSync(SRC2, DST2);
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('semantic_enabled', 'true');
    localStorage.removeItem('semantic_api_url');
    localStorage.removeItem('grading_history_v1');
  });
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { location.hash = '#/batch'; });
  await page.waitForTimeout(600);
  await page.setInputFiles('#batchInput', [DST1, DST2]);
  await page.waitForTimeout(400);
  await page.evaluate(() => { try { batchRun(); } catch (e) { window.__be = String(e); } });

  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => {
      const all = window._v4LastBatchResults || [];
      return { n: all.length, done: all.filter(r => r && r.__semDone).length };
    }).catch(() => ({ n: 0, done: 0 }));
    if (st.n >= 2 && st.done >= 2) break;
  }
  await page.waitForTimeout(2500);

  const diag = await page.evaluate(() => {
    const out = {};
    const batch = document.getElementById('batchCompare');
    out.batchHTMLHead = batch ? batch.innerHTML.slice(0, 600) : '(no batchCompare)';
    out.detailsN = document.querySelectorAll('#batchCompare details').length;
    out.detailsInfo = Array.from(document.querySelectorAll('#batchCompare details')).map(d => {
      const sm = d.querySelector('summary');
      const b = sm ? sm.querySelector('b') : null;
      return {
        summary: sm ? (sm.textContent || '').slice(0, 70) : '(no summary)',
        bTxt: b ? b.textContent : '(no b)',
        stdN: d.querySelectorAll('.std').length,
        evLbN: d.querySelectorAll('.semEvLb').length,
        semEvTgN: d.querySelectorAll('.semEvTg').length
      };
    });
    out.results = (window._v4LastBatchResults || []).map(r => ({
      host: r.host, total: r.total, grade: r.grade, semDone: r.__semDone,
      semUsed: !!(r.__sem && r.__sem.used),
      judged: r.__sem ? r.__sem.judged : null
    }));
    // 每 details 解析 host+total 与 results 匹配情况
    out.matchTry = Array.from(document.querySelectorAll('#batchCompare details')).map((d, di) => {
      const sm = d.querySelector('summary');
      if (!sm) return { di, err: 'no summary' };
      const txt = sm.textContent || '';
      const host = String((txt.split('·')[0] || '')).trim();
      const b = sm.querySelector('b');
      const total = b ? parseFloat(String(b.textContent || '').replace(/[^0-9.-]/g, '')) : NaN;
      const hits = (window._v4LastBatchResults || []).map((r, i) => {
        const hSame = String(r.host || '').trim() === host;
        const tSame = isNaN(total) ? true : (Math.round(Number(r.total)) === total);
        return { i, hSame, tSame, both: hSame && tSame };
      });
      return { di, host, total: total, hits };
    });
    out.globalEvLb = document.querySelectorAll('.semEvLb').length;
    return out;
  });

  console.log('=== 诊断输出 ===');
  console.log('JS 错误:', errs.length);
  errs.forEach(e => console.log(' ', e));
  console.log('\n-- batchCompare HTML head --');
  console.log(diag.batchHTMLHead);
  console.log('\n-- details 数量:', diag.detailsN);
  diag.detailsInfo.forEach(d => console.log(JSON.stringify(d)));
  console.log('\n-- results --');
  diag.results.forEach(r => console.log(JSON.stringify(r)));
  console.log('\n-- matchTry --');
  diag.matchTry.forEach(m => console.log(JSON.stringify(m)));
  console.log('\n全文档 .semEvLb:', diag.globalEvLb);
  await browser.close();
  try { fs.unlinkSync(DST1); fs.unlinkSync(DST2); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('DIAG 异常:', e); process.exit(1); });
