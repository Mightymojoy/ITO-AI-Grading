/**
 * 主播评分系统 · 云端飞书读取（Vercel Serverless）—— v4.4 新增（纯新增文件，不改任何现有接口）
 * 用途：把飞书多维表格的数据读进 v4 工作台，实现「飞书内容全量集合到工作台」
 * 凭证复用现有环境变量：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BASE_TOKEN
 * 表定位：优先环境变量（FEISHU_TBL_* / FEISHU_TABLE_ID），未配置时用「表名关键字」自动匹配
 *
 * 接口（POST）：
 *   {action:'tables'}                      → 列出该多维表格下所有表 [{table_id, name}]
 *   {action:'records', key:'daily'}         → 按逻辑键取记录（自动解析 table_id）
 *   {action:'records', table_id:'tblXXX'}   → 按表 ID 直接取记录
 *   可选：view_id（指定视图）、limit（默认 300，上限 1000）
 * 返回：{ok:true, table:{table_id,name}, fields:['日期','主播',...], rows:[{日期:'…', …}], total:n}
 *
 * v4.11.49（2026-10-21）：补齐 DateTime(type=5) 字段的毫秒 → 'YYYY-MM-DD' 转换。
 * 在此之前该字段原样 String() 输出，导致工作台「日期」列显示裸时间戳、月份分组全部落「未填」。
 * 判定按 GET /fields 的 type===5（不猜位数），口径与 sync_feishu.js / feishu-fill.js 一致。
 */
const https = require('https');

function httpsJson(opts, body){
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => d += c);
      res.on('end', () => { try{ resolve(JSON.parse(d)); }catch(e){ reject(new Error('JSON 解析失败: ' + d.slice(0,300))); } });
    });
    req.on('error', reject);
    if(body) req.write(body);
    req.end();
  });
}

const APP_ID = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const BASE_TOKEN = process.env.FEISHU_BASE_TOKEN || '';

// 逻辑键 → 环境变量表 ID（与 feishu-sync / feishu-week-month 保持一致）
const ENV_TBL = {
  daily:    process.env.FEISHU_TABLE_ID     || '',
  golden:   process.env.FEISHU_TBL_GOLDEN   || 'tbluc1Erb4b04PIb',
  problem:  process.env.FEISHU_TBL_PROBLEM  || 'tblORA9bSl8M63EO',
  case:     process.env.FEISHU_TBL_CASE     || '',
  history:  process.env.FEISHU_TBL_HISTORY  || 'tblkN1e6yCtXl5bG',
  top1:     process.env.FEISHU_TBL_TOP1     || '',
  week:     process.env.FEISHU_TBL_WEEK     || 'tbljvCsgMJF9efok',
  month:    process.env.FEISHU_TBL_MONTH    || 'tbl6LQrwRgnHcumu',
  detail:   process.env.FEISHU_TBL_DETAIL   || 'tblW366zZNF9QF06'
};

// 逻辑键 → 表名关键字（自动发现用，按顺序匹配第一个命中）
const NAME_KEYS = {
  daily:    ['主播日报'],
  top1:     ['TOP1', '多主播'],
  week:     ['周总结'],
  weekstar: ['明星'],
  month:    ['月总结'],
  reward:   ['激励'],
  punish:   ['惩罚'],
  golden:   ['黄金话术'],
  problem:  ['问题话术'],
  case:     ['优秀案例'],
  history:  ['历史评分']
};

let tokenCache = null, tokenExpires = 0;

async function getToken(){
  if(tokenCache && Date.now() < tokenExpires) return tokenCache;
  if(!APP_ID || !APP_SECRET) throw new Error('服务端未配置飞书凭证');
  const body = JSON.stringify({app_id: APP_ID, app_secret: APP_SECRET});
  const r = await httpsJson({
    hostname:'open.feishu.cn', path:'/open-apis/auth/v3/tenant_access_token/internal', method:'POST',
    headers:{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)}
  }, body);
  if(r.code !== 0) throw new Error('飞书鉴权失败: ' + (r.msg||''));
  tokenCache = r.tenant_access_token;
  tokenExpires = Date.now() + (r.expire - 60) * 1000;
  return tokenCache;
}

async function listTables(token){
  const r = await httpsJson({
    hostname:'open.feishu.cn',
    path:'/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables?page_size=100',
    method:'GET', headers:{'Authorization':'Bearer '+token}
  });
  if(r.code !== 0) throw new Error('拉取表清单失败: ' + (r.msg||'') + ' code=' + r.code);
  return (r.data && r.data.items || []).map(t => ({table_id: t.table_id, name: t.name}));
}

async function listRecordsPage(token, tableId, pageSize, pageToken, viewId){
  let path = '/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+tableId+'/records?page_size='+pageSize;
  if(viewId) path += '&view_id=' + encodeURIComponent(viewId);
  if(pageToken) path += '&page_token=' + encodeURIComponent(pageToken);
  const r = await httpsJson({
    hostname:'open.feishu.cn', path: path,
    method:'GET', headers:{'Authorization':'Bearer '+token}
  });
  if(r.code !== 0) throw new Error('拉取记录失败: ' + (r.msg||'') + ' code=' + r.code);
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

// ---------- v4.11.49：DateTime 字段统一转日期 ----------
// 起因（2026-10-21）：飞书「主播日报」等表的日期字段已被改成 **DateTime 类型**，
//   接口返回毫秒整数（例：1792425600000）。本文件原先一律走 norm() → String()，
//   于是工作台「日期」列显示裸时间戳，且 v4NormDate() 解析失败 ⇒ 月份/日期分组全部落入「未填」。
// 判定方式：`GET /fields` 取 `type===5` 的字段名后按**字段名精确匹配**，
//   **不猜"13 位数字"** —— 公式字段（type=20）同样可能返回整数，按位数猜会误伤。
// 转换口径与 sync_feishu.js / feishu-fill.js 完全一致：按北京时间（UTC+8）取 Y-M-D。
function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function msToDate(ms){
  const n = Number(ms);
  if(!isFinite(n)) return String(ms);
  const d = new Date(n + 8 * 3600 * 1000);           // 固定 +08:00，避免服务端时区（Vercel 为 UTC）漂移一天
  if(isNaN(d.getTime())) return String(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

// 字段元数据缓存（同一 serverless 实例内复用，避免每次取记录都多打一次 /fields）
const DATE_FIELD_CACHE = Object.create(null);
const DATE_FIELD_TTL = 10 * 60 * 1000;

async function dateFieldsOf(token, tableId){
  const c = DATE_FIELD_CACHE[tableId];
  if(c && Date.now() < c.exp) return c.set;
  try{
    const r = await httpsJson({
      hostname: 'open.feishu.cn',
      path: '/open-apis/bitable/v1/apps/' + BASE_TOKEN + '/tables/' + tableId + '/fields?page_size=100',
      method: 'GET', headers: { 'Authorization': 'Bearer ' + token }
    });
    if(r.code !== 0) throw new Error(r.msg || ('code=' + r.code));
    const set = Object.create(null);
    ((r.data && r.data.items) || []).forEach(function(f){ if(f.type === 5) set[f.field_name] = 1; });
    DATE_FIELD_CACHE[tableId] = { set: set, exp: Date.now() + DATE_FIELD_TTL };
    return set;
  }catch(e){
    // 取不到元数据时**保留原值**：宁可日期显示丑，也不能把数值字段误改成日期
    console.log('[feishu-read] 字段元数据读取失败（' + tableId + '）：' + ((e && e.message) || e) + ' ⇒ 日期列按原值输出');
    return Object.create(null);
  }
}

function normalizeRecord(rec, dtf){
  const out = {};
  const f = rec.fields || {};
  const dset = dtf || {};
  for(const k in f){
    out[k] = (dset[k] && f[k] !== null && f[k] !== undefined && f[k] !== '')
      ? msToDate(f[k])
      : norm(f[k]);
  }
  out.__record_id = rec.record_id || '';
  return out;
}

module.exports = async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS'){ res.status(200).end(); return; }

  const data = (req.method === 'POST') ? (req.body || {}) : (req.query || {});
  const action = data.action || 'records';

  try{
    if(!APP_ID || !APP_SECRET || !BASE_TOKEN){
      return res.status(200).json({ok:false, skipped:true, reason:'服务端未配置飞书凭证（FEISHU_APP_ID / APP_SECRET / BASE_TOKEN）'});
    }
    const token = await getToken();

    // ① 列出所有数据表（自动发现，供工作台表选择器用）
    if(action === 'tables'){
      const tables = await listTables(token);
      return res.status(200).json({ok:true, tables: tables});
    }

    // ② 取记录
    let tableId = data.table_id || '';
    let tableName = data.table_name || '';
    const key = data.key || '';

    if(!tableId && key && ENV_TBL[key]) tableId = ENV_TBL[key];

    if(!tableId && key && NAME_KEYS[key]){
      const tables = await listTables(token);
      const keys = NAME_KEYS[key];
      for(let i=0;i<keys.length;i++){
        const hit = tables.find(t => String(t.name || '').indexOf(keys[i]) >= 0);
        if(hit){ tableId = hit.table_id; tableName = hit.name; break; }
      }
      // 周总结 与 明星周总结 消歧：key=week 时排除含"明星"的表
      if(key === 'week'){
        const wk = tables.find(t => String(t.name||'').indexOf('周总结') >= 0 && String(t.name||'').indexOf('明星') < 0);
        if(wk){ tableId = wk.table_id; tableName = wk.name; }
      }
      if(!tableId) return res.status(200).json({ok:false, reason:'未找到表（key=' + key + '），可在设置页填入 table_id'});
    }

    if(!tableId) return res.status(200).json({ok:false, reason:'缺少 table_id 或 key'});

    const limit = Math.min(parseInt(data.limit || '300', 10) || 300, 1000);
    const dtf = await dateFieldsOf(token, tableId);   // type===5 字段名集合，见上方 msToDate 说明
    let rows = [], pageToken = '', guard = 0;
    do{
      const d = await listRecordsPage(token, tableId, Math.min(limit - rows.length, 500), pageToken, data.view_id || '');
      rows = rows.concat((d.items || []).map(function(rec){ return normalizeRecord(rec, dtf); }));
      pageToken = d.has_more ? (d.page_token || '') : '';
      guard++;
    }while(pageToken && rows.length < limit && guard < 10);

    // 列并集（优先常用列）
    const prio = ['日期','主播','直播间','考核产品','综合评分','等级','产品知识能力','黄金话术','问题','激励','惩罚','周','月'];
    const set = {};
    rows.forEach(r => Object.keys(r).forEach(k => { if(k !== '__record_id') set[k] = 1; }));
    const cols = Object.keys(set).sort(function(a,b){
      const ia = prio.indexOf(a), ib = prio.indexOf(b);
      if(ia >= 0 && ib >= 0) return ia - ib;
      if(ia >= 0) return -1;
      if(ib >= 0) return 1;
      return 0;
    });

    return res.status(200).json({
      ok:true, key: key || '', table:{table_id: tableId, name: tableName || tableId},
      columns: cols, rows: rows, total: rows.length, limited: rows.length >= limit
    });
  }catch(e){
    return res.status(200).json({ok:false, error: e.message});
  }
};
