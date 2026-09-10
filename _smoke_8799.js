/* v4.11.11 本地工作台冒烟：同一进程内起服务 → 请求断言 → 关服务（不受代理/后台回收干扰） */
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8799;
const NODE = process.execPath;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function get(path) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: path, method: 'GET', timeout: 6000 }, res => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, body: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}
function post(path, payload) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload || {});
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: path, method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, body: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

(async function main() {
  const child = spawn(NODE, ['v4/_v4_local_server.js', String(PORT), '--noopen'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', c => { log += c.toString(); });
  child.stderr.on('data', c => { log += c.toString(); });

  // 等就绪
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    const r = await get('/v4/index.html');
    if (r.status === 200) { ready = true; break; }
  }

  console.log('\n=== 8799 本地工作台冒烟 ===');
  ok('服务启动并就绪', ready, ready ? '' : log.slice(0, 200));

  if (ready) {
    const idx = await get('/v4/index.html');
    ok('index.html 200', idx.status === 200, String(idx.status));
    ok('index.html 版本号 = 4.11.11', idx.body.indexOf('4.11.11') >= 0);
    ok('无 4.11.9 残留', idx.body.indexOf('4.11.9') < 0);

    const sh = await get('/v4/v4-shell.js?v=4.11.11');
    ok('v4-shell.js 200', sh.status === 200, String(sh.status));
    ok('v4-shell.js 含 v4.11.11 块', sh.body.indexOf('v4.11.11') >= 0);
    ok('v4-shell.js 含 feishu-read 端点', sh.body.indexOf('feishu-read') >= 0);
    ok('v4-shell.js 字节数合理', sh.body.length > 100000, 'len=' + sh.body.length);

    const ix = await get('/v4/data/_index.js');
    ok('data/_index.js 200（离线兜底仍可用）', ix.status === 200, String(ix.status));

    const judge = await post('/semantic-judge', {});
    ok('semantic-judge 接口存活', judge.status === 200, 'HTTP ' + judge.status);
  }

  child.kill();
  await new Promise(r => setTimeout(r, 400));
  try { child.kill('SIGKILL'); } catch (e) {}

  console.log('\n──────────────────────────────');
  console.log('结果: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
