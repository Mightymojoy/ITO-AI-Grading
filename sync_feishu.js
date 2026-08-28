#!/usr/bin/env node
/**
 * 主播评分系统 · 飞书数据本地同步（v4.5 新增，纯新增文件，不改任何存量逻辑）
 *
 * 作用：从飞书多维表格拉取全部数据表 → 生成静态数据文件到 v4/data/*.js
 *       工作台（v4）直接以 <script src> 载入这些文件，把飞书表格内嵌渲染出来，
 *       全程不跳转飞书、不依赖任何后端服务、本地 file:// 双击打开也可用。
 *
 * 用法：双击项目根目录的「同步飞书数据.bat」，或命令行 node sync_feishu.js [--limit=1000]
 * 凭证：项目根目录 .env（已在 .gitignore 中，不会进仓库）
 *
 *   FEISHU_APP_ID=cli_xxxxxxxx
 *   FEISHU_APP_SECRET=xxxxxxxx
 *   FEISHU_BASE_TOKEN=xxxxxxxx   （多维表格 token，飞书链接 /base/ 后面那一段）
 *
 * 说明：生成 .js 而不是 .json，是因为浏览器在 file:// 协议下会拦截 fetch/XHR（CORS），
 *       但 <script src> 不受限制——这样本地双击 index.html 也能看到表格。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'v4', 'data');

// ---------- 读取 .env ----------
function loadEnv(){
  const p = path.join(ROOT, '.env');
  if(!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  txt.split(/\r?\n/).forEach(function(line){
    if(!line || /^\s*#/.test(line)) return;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if(!m) return;
    const v = m[2].replace(/^['"]|['"]$/g, '').trim();
    if(!process.env[m[1]]) process.env[m[1]] = v;   // 已有环境变量优先（CI 场景）
  });
}
loadEnv();

const APP_ID     = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN || '';

// 侧边栏 7 个固定分类 → 表名关键字（按顺序命中第一个）
const NAME_KEYS = {
  daily:    ['主播日报'],
  top1:     ['TOP1', '多主播'],
  week:     ['周总结'],
  weekstar: ['明星'],
  month:    ['月总结'],
  reward:   ['激励'],
  punish:   ['惩罚']
};
const KEY_LABELS = {
  daily:'主播日报', top1:'多主播TOP1评分', week:'周总结', weekstar:'周总结-明星主播',
  month:'月总结', reward:'激励记录', punish:'惩罚记录'
};

function arg(name, dflt){
  const hit = process.argv.find(a => a.indexOf('--' + name + '=') === 0);
  return hit ? hit.split('=')[1] : dflt;
}
const LIMIT = Math.min(parseInt(arg('limit', '1000'), 10) || 1000, 5000);

// ---------- HTTPS ----------
function httpsJson(opts, body){
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try{ resolve(JSON.parse(d)); }catch(e){ reject(new Error('JSON 解析失败: ' + d.slice(0, 300))); } });
    });
    req.on('error', reject);
    if(body) req.write(body);
    req.end();
  });
}

let tokenCache = null, tokenExpires = 0;
async function getToken(){
  if(tokenCache && Date.now() < tokenExpires) return tokenCache;
  const body = JSON.stringify({app_id: APP_ID, app_secret: APP_SECRET});
  const r = await httpsJson({
    hostname: 'open.feishu.cn', path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST',
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body)}
  }, body);
  if(r.code !== 0) throw new Error('飞书鉴权失败：' + (r.msg || ('code=' + r.code)));
  tokenCache = r.tenant_access_token;
  tokenExpires = Date.now() + (r.expire - 120) * 1000;
  return tokenCache;
}

async function listTables(token){
  const r = await httpsJson({
    hostname: 'open.feishu.cn',
    path: '/open-apis/bitable/v1/apps/' + BASE_TOKEN + '/tables?page_size=100',
    method: 'GET', headers: {'Authorization': 'Bearer ' + token}
  });
  if(r.code !== 0) throw new Error('拉取表清单失败：' + (r.msg || '') + ' code=' + r.code);
  return (r.data && r.data.items || []).map(t => ({table_id: t.table_id, name: t.name}));
}

async function listRecordsPage(token, tableId, pageSize, pageToken){
  let p = '/open-apis/bitable/v1/apps/' + BASE_TOKEN + '/tables/' + tableId + '/records?page_size=' + pageSize;
  if(pageToken) p += '&page_token=' + encodeURIComponent(pageToken);
  const r = await httpsJson({
    hostname: 'open.feishu.cn', path: p,
    method: 'GET', headers: {'Authorization': 'Bearer ' + token}
  });
  if(r.code !== 0) throw new Error('拉取记录失败：' + (r.msg || '') + ' code=' + r.code);
  return r.data || {};
}

// 字段值归一化：人员/多选/附件/公式/日期 → 可显示字符串
function norm(v){
  if(v === null || v === undefined) return '';
  if(Array.isArray(v)){
    return v.map(function(x){
      if(x === null || x === undefined) return '';
      if(typeof x === 'object') return x.text || x.name || x.en_name || x.title || (typeof x.file_token === 'string' ? '[附件]' : '');
      return String(x);
    }).filter(Boolean).join('、');
  }
  if(typeof v === 'object') return v.text || v.name || v.en_name || v.title || '';
  return String(v);
}

async function fetchTable(token, tableId){
  let rows = [], pageToken = '', guard = 0;
  do{
    const d = await listRecordsPage(token, tableId, Math.min(LIMIT - rows.length, 500), pageToken);
    rows = rows.concat((d.items || []).map(function(rec){
      const out = {};
      const f = rec.fields || {};
      for(const k in f) out[k] = norm(f[k]);
      return out;
    }));
    pageToken = d.has_more ? (d.page_token || '') : '';
    guard++;
  }while(pageToken && rows.length < LIMIT && guard < 20);
  return {rows: rows, limited: rows.length >= LIMIT};
}

// 列并集（常用列优先靠前）
const PRIO = ['日期','主播','直播间','考核产品','综合评分','等级','产品知识能力','黄金话术','问题','激励','惩罚','周','月'];
function columnsOf(rows){
  const set = {};
  rows.forEach(r => Object.keys(r).forEach(k => { set[k] = 1; }));
  return Object.keys(set).sort(function(a, b){
    const ia = PRIO.indexOf(a), ib = PRIO.indexOf(b);
    if(ia >= 0 && ib >= 0) return ia - ib;
    if(ia >= 0) return -1;
    if(ib >= 0) return 1;
    return 0;
  });
}

function writeJs(key, obj){
  const json = JSON.stringify(obj).replace(/<\//g, '<\\/');  // 防止 </script> 提前闭合
  fs.writeFileSync(path.join(OUT, key + '.js'),
    'window.V4FS=window.V4FS||{};window.V4FS[' + JSON.stringify(key) + ']=' + json + ';\n', 'utf8');
}

(async function main(){
  console.log('════════════════════════════════════════════');
  console.log(' ITO 主播评分工作台 · 飞书数据同步 v4.5');
  console.log('════════════════════════════════════════════');

  if(!APP_ID || !APP_SECRET || !BASE_TOKEN){
    console.error('\n[错误] 缺少飞书凭证。\n');
    console.error('请在本文件同目录创建 .env（内容如下，等号后替换成你自己的值）：\n');
    console.error('  FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx');
    console.error('  FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx');
    console.error('  FEISHU_BASE_TOKEN=xxxxxxxxxxxxxxxx\n');
    console.error('说明：BASE_TOKEN 是多维表格链接 /base/ 后面那一段。');
    console.error('      .env 已在 .gitignore 中，不会进仓库。\n');
    process.exit(1);
  }

  if(!fs.existsSync(OUT)) fs.mkdirSync(OUT, {recursive: true});

  let token;
  try{
    token = await getToken();
    console.log('[1/4] 飞书鉴权成功');
  }catch(e){
    console.error('[失败] ' + e.message);
    process.exit(1);
  }

  let tables;
  try{
    tables = await listTables(token);
    console.log('[2/4] 发现数据表 ' + tables.length + ' 张');
  }catch(e){
    console.error('[失败] ' + e.message);
    process.exit(1);
  }

  const syncedAt = new Date().toLocaleString('zh-CN', {hour12: false});
  const index = {syncedAt: syncedAt, tables: []};
  const used = {};   // 已被 7 个固定分类占用的 table_id

  // ① 先处理侧边栏 7 个固定分类
  console.log('[3/4] 拉取数据…');
  for(const key in NAME_KEYS){
    const keys = NAME_KEYS[key];
    let hit = null;
    for(let i = 0; i < keys.length && !hit; i++){
      hit = tables.find(t => String(t.name || '').indexOf(keys[i]) >= 0 && !used[t.table_id]);
    }
    // 周总结 与 明星周总结 消歧
    if(key === 'week'){
      const wk = tables.find(t => String(t.name || '').indexOf('周总结') >= 0 && String(t.name || '').indexOf('明星') < 0);
      if(wk) hit = wk;
    }
    if(key === 'weekstar'){
      const st = tables.find(t => String(t.name || '').indexOf('明星') >= 0);
      if(st) hit = st;
    }
    if(!hit){
      console.log('   · ' + (KEY_LABELS[key] || key) + '：未找到匹配的表（跳过）');
      continue;
    }
    used[hit.table_id] = 1;
    try{
      const r = await fetchTable(token, hit.table_id);
      writeJs(key, {
        ok: true, key: key,
        table: {table_id: hit.table_id, name: hit.name},
        columns: columnsOf(r.rows), rows: r.rows,
        total: r.rows.length, limited: r.limited, syncedAt: syncedAt
      });
      index.tables.push({key: key, name: KEY_LABELS[key] || hit.name, table_id: hit.table_id, count: r.rows.length});
      console.log('   ✓ ' + (KEY_LABELS[key] || hit.name) + '：' + r.rows.length + ' 条' + (r.limited ? '（已达上限，可调 --limit）' : ''));
    }catch(e){
      console.log('   × ' + (KEY_LABELS[key] || hit.name) + '：' + e.message);
    }
  }

  // ② 其余发现的表一并同步（表选择器里可切）
  for(const t of tables){
    if(used[t.table_id]) continue;
    const key = 'tbl_' + t.table_id;
    try{
      const r = await fetchTable(token, t.table_id);
      writeJs(key, {
        ok: true, key: key,
        table: {table_id: t.table_id, name: t.name},
        columns: columnsOf(r.rows), rows: r.rows,
        total: r.rows.length, limited: r.limited, syncedAt: syncedAt
      });
      index.tables.push({key: key, name: t.name, table_id: t.table_id, count: r.rows.length});
      console.log('   ✓ ' + t.name + '（其余表）：' + r.rows.length + ' 条');
    }catch(e){
      console.log('   × ' + t.name + '：' + e.message);
    }
  }

  writeJs('_index', index);
  console.log('[4/4] 同步时间 ' + syncedAt);
  console.log('\n完成：共生成 ' + (index.tables.length + 1) + ' 个文件到 v4/data/');
  console.log('现在打开 v4/index.html（或线上工作台）→ 点左侧分类即可看到表格，不会跳转飞书。\n');
})().catch(function(e){
  console.error('[异常] ' + (e && e.message ? e.message : e));
  process.exit(1);
});
