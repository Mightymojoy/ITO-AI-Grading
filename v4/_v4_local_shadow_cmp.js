// v4.9.0 影子回归：08-20 真实录屏 多主播「语义版 vs 关键词版」双轨对照
// 目的：量化语义评分与关键词版分差，辅助判断是否需要调口径（满/半档/红旗/2.2 等）
// 用法：node v4/_v4_local_shadow_cmp.js
// 前置：node v4/_v4_local_server.js 8791 --noopen（已注入 DEEPSEEK_API_KEY）
// 输出：控制台 Markdown 对照表（同时落 v4/_shadow_report.md 入仓作历史快照）
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/QwQ/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8791/v4/index.html';
const SRT_BASE = 'D:/E盘文件/26年7月14日 更新存储路径/主播AI评分系统_开发/grading-v2/asr/tmp/batch_0820';
const STUDIO = '轻熟质享客';
const DATE = '2026-08-20';

const HOSTS = [
  { name: '任佳瑛', src: path.join(SRT_BASE, '任佳瑛', '任佳瑛.srt') },
  { name: '曲姝锜', src: path.join(SRT_BASE, '曲姝锜', '曲姝锜.srt') },
  { name: '毕政扬', src: path.join(SRT_BASE, '毕政扬', '毕政扬.srt') }
  // 王金鸽 08-20 缺 SRT，跳过
];

const MODES = [
  { key: 'kw',  label: '关键词版',  enabled: '0' },
  { key: 'sem', label: '语义版',    enabled: 'true' }
];

const results = [];   // [{ host, mode, total, c1, product, status, ms }]

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitSemStatus(page, wantDoneOrDegrade, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(2500);
    const st = await page.evaluate(() => {
      const el = document.getElementById('semStatus');
      return el && el.style.display !== 'none' ? el.textContent : '';
    }).catch(() => '');
    if (/评分完成：按【语义达标】判定/.test(st) || /已降级为关键词/.test(st) || /失败|异常/.test(st)) return st;
    if (!/语义判定中/.test(st) && st) return st;
  }
  return '(timeout)';
}

(async () => {
  // 预检
  for (const h of HOSTS) if (!fs.existsSync(h.src)) { console.error('SRT 缺:', h.src); process.exit(2); }

  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push('PAGEERR: ' + e.message));

  // 预热：先访问一次让脚本/V4SEM 就绪
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  for (const h of HOSTS) {
    // 复制改名到 v4（autoDetectMeta 期望 主播_日期_直播间_原文.srt）
    const dst = path.join(__dirname, `_${h.name}_${DATE}_${STUDIO}_原文.srt`);
    fs.copyFileSync(h.src, dst);

    for (const m of MODES) {
      const t0 = Date.now();

      // 重置 localStorage：开/关语义 + 清历史
      await page.evaluate((enabled) => {
        localStorage.setItem('semantic_enabled', enabled);
        localStorage.removeItem('semantic_api_url');           // 验证本地自动推导
        localStorage.removeItem('grading_history_v1');
      }, m.enabled);
      await page.reload({ waitUntil: 'load' }).catch(() => {});
      await sleep(1500);

      // 上传 + 选品 auto（自动识别产品）
      await page.setInputFiles('#fileInput', dst);
      await sleep(400);
      // productSelect 保持默认 'auto'
      await page.evaluate(() => { try { run(); } catch (e) { window.__runErr = String(e && e.message || e); } });

      // 等结果：语义版轮询状态条，关键词版直接等渲染完成
      let status = '';
      if (m.key === 'sem') {
        status = await waitSemStatus(page, true, 120000);
      } else {
        await sleep(2000);
        status = '(关键词版 · 同步)';
      }

      // 收集结果
      const rec = await page.evaluate(() => {
        const histRaw = localStorage.getItem('grading_history_v1');
        let hist = [];
        try { hist = JSON.parse(histRaw || '[]'); } catch (e) {}
        const st = document.getElementById('semStatus');
        return {
          status: st ? st.textContent : '',
          histCount: Array.isArray(hist) ? hist.length : 0,
          histLast: Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null
        };
      });

      const ms = Date.now() - t0;
      const row = {
        host: h.name,
        mode: m.key,
        modeLabel: m.label,
        total: rec.histLast ? rec.histLast.total : '-',
        c1: rec.histLast ? rec.histLast.c1Score : '-',
        product: rec.histLast ? rec.histLast.product : '-',
        status: status || rec.status || '(无状态)',
        ms
      };
      results.push(row);

      console.log(`[${h.name} · ${m.label}] ${row.total} 分 (c1=${row.c1}) · ${row.product} · ${ms}ms · ${row.status.slice(0, 60)}`);
    }

    // 单主播跑完两种模式后删副本
    try { fs.unlinkSync(dst); } catch (e) {}
  }

  await browser.close();

  // 输出对照表
  console.log('\n========== 08-20 影子回归 双轨对照 ==========');
  console.log('主播        关键词版        语义版          分差  c1差  识别产品');
  console.log('────────────────────────────────────────────────────────────');
  const byHost = {};
  results.forEach(r => { (byHost[r.host] = byHost[r.host] || {})[r.mode] = r; });
  for (const name of HOSTS.map(h => h.name)) {
    const k = byHost[name].kw, s = byHost[name].sem;
    const dT = (typeof k.total === 'number' && typeof s.total === 'number') ? (s.total - k.total) : '-';
    const dC = (typeof k.c1 === 'number' && typeof s.c1 === 'number') ? (s.c1 - k.c1) : '-';
    console.log(
      name.padEnd(10) +
      String(k.total).padEnd(8) + ' (' + String(k.c1).padEnd(2) + ')   ' +
      String(s.total).padEnd(8) + ' (' + String(s.c1).padEnd(2) + ')   ' +
      String(dT).padEnd(4) + '  ' + String(dC).padEnd(4) + '  ' +
      (s.product || '-').slice(0, 30)
    );
  }

  // 落 Markdown 报告
  let md = '# 08-20 影子回归 双轨对照（语义版 vs 关键词版）\n\n';
  md += '> 自动生成于 ' + new Date().toISOString() + ' · 本地工作台 v4.9.0\n\n';
  md += '## 对照表\n\n| 主播 | 关键词版 总分/c1 | 语义版 总分/c1 | 总分差 | c1差 | 自动识别产品 |\n|---|---|---|---|---|---|\n';
  for (const name of HOSTS.map(h => h.name)) {
    const k = byHost[name].kw, s = byHost[name].sem;
    const dT = (typeof k.total === 'number' && typeof s.total === 'number') ? (s.total - k.total) : '-';
    const dC = (typeof k.c1 === 'number' && typeof s.c1 === 'number') ? (s.c1 - k.c1) : '-';
    md += '| ' + name + ' | ' + k.total + ' / ' + k.c1 + ' | ' + s.total + ' / ' + s.c1 + ' | ' + dT + ' | ' + dC + ' | ' + (s.product || '-') + ' |\n';
  }
  md += '\n## 各模式状态条\n\n| 主播 | 模式 | 状态条 |\n|---|---|---|\n';
  results.forEach(r => { md += '| ' + r.host + ' | ' + r.modeLabel + ' | ' + (r.status || '').slice(0, 100) + ' |\n'; });
  md += '\n## 耗时\n\n| 主播 | 模式 | 耗时 |\n|---|---|---|\n';
  results.forEach(r => { md += '| ' + r.host + ' | ' + r.modeLabel + ' | ' + r.ms + 'ms |\n'; });
  fs.writeFileSync(path.join(__dirname, '_shadow_report.md'), md, 'utf8');
  console.log('\n报告已落 v4/_shadow_report.md');

  if (pageErrors.length) {
    console.log('\n页面错误(' + pageErrors.length + '):');
    pageErrors.slice(0, 5).forEach(e => console.log('  ' + e));
  }
})().catch(e => { console.error('影子回归异常:', e); process.exit(1); });
