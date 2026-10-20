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

// ---------- v4.11.48 体积控制：「完整主播报告」一律只留前 400 字 ----------
// 起因（2026-10-20）：该多行文本列存的是完整评分 JSON，单条平均 **2.6 万字符**；
//   主播日报 226 条 ⇒ daily.js 从 17KB 涨到 5.4MB（占比 94.9%），历史评分表 7.4MB。
//
// 🔴 10-20 二次修订 —— 上一版「历史评分表必须保留全文」的判定**是错的**，已实测推翻：
//   ① `v4FsEnsure` 已被 v4.11.11 块接管为 `cloudEnsure()`（`fetchCloud` 走**飞书 API 实时拉取**），
//      历史 tab 展开详情用的 DET_MAP 来自那里，**与本地 data 快照无关**；
//   ② 本地快照里这一列**没有任何代码读取**（`window.V4FS['tbl_…']` 只在
//      「表浏览器」里按 `v4ExpandCell(v, 80)` 截断展示，无信息价值）。
//   ③ 保留全文的真实代价：7.4MB 文件 ⇒ base64 请求体 9.87MB，本机限速代理（≈24KB/s）
//      必然 `Errno 10054 远程主机强迫关闭` ⇒ **推送直接失败**（10-20 实测连挂两轮）。
//   ⇒ 现在所有表一律截断到 400 字，既保留"有没有报告 + 开头可读"的浏览价值，
//      又让历史表从 7.4MB 降到 ~0.5MB（推送可完成、线上加载快）。
const REPORT_FIELD = '完整主播报告';
const REPORT_KEEP_CHARS = 400;
const REPORT_CUT_TAIL = ' …（本地快照已截断，完整报告见飞书该列或「历史评分」页展开）';

function capReport(v){
  if(typeof v !== 'string' || v.length <= REPORT_KEEP_CHARS) return v;
  return v.slice(0, REPORT_KEEP_CHARS) + REPORT_CUT_TAIL;
}

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
// 🔴 v4.11.48 修正（2026-10-20）：原来 `d += c` 把每个 chunk 单独 toString ⇒ 多字节中文
//   一旦跨 chunk 边界就被切成两半、还原成 U+FFFD，**列名/正文出现 `产品���识(数值)` 这类乱码**
//   （226 条 × 18 表的响应必然跨界；旧版 29 条时恰好没命中，所以一直没暴露）。
//   正确姿势：收 Buffer，全部到齐后**一次性**解码。禁止回退成字符串累加。
function httpsJson(opts, body){
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        try{ resolve(JSON.parse(txt)); }catch(e){ reject(new Error('JSON 解析失败: ' + txt.slice(0, 300))); }
      });
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

// ---------- v4.11.48 新增：DateTime 字段毫秒 → YYYY-MM-DD ----------
// 起因（2026-10-20）：飞书「主播日报」的「日期」已改为 DateTime 类型，records 接口返回的是
//   **毫秒时间戳**（如 1760889600000）。norm() 会把它 String() 成 "1760889600000"，
//   工作台 v4NormDate 解析失败 ⇒ 月份/日期归档全部落进「未填」分组，整页看似没数据。
// 判定口径：**只按字段元数据**（GET /fields 的 type===5）精确匹配字段名，绝不靠"13 位数字"猜——
//   公式列/其他数值列将来也可能返回大整数，猜错会把分数变成日期。
function pad2(n){ return n < 10 ? '0' + n : String(n); }
function msToDate(ms){
  const n = Number(ms);
  if(!isFinite(n) || n <= 0) return String(ms);
  const d = new Date(n + 8 * 3600 * 1000);   // 统一按北京时间取日期（与 feishu-fill.js 写入口径一致）
  if(isNaN(d.getTime())) return String(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
async function dateFieldsOf(token, tableId){
  try{
    const r = await httpsJson({
      hostname: 'open.feishu.cn',
      path: '/open-apis/bitable/v1/apps/' + BASE_TOKEN + '/tables/' + tableId + '/fields?page_size=100',
      method: 'GET', headers: {'Authorization': 'Bearer ' + token}
    });
    if(r.code !== 0) throw new Error(r.msg || ('code=' + r.code));
    const set = {};
    ((r.data && r.data.items) || []).forEach(function(f){ if(f.type === 5) set[f.field_name] = 1; });
    return set;
  }catch(e){
    // 取不到字段元数据 ⇒ 退回原样（宁可日期丑，也不要静默把数值字段改成日期）
    console.log('   ! 字段元数据读取失败（' + tableId + '）：' + e.message + ' ⇒ 日期列按原值输出');
    return {};
  }
}

async function fetchTable(token, tableId){
  const dtf = await dateFieldsOf(token, tableId);
  let rows = [], pageToken = '', guard = 0;
  do{
    const d = await listRecordsPage(token, tableId, Math.min(LIMIT - rows.length, 500), pageToken);
    rows = rows.concat((d.items || []).map(function(rec){
      const out = {};
      const f = rec.fields || {};
      for(const k in f){
        if(k === REPORT_FIELD){                       // 体积控制，见文件头说明
          out[k] = capReport(norm(f[k]));
          continue;
        }
        out[k] = (dtf[k] && f[k] !== null && f[k] !== undefined) ? msToDate(f[k]) : norm(f[k]);
      }
      return out;
    }));
    pageToken = d.has_more ? (d.page_token || '') : '';
    guard++;
  }while(pageToken && rows.length < LIMIT && guard < 20);
  return {rows: rows, limited: rows.length >= LIMIT};
}

// 列并集（常用列优先靠前）
// v4.11.48：直播数据三列紧跟「直播间」（与飞书表列序一致，便于横向对照）
const PRIO = ['日期','主播','直播间','单小时GSV','观看成交率','时均UV','考核产品','综合评分','等级','产品知识能力','黄金话术','问题','激励','惩罚','周','月'];
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
