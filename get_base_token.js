#!/usr/bin/env node
/**
 * 从飞书 wiki 链接反查多维表格 BASE_TOKEN（一次性工具）
 *
 * 用法：node get_base_token.js [wiki链接或wiki token]
 *   node get_base_token.js "https://my.feishu.cn/wiki/GQgowqCIcijjENk8Vl8c2OQVnvj?table=tblXXX"
 *   node get_base_token.js GQgowqCIcijjENk8Vl8c2OQVnvj
 *
 * 前置：应用需开通 wiki:node:read（或 wiki:wiki:readonly）权限并发布版本
 * 成功后把 base token 写回 .env 的 FEISHU_BASE_TOKEN
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------- 读 .env ----------
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && line.trim()[0] !== '#') out[m[1]] = m[2].trim();
  });
  return out;
}
function saveEnvKey(key, val) {
  const p = path.join(__dirname, '.env');
  let s = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const re = new RegExp('^' + key + '=.*$', 'm');
  if (re.test(s)) s = s.replace(re, key + '=' + val);
  else s = s.replace(/\s*$/, '') + '\n' + key + '=' + val + '\n';
  fs.writeFileSync(p, s);
}

const env = loadEnv();
const APP_ID = env.FEISHU_APP_ID || '';
const APP_SECRET = env.FEISHU_APP_SECRET || '';

function req(opt, body) {
  return new Promise(function (resolve, reject) {
    const r = https.request(opt, function (resp) {
      let d = '';
      resp.on('data', function (c) { d += c; });
      resp.on('end', function () {
        try { resolve({ code: resp.statusCode, json: JSON.parse(d), raw: d }); }
        catch (e) { resolve({ code: resp.statusCode, json: null, raw: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function getToken() {
  const r = await req({
    host: 'open.feishu.cn',
    path: '/open-apis/auth/v3/tenant_access_token/internal',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }));
  if (!r.json || r.json.code !== 0) throw new Error('获取 tenant_access_token 失败: ' + r.raw.slice(0, 200));
  return r.json.tenant_access_token;
}

async function main() {
  if (!APP_ID || !APP_SECRET) {
    console.error('[错误] .env 里缺少 FEISHU_APP_ID / FEISHU_APP_SECRET');
    process.exit(1);
  }
  const arg = process.argv[2] || '';
  if (!arg) {
    console.error('用法: node get_base_token.js <wiki链接或wiki token>');
    process.exit(1);
  }
  // 从链接里抠出 wiki token
  let wikiToken = arg.trim();
  const m = /\/wiki\/([A-Za-z0-9]+)/.exec(wikiToken);
  if (m) wikiToken = m[1];

  console.log('wiki token = ' + wikiToken);
  const tk = await getToken();
  console.log('tenant_access_token OK');

  const r = await req({
    host: 'open.feishu.cn',
    path: '/open-apis/wiki/v2/spaces/get_node?token=' + encodeURIComponent(wikiToken),
    method: 'GET',
    headers: { Authorization: 'Bearer ' + tk }
  });

  if (!r.json || r.json.code !== 0) {
    console.error('\n[失败] ' + (r.json ? ('code=' + r.json.code + ' ' + r.json.msg) : r.raw.slice(0, 300)));
    console.error('\n多半是应用还没开通 wiki 权限，或未发布版本。');
    console.error('开通后重试本命令即可。');
    process.exit(1);
  }

  const node = r.json.data && r.json.data.node;
  if (!node) { console.error('返回里没有 node: ' + r.raw.slice(0, 300)); process.exit(1); }

  console.log('\n节点类型 obj_type = ' + node.obj_type);
  console.log('节点标题 title    = ' + node.title);
  console.log('BASE_TOKEN        = ' + node.obj_token);

  if (node.obj_type !== 'bitable') {
    console.error('\n[注意] 这个 wiki 节点不是多维表格（obj_type=' + node.obj_type + '），obj_token 不是 base token。');
    process.exit(1);
  }

  saveEnvKey('FEISHU_BASE_TOKEN', node.obj_token);
  console.log('\n已写入 .env → FEISHU_BASE_TOKEN=' + node.obj_token);
  console.log('现在可以双击「同步飞书数据.bat」了。');
}

main().catch(function (e) { console.error('异常: ' + e.message); process.exit(1); });
