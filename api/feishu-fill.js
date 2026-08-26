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

async function listRecords(token){
  const r = await httpsJson({
    hostname:'open.feishu.cn',
    path:'/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+TABLE_ID+'/records?page_size=200',
    method:'GET', headers:{'Authorization':'Bearer '+token}
  });
  if(r.code !== 0) throw new Error('拉取记录失败: ' + (r.msg||''));
  return r.data.items || [];
}

function matchRecord(records, host, date){
  if(!host || !date) return null;
  const target = String(date).slice(0,10);
  for(const rec of records){
    const f = rec.fields || {};
    if(f['主播'] === host && String(f['日期']||'').slice(0,10) === target) return rec;
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
    const rec = matchRecord(records, host, date);

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

    const baseFields = {
      '综合评分': String(r.total != null ? r.total : ''),
      '产品知识能力': String(c.c1 != null ? c.c1 : ''),
      '逻辑组织能力(流畅度)': String(c.c2 != null ? c.c2 : ''),
      '场景化表达能力(延展性)': String(c.c3 != null ? c.c3 : ''),
      '可视化道具运用': String(c.c4 != null ? c.c4 : ''),
      '情绪感染能力': String(c.c5 != null ? c.c5 : '')
    };
    if(golden) baseFields['黄金话术'] = golden;
    if(bad) baseFields['违规话术'] = bad;

    // 匹配不到 → 自动创建记录（评分结果自动写入飞书的完整闭环）
    if(!rec){
      const createFields = Object.assign({}, baseFields, {
        '主播': host,
        '日期': String(date).slice(0,10)
      });
      if(data.studio) createFields['直播间'] = data.studio;
      const cr = await createRecord(token, createFields);
      if(cr.code !== 0){
        return res.status(200).json({ok:false, reason:'飞书自动建记录失败: '+(cr.msg||'')+' code='+cr.code});
      }
      const newRec = cr.data && cr.data.record;
      return res.status(200).json({ok:true, created:true, recordId: newRec ? newRec.record_id : '', host, date, total: r.total, fieldsWritten: Object.keys(createFields).length});
    }

    const fields = Object.assign({}, baseFields);
    if(data.studio && !rec.fields['直播间']) fields['直播间'] = data.studio;

    const up = await updateRecord(token, rec.record_id, fields);
    if(up.code !== 0){
      return res.status(200).json({ok:false, reason:'飞书写入失败: '+(up.msg||'')+' code='+up.code, recordId: rec.record_id});
    }
    return res.status(200).json({ok:true, recordId: rec.record_id, host, date, total: r.total, fieldsWritten: Object.keys(fields).length});
  }catch(e){
    return res.status(500).json({ok:false, error: e.message});
  }
};
