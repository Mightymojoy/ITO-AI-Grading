/**
 * 主播评分系统 · 云端飞书同步（Vercel Serverless）
 * 处理系统折叠块数据 → 飞书同步表（黄金话术库 / 问题话术库 / 优秀案例 / 历史评分 / TOP1）
 * 凭证：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BASE_TOKEN
 * 表 ID：FEISHU_TBL_GOLDEN / PROBLEM / CASE / HISTORY / TOP1
 * 部署：vercel --prod（在 cloud/ 目录）
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

const TBL = {
  golden:  process.env.FEISHU_TBL_GOLDEN  || '',
  problem: process.env.FEISHU_TBL_PROBLEM || '',
  case:    process.env.FEISHU_TBL_CASE    || '',
  history: process.env.FEISHU_TBL_HISTORY || '',
  top1:    process.env.FEISHU_TBL_TOP1    || ''
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

async function listRecords(token, tableId){
  const r = await httpsJson({
    hostname:'open.feishu.cn',
    path:'/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+tableId+'/records?page_size=200',
    method:'GET', headers:{'Authorization':'Bearer '+token}
  });
  if(r.code !== 0) return [];
  return r.data.items || [];
}

async function createRecord(token, tableId, fields){
  const body = JSON.stringify({fields});
  return httpsJson({
    hostname:'open.feishu.cn',
    path:'/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+tableId+'/records',
    method:'POST',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)}
  }, body);
}

async function updateRecord(token, tableId, recordId, fields){
  const body = JSON.stringify({fields});
  return httpsJson({
    hostname:'open.feishu.cn',
    path:'/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+tableId+'/records/'+recordId,
    method:'PUT',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)}
  }, body);
}

// 查重：按字段值查找已存在记录
async function findRecordByField(token, tableId, fieldName, fieldValue){
  const records = await listRecords(token, tableId);
  for(const rec of records){
    if((rec.fields || {})[fieldName] === fieldValue) return rec;
  }
  return null;
}

// 同步单条（去重 → 无则新建）
async function syncRecord(token, tableId, dedupField, dedupValue, fields){
  if(!tableId) return {ok:false, skipped:true, reason:'表未配置'};
  const exist = await findRecordByField(token, tableId, dedupField, dedupValue);
  if(exist) return {ok:false, skipped:true, reason:'已存在（去重）', recordId: exist.record_id};
  const r = await createRecord(token, tableId, fields);
  if(r.code !== 0) return {ok:false, reason:'写入失败: '+(r.msg||'')+' code='+r.code};
  return {ok:true, recordId: r.data && r.data.record ? r.data.record.record_id : ''};
}

module.exports = async function handler(req, res){
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS'){ res.status(200).end(); return; }
  if(req.method !== 'POST'){ res.status(405).json({ok:false, error:'Method'}); return; }

  try{
    const data = req.body || {};
    if(!APP_ID || !APP_SECRET || !BASE_TOKEN){
      return res.status(200).json({ok:false, skipped:true, reason:'服务端未配置飞书凭证'});
    }

    const token = await getToken();
    const results = [];

    // 黄金话术库（4-5 星金句）
    for(const g of (data.golden || [])){
      if(!g.text || g.star < 4) continue;
      results.push({type:'golden', r: await syncRecord(token, TBL.golden, '话术文本', g.text, {
        '主播': g.host||'', '日期': g.date||'', '直播间': g.studio||'',
        '能力标签': (g.tags||[]).join('·'), '星级': '★'.repeat(Math.min(g.star,5)),
        '话术文本': String(g.text).slice(0, 500)
      })});
    }

    // 问题话术库
    for(const p of (data.problems || [])){
      if(!p.desc) continue;
      results.push({type:'problem', r: await syncRecord(token, TBL.problem, '问题描述', p.desc, {
        '主播': p.host||'', '日期': p.date||'', '直播间': p.studio||'',
        '问题类型': p.type||'', '问题描述': String(p.desc).slice(0, 500), '优先级': p.prio||''
      })});
    }

    // 历史评分（每次评分）
    for(const h of (data.history || [])){
      if(!h.host || !h.date) continue;
      results.push({type:'history', r: await syncRecord(token, TBL.history, '主播', h.host, {
        '主播': h.host||'', '日期': h.date||'', '直播间': h.studio||'',
        '产品': h.product||'', '总分': h.total!=null?String(h.total):'', '等级': h.grade||'',
        'c1产品理解': h.c1!=null?String(h.c1):''
      })});
    }

    // 优秀案例
    for(const c2 of (data.cases || [])){
      if(!c2.text) continue;
      results.push({type:'case', r: await syncRecord(token, TBL.case, '案例话术', c2.text, {
        '主播': c2.host||'', '日期': c2.date||'', '直播间': c2.studio||'',
        '类型': c2.type||'', '案例话术': String(c2.text).slice(0, 500), '分析': c2.analysis||''
      })});
    }

    // TOP1 评选结果（按日期去重，同日期更新）
    for(const t1 of (data.top1 || [])){
      if(!t1.date || !t1.host) continue;
      const fields = {
        '日期': t1.date||'', '直播间': t1.studio||'', 'TOP1主播': t1.host||'',
        '总分': t1.total!=null?String(t1.total):'', '等级': t1.grade||'',
        '推荐标准': (t1.criteria||[]).join('、'), '推荐依据': t1.reason||'',
        '第二名': t1.second||'', '与第二名分差': t1.diff!=null?String(t1.diff):'',
        '产品理解检查': t1.c1Check||''
      };
      const exist = await findRecordByField(token, TBL.top1, '日期', t1.date);
      let r;
      if(exist){
        const up = await updateRecord(token, TBL.top1, exist.record_id, fields);
        r = up.code === 0 ? {ok:true, recordId: exist.record_id, updated:true} : {ok:false, reason:'更新失败: '+(up.msg||'')};
      } else {
        r = await syncRecord(token, TBL.top1, '日期', t1.date, fields);
      }
      results.push({type:'top1', r: r});
    }

    // 统计
    let written = 0, skipped = 0, failed = 0;
    for(const x of results){
      if(x.r.ok) written++;
      else if(x.r.skipped) skipped++;
      else failed++;
    }
    return res.status(200).json({ok:true, written, skipped, failed, total: results.length, results});
  }catch(e){
    return res.status(500).json({ok:false, error: e.message});
  }
};