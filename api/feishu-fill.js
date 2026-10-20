/**
 * 主播评分系统 · 云端飞书写回（Vercel Serverless）
 * 供部署版评分系统（GitHub Pages）调用：别人上传 SRT 评分后 → 结果写入飞书多维表格
 * 凭证走 Vercel 环境变量（FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BASE_TOKEN / FEISHU_TABLE_ID ...）
 * 部署：vercel --prod（在 cloud/ 目录）
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
const TABLE_ID = process.env.FEISHU_TABLE_ID || '';
const ATTACH_FIELD = process.env.FEISHU_ATTACH_FIELD || '视频附件';

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

// v4.11.47（2026-10-20）：改为**全量分页拉取**。
//   🔴 原实现写死 `page_size=200` 且不翻页 ⇒ 表内记录一旦超过 200 条，
//      尾部记录**永远匹配不到** ⇒ 那些场次每次重评都会被当成新场次 create ⇒ 重复行。
//      实测 2026-10-20 日报表已 221 条 ⇒ 已有 21 条处于盲区（这条与日期 bug 无关，独立隐患）。
//   顺带把 page_size 提到 500（飞书单页上限），往返次数最少。
async function listRecords(token){
  const all = [];
  let pageToken = '';
  for(let guard = 0; guard < 40; guard++){          // 40×500=2 万条，足够且防死循环
    const q = '/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+TABLE_ID
            + '/records?page_size=500' + (pageToken ? '&page_token='+encodeURIComponent(pageToken) : '');
    const r = await httpsJson({
      hostname:'open.feishu.cn', path:q, method:'GET', headers:{'Authorization':'Bearer '+token}
    });
    if(r.code !== 0) throw new Error('拉取记录失败: ' + (r.msg||''));
    const d = r.data || {};
    if(Array.isArray(d.items)) for(const it of d.items) all.push(it);
    if(!d.has_more) break;
    pageToken = d.page_token || '';
    if(!pageToken) break;
  }
  return all;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 飞书 DateTime 字段读写适配（v4.11.47 / 2026-10-20）
 *
 * 🔴 根因（2026-10-20 实测：只读勘察 + 假主键探针，表内记录数全程 221 条未变）：
 *    日报表「日期」= fldIf6huKp，type=5 DateTime，**读出来是毫秒 int、写进去必须是毫秒 int**。
 *      · POST {'日期':'2026-10-20'}        ⇒ code=1254064 DatetimeFieldConvFail（整条拒绝）
 *      · POST {'日期':1792425600000}       ⇒ code=0 成功
 *      · GET  返回 1792252800000（北京时间 0 点毫秒）
 *        ⇒ 旧代码 `String(v).slice(0,10)` 得到 '1792252800'，与 '2026-10-18' **永不相等**
 *        ⇒ matchAllRecords / matchRecord **恒返回空** ⇒ 每次评分都误判「记录不存在」
 *        ⇒ 走 create ⇒ 再撞 1254064 ⇒ 日报写入静默全挂（界面报「飞书自动建记录失败」）。
 *
 * ⚠️ 两个方向必须同时修，缺一不可：
 *    只修写入 ⇒ 匹配仍然失败 ⇒ 每次评分都**新建出一条重复记录**（比报错更糟）；
 *    只修匹配 ⇒ 匹配到了会走 PUT 救回来，但新场次建记录仍然 1254064。
 *
 * ⚠️ 时区口径：存量 221 条一律存「北京时间 0 点」的毫秒。读写都按 +08:00 折算，
 *    与存量形态完全一致（交叉核对：221/221 与飞书自算的「标准日期」公式字段相符）。
 *
 * ⚠️ 数据现状（2026-10-20 核查）：221 条 / 221 组（主播+日期），**0 重复**
 *    —— 因为匹配失败后 create 也失败，两条路同时堵死，所以没产生脏数据。
 *    最后一条成功记录是 2026-10-18；10-19、10-20 的评价全部写不进去。
 * ──────────────────────────────────────────────────────────────────────────── */
const CN_TZ_MS = 8 * 3600 * 1000;

// 'yyyy-MM-dd' / 'yyyy/MM/dd' / 'yyyy.MM.dd' → 北京时间当天 0 点的毫秒；非法返回 null
function dateToMs(s){
  const m = String(s == null ? '' : s).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if(!(y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return Date.UTC(y, mo - 1, d) - CN_TZ_MS;
}

// 毫秒（数字）→ 'yyyy-MM-dd'；字符串 → 截前 10 位（兼容万一回退成字符串的旧形态）
function msToDateStr(v){
  if(typeof v === 'number' && isFinite(v)){
    const d = new Date(v + CN_TZ_MS);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
  }
  return String(v == null ? '' : v).trim().slice(0,10);
}

// v4.11.8：同 host+date 可能滞留多条（历史 bug），全部找出
function matchAllRecords(records, host, date){
  if(!host || !date) return [];
  const target = msToDateStr(date);
  if(!target) return [];
  const out = [];
  for(const rec of records){
    const f = rec.fields || {};
    if(f['主播'] === host && msToDateStr(f['日期']) === target) out.push(rec);
  }
  return out;
}

async function deleteRecord(token, recordId){
  return httpsJson({
    hostname:'open.feishu.cn',
    path:'/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+TABLE_ID+'/records/'+recordId,
    method:'DELETE', headers:{'Authorization':'Bearer '+token}
  }, null);
}

function matchRecord(records, host, date){
  if(!host || !date) return null;
  const target = msToDateStr(date);
  if(!target) return null;
  for(const rec of records){
    const f = rec.fields || {};
    if(f['主播'] === host && msToDateStr(f['日期']) === target) return rec;
  }
  return null;
}

async function updateRecord(token, recordId, fields){
  const body = JSON.stringify({fields});
  return httpsJson({
    hostname:'open.feishu.cn',
    path:'/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+TABLE_ID+'/records/'+recordId,
    method:'PUT',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)}
  }, body);
}

async function createRecord(token, fields){
  const body = JSON.stringify({fields});
  return httpsJson({
    hostname:'open.feishu.cn',
    path:'/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+TABLE_ID+'/records',
    method:'POST',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)}
  }, body);
}

// v4.11.45（2026-10-15）：**附属列降级**（主数据优先）
//   实测结论（2026-10-15 · 真实记录 · 写入值 = 该字段当前值 ⇒ 对数据零影响）：
//   PUT 的 fields 里只要有一个字段名在表里不存在，飞书返回 code **1254045 FieldNameNotFound**
//   并**整条拒绝** —— 同一个请求里合法的「综合评分」「c1–c8」「完整主播报告」也一起写不进去。
//   （官方文档同口径：1254045「字段名称不存在…根据表格页面的 UI 名称可能会忽略空格、换行或特殊符号等差异」）
//   ⚠️ 而本版新增的两列是业务方**手工建**的，随时可能被改名 / 删除 ⇒ 绝不能让它把主数据拖下水。
//   策略：整条被拒且确实带了附属列时，**去掉附属列重试一次**，主数据优先，
//        并在响应里如实回报被丢掉的列（前端 toast 会看到原因，不会静默降级）。
const OPT_COLS = ['命中平台红线 —— 本场总分按 0 计', '已标注（不判 0 分）'];
function optColsIn(fields){
  return OPT_COLS.filter(function(k){ return Object.prototype.hasOwnProperty.call(fields, k); });
}
function dropOptCols(fields){
  const o = Object.assign({}, fields);
  OPT_COLS.forEach(function(k){ delete o[k]; });
  return o;
}

module.exports = async function handler(req, res){
  // CORS（GitHub Pages 跨域调用）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS'){ res.status(200).end(); return; }
  if(req.method !== 'POST'){ res.status(405).json({ok:false, error:'Method'}); return; }

  try{
    const data = req.body || {};
    const r = data.result || {};
    const host = data.host || r.host || '';
    const date = data.date || r.date || '';

    if(!APP_ID || !APP_SECRET || !BASE_TOKEN || !TABLE_ID){
      return res.status(200).json({ok:false, skipped:true, reason:'服务端未配置飞书凭证'});
    }
    if(!host || !date){
      return res.status(200).json({ok:false, skipped:true, reason:'缺少主播/日期'});
    }

    const token = await getToken();
    const records = await listRecords(token);
    const matches = matchAllRecords(records, host, date);
    // v4.11.8：同 host+date 滞留多条时只保留第 1 条 update，其余删除（防止历史 bug 累积重复）
    let rec = matches.length ? matches[0] : null;
    for(let mi = 1; mi < matches.length; mi++){
      try{ await deleteRecord(token, matches[mi].record_id); }catch(e){}
    }
    const removedDup = matches.length > 1 ? matches.length - 1 : 0;

    // 提取 c1-c5
    const c = {};
    (r.modules||[]).forEach(m => { c[m.key] = m.score; });

    let golden = '';
    if(r.golden && r.golden.items){
      golden = r.golden.items.filter(g => g.star >= 4).slice(0,5)
        .map(g => (g.ts?'['+g.ts+'] ':'') + (g.text||'').slice(0,100)).join(' | ');
      if(golden.length > 200) golden = golden.slice(0,200) + '...';
    }
    let bad = '';
    if(r.baseline && r.baseline.errors > 0 && r.baseline.errorsList){
      bad = r.baseline.errorsList.map(e => '['+(e.field||'')+'] '+(e.wrong||[]).join('/')).slice(0,3).join('; ');
    }

    // 改善建议（r.training ≤3 项聚合：低分能力 + 缺口 + 训练动作）
    let advice = '';
    if(r.training && r.training.length){
      advice = r.training.slice(0,3)
        .map(t => (t.mod||'') + ' ' + (t.score != null ? t.score + '分' : '') + '：' + (t.gap||'') + (t.action ? '（' + t.action + '）' : ''))
        .filter(s => s.trim() !== '：')
        .join('；');
      if(advice.length > 300) advice = advice.slice(0,300) + '...';
    }

    const baseFields = {
      '综合评分': String(r.total != null ? r.total : ''),
      '产品知识能力': String(c.c1 != null ? c.c1 : ''),
      '逻辑组织能力(流畅度)': String(c.c2 != null ? c.c2 : ''),
      '场景化表达能力(延展性)': String(c.c3 != null ? c.c3 : ''),
      '可视化道具运用': String(c.c4 != null ? c.c4 : ''),
      '情绪感染能力': String(c.c5 != null ? c.c5 : ''),
      '需求识别能力': String(c.c6 != null ? c.c6 : ''),
      '临场反应能力': String(c.c7 != null ? c.c7 : ''),
      '转化引导能力': String(c.c8 != null ? c.c8 : '')
    };
    if(golden) baseFields['黄金话术'] = golden;
    if(bad) baseFields['违规话术'] = bad;
    if(advice) baseFields['改善建议'] = advice;
    // v4.11.37：被判 0 分场次的「不计违规项综合评分」回写独立列。
    //   前端 v4.11.37 块在 publicResult 之前挂 result.rawScoreText（形如 `78.5（精确）` /
    //   `55.5（上限值）`；非判 0 场次不挂该键）。v4.11.38 起上限值已基本不再出现
    //   （存量记录也能精确复算），但格式与判定不变，此处无需改代码。
    //   ⚠️ 列名必须与飞书逐字一致（2026-10-14 实测 field_id=fldfcibJNi，类型=多行文本）：
    //      半角空格 1 个 + 半角连字符 1 个，改一个字就会静默写空。
    //   ⚠️ 仅在非空时写入：PUT 是部分更新，缺键不会清空既有值（与「改善建议」同策略）。
    if(r.rawScoreText) baseFields['未记录 违规-综合评分'] = String(r.rawScoreText);

    // v4.11.45（2026-10-15）：飞书日报表两列同步 ——「命中平台红线 —— 本场总分按 0 计」/「已标注（不判 0 分）」。
    //   前端 v4.11.45 块生成纯文本并挂 result.redlineText / result.annotText（与页面横幅同一份口径）。
    //   🔴 列名必须与飞书**逐字一致**（2026-10-15 实测：日报表第 27 / 28 个字段，类型均为多行文本）：
    //      「命中平台红线 —— 本场总分按 0 计」是「**按** 0 计」；「已标注（不判 0 分）」**没有 AI 前缀**。
    //      多行文本按列名匹配 ⇒ 写错一个字就是静默写空（与「未记录 违规-综合评分」同一个坑）。
    //   ⚠️ 判据用 `!== undefined` 而**不是**真值判断：前端会刻意传**空串**来清列
    //      （该场确知无命中 / 无标注时），用真值判断会让旧值永远清不掉；而老记录前端根本不挂键，
    //      PUT 是部分更新 ⇒ 缺键不会误清既有值。
    if(r.redlineText !== undefined) baseFields['命中平台红线 —— 本场总分按 0 计'] = String(r.redlineText);
    if(r.annotText  !== undefined) baseFields['已标注（不判 0 分）'] = String(r.annotText);
    // v4.11.24：完整主播报告（多行文本，官方单格上限 100,000）
    // 前端 v4.11.24 块将 v4DetailSnapshot() 压缩快照挂到 result.v4Report 传出。
    // ⚠️ 仅在非空时写入：PUT 是部分更新，缺键不会清空既有报告（重评时若无快照则保留旧值）。
    // ⚠️ 2026-09-23 修复：不 slice 盲截 —— 截断会切出非法 JSON，读取侧解析失败 ⇒ 记录永远展不开。
    //    超限则本条不写该字段（其余字段照常写入），并回报原因。
    let repSkip = null;
    if(r.v4Report){
      const rep = String(r.v4Report);
      if(rep.length > 95000){
        repSkip = rep.length + ' 字符超上限（>95000），本条未写「完整主播报告」';
        console.warn('[feishu-fill] ' + repSkip + ' | ' + host + ' ' + date);
      } else {
        baseFields['完整主播报告'] = rep;
      }
    }

    // 匹配不到 → 自动创建记录（评分结果自动写入飞书的完整闭环）
    if(!rec){
      // v4.11.47：日期必须写**毫秒**（字符串 ⇒ 1254064 整条拒绝，见文件前部根因注释）。
      //   转不出毫秒 ⇒ **拒绝创建**而不是闷头建一条「日期为空」的记录：
      //   那样的记录下次仍然匹配不到 ⇒ 每次评分都会再新建一条 ⇒ 重复数据比报错更糟
      //   （「宁可不动」：宁可这条写不进去、把原因报给前端，也不制造脏行）。
      const dMs = dateToMs(date);
      if(dMs == null){
        return res.status(200).json({ok:false, skipped:true,
          reason:'日期无法解析为有效日期（' + String(date) + '），本条未创建飞书记录'});
      }
      const createFields = Object.assign({}, baseFields, {
        '主播': host,
        '日期': dMs
      });
      if(data.studio) createFields['直播间'] = data.studio;
      let finalCreate = createFields, optDroppedC = [];
      let cr = await createRecord(token, finalCreate);
      if(cr.code === 1254045 && optColsIn(finalCreate).length){
        // v4.11.45：附属列在表里不存在 ⇒ 丢列重试。否则**新记录根本建不出来**，比丢一列严重得多。
        optDroppedC = optColsIn(finalCreate);
        finalCreate = dropOptCols(finalCreate);
        cr = await createRecord(token, finalCreate);
      }
      if(cr.code !== 0){
        return res.status(200).json({ok:false, reason:'飞书自动建记录失败: '+(cr.msg||'')+' code='+cr.code});
      }
      const newRec = cr.data && cr.data.record;
      const createOut = {ok:true, created:true, recordId: newRec ? newRec.record_id : '', host, date, total: r.total, fieldsWritten: Object.keys(finalCreate).length, removedDup};
      if(optDroppedC.length) createOut.optColsDropped = optDroppedC;
      return res.status(200).json(Object.assign(createOut, repSkip ? {reportSkipped: repSkip} : {}));
    }

    const fields = Object.assign({}, baseFields);
    if(data.studio && !rec.fields['直播间']) fields['直播间'] = data.studio;

    let finalFields = fields, optDropped = [];
    let up = await updateRecord(token, rec.record_id, finalFields);
    if(up.code === 1254045 && optColsIn(finalFields).length){
      // v4.11.45：附属列被改名/删除 ⇒ 丢列重试一次，保证综合评分等主数据仍然写得进去。
      optDropped = optColsIn(finalFields);
      finalFields = dropOptCols(finalFields);
      up = await updateRecord(token, rec.record_id, finalFields);
    }
    if(up.code !== 0){
      return res.status(200).json({ok:false, reason:'飞书写入失败: '+(up.msg||'')+' code='+up.code, recordId: rec.record_id});
    }
    const upOut = {ok:true, recordId: rec.record_id, host, date, total: r.total, fieldsWritten: Object.keys(finalFields).length, removedDup};
    if(optDropped.length) upOut.optColsDropped = optDropped;
    return res.status(200).json(Object.assign(upOut, repSkip ? {reportSkipped: repSkip} : {}));
  }catch(e){
    return res.status(500).json({ok:false, error: e.message});
  }
};
