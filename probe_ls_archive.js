/* ============================================================
 * probe_ls_archive.js —— 只读探针：确认存量存档是否还在浏览器里
 *
 * 做法：
 *   ① 把老大真实 Chrome profile 的 `Local Storage/leveldb` **复制**到临时 profile
 *      （原 profile 一个字节不动；Chrome 运行中按共享读复制是安全的）
 *   ② 用临时 profile 启动独立 Chrome（debug 端口），打开线上工作台同 origin
 *   ③ CDP 读 localStorage 的 grading_detail_v1 / grading_history_v1
 *   ④ 对比飞书导出的 183 场，统计命中率
 *
 * 只读：不写存档、不点按钮、不碰飞书。
 * ============================================================ */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const argv = process.argv.slice(2);
function arg(k, d) { const p = argv.find(a => a.startsWith('--' + k + '=')); return p ? p.slice(k.length + 3) : d; }

const HERE = __dirname;
const SRC_PROFILE = arg('src', path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default'));
const TMP = arg('tmp', path.join(HERE, '_tmp_profile_ls'));
const DBG = Number(arg('port', '9395'));
const URL_PAGE = arg('url', 'https://mightymojoy.github.io/ITO-AI-Grading/v4/index.html?lsprobe=1&t=' + Date.now());
const OUT = arg('out', path.join(HERE, '_probe_ls_archive.out.txt'));

const lines = [];
function P(s) { lines.push(s); console.log(s); }
function writeOut() { try { fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8'); } catch (e) {} }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getJson(u) {
  return new Promise((res, rej) => {
    const q = http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); });
    q.on('error', rej); q.setTimeout(8000, () => { q.destroy(new Error('timeout')); });
  });
}

function makeCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('WS error')));
  });
  ws.addEventListener('message', ev => {
    let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (d.id && pend.has(d.id)) { const { res, rej } = pend.get(d.id); pend.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); }
  });
  function cmd(method, params) {
    return new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  }
  return { cmd, ready, close: () => { try { ws.close(); } catch (e) {} } };
}

function findChrome() {
  const cands = [
    path.join(process.env['PROGRAMFILES'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return null;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0, bytes = 0;
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    const st = fs.statSync(s);
    if (!st.isFile()) continue;
    try { fs.copyFileSync(s, d); n++; bytes += st.size; } catch (e) { P('  拷贝失败 ' + f + ' : ' + e.message); }
  }
  return { n, bytes };
}

(async function main() {
  try {
    P('=== 存档只读探针 ===');
    P('源 profile: ' + SRC_PROFILE);
    const lsSrc = path.join(SRC_PROFILE, 'Local Storage');
    if (!fs.existsSync(lsSrc)) { P('❌ 源 Local Storage 不存在'); writeOut(); process.exit(2); }

    // ① 复制
    fs.rmSync(TMP, { recursive: true, force: true });
    const dst = path.join(TMP, 'Default', 'Local Storage');
    let total = { n: 0, bytes: 0 };
    for (const sub of fs.readdirSync(lsSrc)) {
      const sp = path.join(lsSrc, sub);
      if (fs.statSync(sp).isDirectory()) {
        const r = copyDir(sp, path.join(dst, sub));
        total.n += r.n; total.bytes += r.bytes;
      } else {
        fs.mkdirSync(dst, { recursive: true });
        fs.copyFileSync(sp, path.join(dst, sub));
        total.n++;
      }
    }
    P('✓ 已复制 ' + total.n + ' 个文件 / ' + (total.bytes / 1048576).toFixed(1) + ' MB → ' + TMP);

    // ② 启动 Chrome
    const CHROME = findChrome();
    if (!CHROME) { P('❌ 找不到 Chrome'); writeOut(); process.exit(2); }
    const args = [
      '--user-data-dir=' + TMP,
      '--remote-debugging-port=' + DBG,
      '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking',
      '--disable-features=Translate,MediaRouter', '--headless=new',
      '--window-size=1440,1000', URL_PAGE
    ];
    P('启动 Chrome (port ' + DBG + ') …');
    const ch = spawn(CHROME, args, { detached: false, stdio: 'ignore' });
    let wsUrl = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try {
        const t = await getJson('http://127.0.0.1:' + DBG + '/json/version');
        if (t && t.webSocketDebuggerUrl) { wsUrl = t.webSocketDebuggerUrl; break; }
      } catch (e) { }
    }
    if (!wsUrl) { P('❌ Chrome 未就绪'); try { ch.kill(); } catch (e) { } writeOut(); process.exit(3); }
    P('✓ Chrome 就绪');

    const cdp = makeCdp(wsUrl);
    await cdp.ready;
    await cdp.cmd('Target.setDiscoverTargets', { discover: true });
    // 新建页签
    const tgt = await cdp.cmd('Target.createTarget', { url: URL_PAGE });
    const tlist = await getJson('http://127.0.0.1:' + DBG + '/json/list');
    const page = tlist.find(t => t.id === tgt.targetId) || tlist.find(t => t.type === 'page');
    const pcdp = makeCdp(page.webSocketDebuggerUrl);
    await pcdp.ready;
    await pcdp.cmd('Runtime.enable');
    await pcdp.cmd('Page.enable');

    // 等页面就绪（要等 localStorage 可读，不依赖网络）
    let okReady = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const r = await pcdp.cmd('Runtime.evaluate', { expression: 'location.origin', returnByValue: true });
      const og = r && r.result && r.result.value;
      if (og && String(og).indexOf('http') === 0) { okReady = true; P('✓ 页面 origin = ' + og); break; }
    }
    if (!okReady) P('⚠ 页面 origin 未取到，继续尝试读 localStorage');

    const EXPR = `(function(){
      var out = {};
      try{
        var ls = window.localStorage;
        out.origin = location.origin;
        out.keys = Object.keys(ls).filter(function(k){ return /grading|v4/i.test(k); });
        var dh = ls.getItem('grading_detail_v1') || '[]';
        var hh = ls.getItem('grading_history_v1') || '[]';
        var d = null, h = null;
        try{ d = JSON.parse(dh); }catch(e){ out.detailErr = String(e); }
        try{ h = JSON.parse(hh); }catch(e){ out.histErr = String(e); }
        out.detailLen = dh.length;
        out.histLen = hh.length;
        out.detailN = d ? d.length : -1;
        out.histN = h ? h.length : -1;
        out.items = [];
        if(d && d.length){
          for(var i=0;i<d.length;i++){
            var x = d[i] || {};
            out.items.push({ ts: x.ts, host: x.host, date: String(x.date||''),
                             total: x.total, rawTotal: (typeof x.rawTotal==='number'?x.rawTotal:null),
                             hasRedline: !!x.redline,
                             sess: !!(x.redline && x.redline.sessionZero),
                             nReasons: (x.redline && x.redline.reasons ? x.redline.reasons.length : 0),
                             hasRev: !!(x.rlRevoked && x.rlRevoked.list && x.rlRevoked.list.length),
                             revN: (x.rlRevoked && x.rlRevoked.list ? x.rlRevoked.list.length : 0) });
          }
        }
      }catch(e){ out.fatal = String(e); }
      return JSON.stringify(out);
    })()`;

    const r2 = await pcdp.cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true });
    const val = r2 && r2.result && r2.result.value;
    if (!val) { P('❌ localStorage 读取失败'); try { ch.kill(); } catch (e) { } writeOut(); process.exit(4); }
    const data = JSON.parse(val);
    P('');
    P('=== localStorage 现状 ===');
    P('  origin        : ' + (data.origin || '?'));
    P('  相关键        : ' + JSON.stringify(data.keys));
    P('  detail 原始长度: ' + data.detailLen + '  → 解析 ' + data.detailN + ' 条');
    P('  history 原始长度: ' + data.histLen + ' → 解析 ' + data.histN + ' 条');
    if (data.detailErr) P('  ⚠ detail 解析错误: ' + data.detailErr);
    if (data.fatal) P('  ⚠ fatal: ' + data.fatal);

    // ③ 对比目标场次
    const inputs = JSON.parse(fs.readFileSync(path.join(HERE, '_bak', 'repair_inputs.json'), 'utf8'));
    const want = [];
    ['zero16', 'yes', 'pending93'].forEach(g => {
      (inputs[g] || []).forEach(r => {
        try { const o = JSON.parse(r.report); want.push({ g, date: r['date'], host: r['host'], ts: String(o.ts), v2: r['v2'] }); } catch (e) { }
      });
    });
    const have = new Map();
    (data.items || []).forEach(it => have.set(String(it.ts), it));
    P('');
    P('=== 183 场在存档中的命中情况 ===');
    let hit = 0; const missZero = [];
    want.forEach(w => {
      if (have.has(w.ts)) hit++;
      else if (w.g === 'zero16') missZero.push(w);
    });
    P('  命中 ' + hit + ' / ' + want.length);
    P('');
    P('=== zero16 逐场 ===');
    (inputs['zero16'] || []).forEach(r => {
      let ts = '';
      try { ts = String(JSON.parse(r.report).ts); } catch (e) { }
      const it = have.get(ts);
      if (it) {
        P('  ✓ ' + r['date'] + ' ' + r['host'] + '  total=' + it.total + ' rawTotal=' + (it.rawTotal === null ? '·' : it.rawTotal)
          + ' 红线=' + it.nReasons + '条  ' + (it.hasRev ? '已有撤销留痕' + it.revN : '无撤销'));
      } else {
        P('  ✗ ' + r['date'] + ' ' + r['host'] + '  存档中找不到 (ts=' + ts + ')');
      }
    });

    fs.writeFileSync(path.join(HERE, '_bak', 'ls_archive_probe.json'),
      JSON.stringify({ origin: data.origin, detailN: data.detailN, histN: data.histN, items: data.items }, null, 1), 'utf8');
    P('');
    P('落盘: _bak/ls_archive_probe.json');

    try { cdp.close(); } catch (e) { }
    try { pcdp.close(); } catch (e) { }
    try { ch.kill(); } catch (e) { }
    writeOut();
    process.exit(0);
  } catch (e) {
    P('❌ 异常: ' + (e && e.stack || e));
    writeOut();
    process.exit(9);
  }
})();
