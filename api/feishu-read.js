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
 */
const https = require('https');

function httpsJson(opts, body){
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let d = '';
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

function normalizeRecord(rec){
  const out = {};
  const f = rec.fields || {};
  for(const k in f) out[k] = norm(f[k]);
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
    let rows = [], pageToken = '', guard = 0;
    do{
      const d = await listRecordsPage(token, tableId, Math.min(limit - rows.length, 500), pageToken, data.view_id || '');
      rows = rows.concat((d.items || []).map(normalizeRecord));
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
