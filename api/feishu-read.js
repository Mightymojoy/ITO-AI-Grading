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
 *   可选：view_id（指定视图）、limit（默认 300，上限 1200）
 * 返回：{ok:true, table:{table_id,name}, fields:['日期','主播',...], rows:[{日期:'…', …}], total:n, total_all:表内总数, limited:是否被截断}
 *
 * v4.11.64（2026-11-10）：飞书 `1254607 Data not ready` 退避重试 —— 这才是「数据不更新」的真根因。
 *   实测（11-10 10:20，线上接口 12 并发、前端真实参数）：**成功 2/12**，其余 10 次全部返回
 *   {"ok":false,"error":"拉取记录失败: Data not ready, please try again later code=1254607"}。
 *   1254607 = 飞书多维表格**公式字段正在全表重算**。日报 7 个公式列、历史 3 个，
 *   任何一次写入（评分 / 补算 / 去重）都会触发全表重算，窗口内读表必然报它。
 *   原实现对此**零重试** ⇒ 一次撞上就整条失败 ⇒ 前端回退 10-20 的静态快照。
 *   ⚠️ 这与「超时」「配置」「字段」全都无关 —— 所以「什么都没改也会坏」。
 *   处置：仅对可恢复错误（1254607 / 429 / 99991663 / 网络异常）退避重试 4 次（累计约 13.8 秒）；
 *        1254045（字段名错）与权限类错误**不重试**，避免把真正的配置问题拖成超时。
 * v4.11.63（2026-11-09）：两处健壮性收紧（都不改变默认输出的数据内容）。
 *   ① `field_names` 命中 `1254045 FieldNameNotFound` 时自动**去掉该参数重试一次**。
 *     起因：飞书对 field_names 严格校验——任一字段名不符就**整条请求拒绝**（实测：混入一个
 *       不存在的字段 3.5s 报 1254045；字段名差一个前导空格同样 1254045）。而字段名取自
 *       `/fields` 的 10 分钟缓存，缓存期内若有人改列名/删列，omit 就会让整条读取失败，
 *       前端随即静默回退静态快照 —— 等于把「偶发慢」换成「偶发全挂」，比不 omit 更糟。
 *   ② `stop_at` 提前停时如实回 `limited:true`。原实现提前停后 `total_all` 就等于已拉行数
 *       ⇒ `limited` 恒为 false ⇒ 前端把被截断的结果当全量，静默丢掉表尾。
 * v4.11.62（2026-11-09）：新增 omit / stop_at 两个可选参数（都不传时行为与 v4.11.52 完全一致）。
 *   omit    ：要剔除的字段名，字符串（逗号分隔）或数组。**既用 field_names 让飞书少传，
 *             也在服务端从结果里删掉**，两道保险。
 *   起因（2026-11-09 实测）：主播日报表 474 行里「完整主播报告」占 79%（753 万字 / 9.1MB），
 *     历史评分表 703 行里占 82%（927 万字 / 10.7MB）。前端 20 秒超时 ⇒ 必然/大概率失败
 *     ⇒ 静默回退静态快照（停在 2026-10-20）⇒「每周一数据不更新」的表象。
 *   ⚠️ 实测校正（别指望 omit 提速）：飞书 500 行**仅 2 字段**也要 29.8 秒，全字段 35.9 秒
 *     —— 因为表里有 7 个公式字段（日报）/ 3 个（历史），飞书读取时全表重算，与返回多少字段无关。
 *     omit 的价值是**把响应从 13.4MB 降到 0.96MB**（省传输/浏览器解析/DOM 体积），只省约 6 秒。
 *     提速必须靠「减少行数」+「前端超时放宽」，两者已在壳层配套（v4.11.62）。
 *   stop_at ：'1' 时「拉够 limit 条即停止翻页」。**只对「新记录在表头」的表安全**
 *             （日报表是 upsert 先删后建 ⇒ 头在前；历史评分表新记录在尾部 ⇒ 严禁使用）。
 * v4.11.52（2026-10-30）：修正「超限时丢最新记录」——改为拉全部分页后按日期保留最新 limit 条。
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

// v4.11.63（2026-11-09）：field_names 加 1254045 兜底 —— 不改的话 omit 可能比不 omit 更危险。
// 事故风险：飞书对 `field_names` 是**严格校验**，只要有一个字段名对不上就**整条请求拒绝**。
//   实测（2026-11-09 直连飞书）：
//     · 混入一个不存在的字段 → 3.5s  code=1254045 FieldNameNotFound
//     · 字段名差一个前导空格 → 5.8s  code=1254045 FieldNameNotFound
//   而字段名来自 `/fields` 的 **10 分钟缓存** ⇒ 这 10 分钟内若有人改字段名 / 删列 / 加列，
//   请求就会整条失败 ⇒ 前端静默回退静态快照 ⇒ 表现成「数据又不更新了」，与本轮要修的病一模一样。
// 处置：命中 1254045 时**自动去掉 field_names 重试一次**（服务端仍会剔除 omit 字段，结果等价）；
//   其它错误码照旧抛错。返回值带上 `fieldFiltered` 告诉调用方这次到底有没有走字段过滤。
// ---------- v4.11.64（2026-11-10）：飞书 1254607「Data not ready」重试 ----------
// 现场实测（2026-11-10 10:20，线上接口 12 并发，前端真实参数 omit+limit1200+stop_at）：
//   成功 2/12；其余 10 次全部返回
//   {"ok":false,"error":"拉取记录失败: Data not ready, please try again later code=1254607"}
// 这是飞书多维表格**公式字段正在全表重算**时的标准回应 —— 既不是配置错，也不是超时或权限问题。
// 主播日报有 7 个公式字段、历史评分 3 个，任何一次写入（评分 / 补算 / 去重）都会触发全表重算；
// 重算窗口内读表必然 1254607。而本文件原先**对它没有任何重试**，一次碰上就整条失败，
// 前端随即回退 data/daily.js 静态快照（停在 2026-10-20）⇒ 用户看到的就是「数据不更新」。
// 这解释了「什么设置都没改却坏了」：坏的从来不是设置，是**读出时机撞上重算窗口**。
// 处置：仅对可恢复错误退避重试（4 次，累计约 13.8 秒）；1254045 / 权限类错误一律不重试。
const RETRY_DELAYS = [800, 2000, 4000, 7000];
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function isRetryableCode(r){
  if(!r) return true;
  const c = Number(r.code);
  if(c === 1254607 || c === 429 || c === 99991663) return true;      // Data not ready / 限流 / 系统繁忙
  return /not ready|try again|too many request|rate limit|internal error/i.test(String(r.msg || ''));
}
async function httpsJsonRetry(opts, body, tag, maxRetry){
  const delays = (maxRetry === undefined) ? RETRY_DELAYS : RETRY_DELAYS.slice(0, maxRetry);
  let last = null;
  for(let i = 0; i <= delays.length; i++){
    let r = null, err = null;
    try{ r = await httpsJson(opts, body); }
    catch(e){ err = e; }
    if(!err && r && Number(r.code) === 0) return r;
    last = r || { code: -1, msg: (err && err.message) || String(err) };
    const retryable = err ? true : isRetryableCode(r);
    if(!retryable || i >= delays.length) return last;
    console.log('[feishu-read] ' + (tag || 'read') + ' code=' + last.code + ' ' +
                String(last.msg || '').slice(0, 60) + ' ⇒ 第 ' + (i + 1) + '/' + delays.length +
                ' 次重试（' + delays[i] + 'ms 后）');
    await sleep(delays[i]);
  }
  return last;
}

async function listRecordsPage(token, tableId, pageSize, pageToken, viewId, fieldNames){
  const base = '/open-apis/bitable/v1/apps/' + BASE_TOKEN + '/tables/' + tableId + '/records?page_size=' + pageSize
             + (viewId ? '&view_id=' + encodeURIComponent(viewId) : '')
             + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
  const headers = { 'Authorization': 'Bearer ' + token };

  if(fieldNames && fieldNames.length){
    let path2 = base;
    try{ path2 += '&field_names=' + encodeURIComponent(JSON.stringify(fieldNames)); }catch(e){}
    // 这个请求必须给足重试：1254607 是**表级锁定**，与请求内容无关，
    // 退回全字段同样会被拒，只是多传 12MB。宁可在这里等，也不要退化成全字段重来。
    const r = await httpsJsonRetry({ hostname:'open.feishu.cn', path: path2, method:'GET', headers: headers },
                                   null, 'fields-filter table=' + tableId);
    if(r.code === 0) return { d: r.data || {}, fieldFiltered: true };
    if(Number(r.code) !== 1254045){
      throw new Error('拉取记录失败: ' + (r.msg||'') + ' code=' + r.code);
    }
    console.log('[feishu-read] field_names 被拒（1254045 FieldNameNotFound，table=' + tableId +
                '）⇒ 已退回全字段重试，omit 改由服务端剔除');
  }

  const r2 = await httpsJsonRetry({ hostname:'open.feishu.cn', path: base, method:'GET', headers: headers },
                                  null, 'records table=' + tableId);
  if(r2.code !== 0) throw new Error('拉取记录失败: ' + (r2.msg||'') + ' code=' + r2.code);
  return { d: r2.data || {}, fieldFiltered: false };
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
// v4.11.62：顺带缓存「全部字段名」，供 omit 走 field_names
const DATE_FIELD_CACHE = Object.create(null);
const DATE_FIELD_TTL = 10 * 60 * 1000;

async function dateFieldsOf(token, tableId){
  const c = DATE_FIELD_CACHE[tableId];
  if(c && Date.now() < c.exp) return c.set;
  try{
    // 元数据只重试 1 次：它失败有降级（日期列按原值输出），不值得占掉十几秒 ——
    // 实测 12 并发时它自己先撞 1254607，等满 4 次（13.8s）才轮到真正读记录，白耗时间。
    const r = await httpsJsonRetry({
      hostname: 'open.feishu.cn',
      path: '/open-apis/bitable/v1/apps/' + BASE_TOKEN + '/tables/' + tableId + '/fields?page_size=100',
      method: 'GET', headers: { 'Authorization': 'Bearer ' + token }
    }, null, 'fields table=' + tableId, 1);
    if(r.code !== 0) throw new Error(r.msg || ('code=' + r.code));
    const set = Object.create(null);
    const all = [];
    ((r.data && r.data.items) || []).forEach(function(f){
      if(f.type === 5) set[f.field_name] = 1;
      if(f.field_name) all.push(f.field_name);
    });
    DATE_FIELD_CACHE[tableId] = { set: set, all: all, exp: Date.now() + DATE_FIELD_TTL };
    return set;
  }catch(e){
    // 取不到元数据时**保留原值**：宁可日期显示丑，也不能把数值字段误改成日期
    console.log('[feishu-read] 字段元数据读取失败（' + tableId + '）：' + ((e && e.message) || e) + ' ⇒ 日期列按原值输出');
    return Object.create(null);
  }
}

// v4.11.62：取不到字段清单时返回 [] ⇒ 调用方退回「服务端剔除」，结果仍然正确
async function allFieldsOf(token, tableId){
  const c = DATE_FIELD_CACHE[tableId];
  if(c && Date.now() < c.exp) return c.all || [];
  await dateFieldsOf(token, tableId);
  const c2 = DATE_FIELD_CACHE[tableId];
  return (c2 && c2.all) || [];
}

// v4.11.62：omit 参数归一化 —— 接受 '甲,乙' 或 ['甲','乙']，空值返回 null
function parseOmit(v){
  if(!v) return null;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const set = Object.create(null);
  let n = 0;
  arr.forEach(function(x){
    const s = String(x || '').trim();
    if(s){ set[s] = 1; n++; }
  });
  return n ? set : null;
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

    const limit = Math.min(parseInt(data.limit || '300', 10) || 300, 1200);
    const omitSet = parseOmit(data.omit);                        // v4.11.62
    const stopAt = String(data.stop_at || '') === '1';           // v4.11.62
    const dtf = await dateFieldsOf(token, tableId);   // type===5 字段名集合，见上方 msToDate 说明
    // v4.11.62：先算好要保留的字段名，让飞书**不返回**被 omit 的字段（拿不到清单则退回纯服务端剔除）
    let fieldNames = null;
    if(omitSet){
      const all = await allFieldsOf(token, tableId);
      if(all && all.length){
        const keep = all.filter(function(n){ return !omitSet[n]; });
        if(keep.length && keep.length < all.length) fieldNames = keep;
      }
    }
    let rows = [], pageToken = '', guard = 0, usedFieldFilter = false, stoppedEarly = false;
    do{
      const pg = await listRecordsPage(token, tableId, 500, pageToken, data.view_id || '', fieldNames);
      const d = pg.d;
      if(pg.fieldFiltered) usedFieldFilter = true;
      rows = rows.concat((d.items || []).map(function(rec){
        const o = normalizeRecord(rec, dtf);
        if(omitSet){ for(const k in omitSet){ if(k in o) delete o[k]; } }
        return o;
      }));
      pageToken = d.has_more ? (d.page_token || '') : '';
      guard++;
      // 拉够就停：**只对「新记录在表头」的表安全**（日报表先删后建 ⇒ 头在前）。
      // 历史评分表新记录在尾部，传 stop_at 会丢掉最新记录 —— 前端不得对该表使用。
      if(stopAt && rows.length >= limit){
        // v4.11.63：若还有下一页才叫「提前停」⇒ 必须如实报 limited，
        //   原实现此时 totalAll=rows.length ⇒ limited 恒 false ⇒ 前端以为拿全了，静默丢数据。
        if(pageToken) stoppedEarly = true;
        break;
      }
    }while(pageToken && guard < 20);                  // 20×500 = 1 万条护栏，防死循环

    // ---------- v4.11.52（2026-10-30）：超限时保留「最新」而不是「最早」 ----------
    // 事故：历史评分表 556 条、调用方传 limit=500 ⇒ 原实现返回**最早** 500 条，
    //   最新 56 条（10-26 后半 14 + 10-27/28/29 各 14）全部丢失，
    //   工作台「历史评分·归档索引」最新一天停在 10-26，而飞书里 10-29 数据齐全。
    // 根因：飞书 records 按**表格行顺序**返回，且两表方向相反 ——
    //   历史评分表新记录追加在**尾部**；日报表新记录在**头部**（upsert 先删后建）。
    //   原实现一律取头部 ⇒ 对历史评分表就是「越新的越先被丢」。
    // 处理：仅在超限时重排，未超限**保持原顺序**（对现有调用零影响）；
    //   排序键取 标准日期→日期→日报 归一化后的 YYYY-MM-DD，同日期保持原相对顺序（稳定）。
    const totalAll = rows.length;
    if(rows.length > limit){
      const dkey = function(r){
        var s = String(r['标准日期'] || r['日期'] || r['日报'] || '').slice(0, 10);
        var m = s.match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})/);
        return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : 0;
      };
      rows = rows.map(function(r, i){ return { r: r, i: i, k: dkey(r) }; })
                 .sort(function(a, b){ return a.k - b.k || a.i - b.i; })
                 .slice(-limit)
                 .map(function(x){ return x.r; });
    }

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
      columns: cols, rows: rows, total: rows.length, total_all: totalAll,
      // v4.11.63：提前停（stop_at 拉够 limit 但还有下一页）也必须报 limited=true，
      //   否则前端把「被截断的 500 条」当成全量 → 「以为看全了，其实少了最老的几十条」。
      limited: (totalAll > rows.length) || stoppedEarly,
      // v4.11.62/63：回显实际剔除的字段与是否真走了字段过滤，便于排查「为什么少了一列」
      omitted: omitSet ? Object.keys(omitSet) : [],
      fieldFiltered: usedFieldFilter
    });
  }catch(e){
    return res.status(200).json({ok:false, error: e.message});
  }
};
