// =====================================================
// v4.9.0 本地化工作台一体化服务（静态托管 + 语义判定，同源单端口）
// 用法：node v4/_v4_local_server.js [port] [--noopen]
//   port    默认 8791
//   --noopen  不自动打开浏览器（自动化测试用）
// Key 来源：环境变量 DEEPSEEK_API_KEY 优先 → 仓库根 sem_key_local.txt（gitignore，绝不进仓库）
// 打开 http://127.0.0.1:8791/v4/index.html 即完整 v4.9.0 语义评分工作台
// 与云端差异：判定接口与页面同源（无 CORS）、Key 读本地文件；其余逻辑与线上 api/semantic-judge.js 完全一致
// =====================================================
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// v4.9.1：本地飞书写回端点 → 云端代理（同源接管，杜绝 3712 未启导致的主播日报漏写）
// 前端 app-core.js 在 host 为 127.0.0.1/localhost 时默认把 FEISHU_FILL_URL/SYNC_URL
// 指向 127.0.0.1:3712（v3 asr 端口）——本地一体化模式（8791）下 3712 未启则 fetch 静默失败。
// 本服务新增 /api/feishu-fill、/api/feishu-week-month、/api/feishu-sync 三条 POST 代理，
// 原样转发到云端 Vercel 函数（飞书凭据所在），页面请求与响应均同源，免跨域。
const CLOUD_HOST = 'ito-ai-grading.vercel.app';
const PROXY_PATHS = ['/api/feishu-fill', '/api/feishu-week-month', '/api/feishu-sync'];

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2]) || 8791;
const OPEN = !(process.argv[3] === '--noopen');
const KEYFILE = path.join(ROOT, 'sem_key_local.txt');

// ---- Key 注入：必须在 require(handler) 之前（其模块级 const 读取 env）----
if (!process.env.DEEPSEEK_API_KEY) {
  try {
    const k = fs.readFileSync(KEYFILE, 'utf8').trim();
    if (k) process.env.DEEPSEEK_API_KEY = k;
  } catch (e) { /* 文件不存在 → 走降级提示 */ }
}

const handler = require(path.join(__dirname, '..', 'api', 'semantic-judge.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.txt':  'text/plain; charset=utf-8',
  '.srt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2':'font/woff2'
};

function sendText(res, code, body, type) {
  try {
    res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  } catch (e) {}
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/v4/index.html' : urlPath;
  if (rel.indexOf('..') !== -1) return sendText(res, 403, 'forbidden');
  const abs = path.normalize(path.join(ROOT, rel));
  if (abs !== ROOT && abs.indexOf(ROOT + path.sep) !== 0) return sendText(res, 403, 'forbidden');
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return sendText(res, 404, '404 not found: ' + urlPath);
    fs.readFile(abs, (e2, buf) => {
      if (e2) return sendText(res, 500, 'read error');
      try { res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); } catch (e3) {}
      res.end(buf);
    });
  });
}

function routeJudge(req, res) {
  // Express 风格 res 适配层（api handler 依赖 setHeader/status/json/end）
  const fakeRes = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; try { res.setHeader(k, v); } catch (e) {} },
    status(c) { this.code = c; return this; },
    json(o) {
      const t = JSON.stringify(o);
      try { res.writeHead(this.code || 200, { 'Content-Type': 'application/json; charset=utf-8', ...this.headers }); } catch (e) {}
      res.end(t);
    },
    end() { try { res.writeHead(this.code || 200, { ...this.headers }); } catch (e) {} res.end(); }
  };
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    Promise.resolve(handler({ method: req.method, body: body }, fakeRes)).catch(e => {
      sendText(res, 500, JSON.stringify({ ok: false, error: String(e && e.message || e) }), 'application/json; charset=utf-8');
    });
  });
}

// ---- 飞书写回云端代理：POST body 原样转发 ito-ai-grading.vercel.app，响应原样回写 ----
function proxyToCloud(req, res, apiPath) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('error', e => sendText(res, 400, JSON.stringify({ ok:false, error:'请求读取失败: ' + e.message }), 'application/json; charset=utf-8'));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const opt = {
      hostname: CLOUD_HOST,
      port: 443,
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json; charset=utf-8',
        'Content-Length': body.length
      }
    };
    const pReq = https.request(opt, pRes => {
      const out = [];
      pRes.on('data', c => out.push(c));
      pRes.on('end', () => {
        const buf = Buffer.concat(out);
        try { res.writeHead(pRes.statusCode || 200, { 'Content-Type': pRes.headers['content-type'] || 'application/json; charset=utf-8' }); } catch (e) {}
        res.end(buf);
      });
    });
    pReq.on('error', e => sendText(res, 502, JSON.stringify({ ok:false, error:'云端代理不可达: ' + e.message }), 'application/json; charset=utf-8'));
    pReq.setTimeout(30000, () => { try { pReq.destroy(new Error('云端代理超时(30s)')); } catch (e) {} });
    pReq.end(body);
  });
}

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(String(req.url || '/').split('?')[0]); }
  catch (e) { return sendText(res, 400, 'bad url'); }
  if (urlPath === '/semantic-judge') return routeJudge(req, res);
  if (req.method === 'POST' && PROXY_PATHS.indexOf(urlPath) !== -1) return proxyToCloud(req, res, urlPath);
  if (req.method === 'POST') return sendText(res, 404, 'not found');
  serveStatic(req, res, urlPath);
});

// v4.11.10：绑定地址可配。默认 127.0.0.1（纯本机，最安全）；
// 设 BIND_HOST=0.0.0.0 可让局域网内其他设备（手机 / 同事电脑）连入。
const BIND = process.env.BIND_HOST || '127.0.0.1';
const SHOW_HOST = (BIND === '0.0.0.0' || BIND === '::') ? 'localhost' : BIND;
const BASE_URL = 'http://' + SHOW_HOST + ':' + PORT;

server.listen(PORT, BIND, () => {
  const hasKey = !!process.env.DEEPSEEK_API_KEY;
  const lines = [];
  lines.push('');
  lines.push('  ITO v4.9.0 本地化工作台 · 语义评分（关键词命中 → 文字语义达标）');
  lines.push('  ─────────────────────────────────────────────────────');
  lines.push('  工作台地址 : ' + BASE_URL + '/v4/index.html');
  lines.push('  判定接口   : ' + BASE_URL + '/semantic-judge（与页面同源，免跨域）');
  lines.push('  飞书写回   : /api/feishu-fill｜feishu-week-month｜feishu-sync → 云端代理（同源接管，无需 3712）');
  lines.push('  评分公式   : level × quality × 20（不动）；语义只覆写"判卷依据"');
  lines.push('  DeepSeek   : ' + (hasKey ? 'Key 已注入 ✓ 语义判定可用' : 'Key 未配置 ✗ 自动降级为关键词版'));
  lines.push('');
  lines.push('  首次配置 Key（一次性）：把 sk- 开头的 Key 存到文件');
  lines.push('    ' + KEYFILE);
  lines.push('    （已被 .gitignore 排除，绝不进仓库），重启本脚本即可');
  lines.push('  关闭本窗口 = 停止工作台');
  lines.push('');
  console.log(lines.join('\n'));
  if (OPEN) {
    // v4.11.10：跨平台打开浏览器（Windows: cmd start / macOS: open / Linux: xdg-open）
    const url = BASE_URL + '/v4/index.html';
    const openCmd = process.platform === 'win32' ? 'cmd /c start "" "' + url + '"'
                  : process.platform === 'darwin' ? 'open "' + url + '"'
                  : 'xdg-open "' + url + '"';
    setTimeout(() => { try { exec(openCmd); } catch (e) {} }, 600);
  }
});
