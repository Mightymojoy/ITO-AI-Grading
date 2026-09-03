// v4.9.0 本地判定服务（浏览器实测用）：把 api/semantic-judge.js 挂到本地 http 端口
// 用法：DEEPSEEK_API_KEY=sk-xxx node v4/_sem_local_api.js [port]
const http = require('http');
const path = require('path');
const handler = require(path.join(__dirname, '..', 'api', 'semantic-judge.js'));
const port = Number(process.argv[2]) || 8791;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const fakeRes = {
      headers: {},
      setHeader(k, v){ this.headers[k] = v; try { res.setHeader(k, v); } catch(e){} },
      status(c){ this.code = c; return this; },
      json(o){
        const text = JSON.stringify(o);
        res.writeHead(this.code || 200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          ...this.headers
        });
        res.end(text);
      },
      end(){ res.writeHead(this.code || 200, { 'Access-Control-Allow-Origin': '*', ...this.headers }); res.end(); }
    };
    try {
      await handler({ method: req.method, body: body }, fakeRes);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log('[sem-local-api] listening on http://127.0.0.1:' + port + '/semantic-judge  key=' + (process.env.DEEPSEEK_API_KEY ? '已注入' : '缺失!'));
});
