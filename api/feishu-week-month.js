/**
 * 主播评分系统 · 周/月总结自动聚合（Vercel Serverless）
 * 从历史评分表 + 黄金话术库 + 问题话术库聚合指定时间窗数据 → 写入周/月总结表
 * 用法：POST {range:'week'|'month', start:'2026-08-24', end:'2026-08-30'}
 *   range='week'  → 写周总结表 + 6名明星主播问题整改行
 *   range='month' → 写月总结表
 * 凭证/表 ID 走 Vercel 环境变量
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
  history: process.env.FEISHU_TBL_HISTORY || 'tblkN1e6yCtXl5bG',
  golden:  process.env.FEISHU_TBL_GOLDEN  || 'tbluc1Erb4b04PIb',
  problem: process.env.FEISHU_TBL_PROBLEM || 'tblORA9bSl8M63EO',
  week:    process.env.FEISHU_TBL_WEEK    || 'tbljvCsgMJF9efok',
  month:   process.env.FEISHU_TBL_MONTH   || 'tbl6LQrwRgnHcumu',
  detail:  process.env.FEISHU_TBL_DETAIL  || 'tblW366zZNF9QF06'
};

// V3.9 6 名明细主播（明星主播，跨 3 直播间各 2 人）—— 每周自动生成"问题整改"行
const STARS = ['宿浩淇','苏蓬','曲姝锜','甘晋铭','全程','王菲'];
const STAR_STUDIO = {
  '宿浩淇':'云端商务家','苏蓬':'云端商务家',
  '曲姝锜':'轻熟质享客','甘晋铭':'轻熟质享客',
  '全程':'摩登新贵女','王菲':'摩登新贵女'
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

async function listAllRecords(token, tableId){
  let items = [], pageToken = '';
  for(let i=0;i<20;i++){
    let url = '/open-apis/bitable/v1/apps/'+BASE_TOKEN+'/tables/'+tableId+'/records?page_size=100';
    if(pageToken) url += '&page_token=' + encodeURIComponent(pageToken);
    const r = await httpsJson({hostname:'open.feishu.cn', path:url, method:'GET', headers:{'Authorization':'Bearer '+token}});
    if(r.code !== 0) throw new Error('拉取记录失败: ' + (r.msg||''));
    items = items.concat(r.data.items || []);
    if(!r.data.has_more || !r.data.page_token) break;
    pageToken = r.data.page_token;
  }
  return items;
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

function normDate(d){
  if(!d) return '';
  const s = String(d).trim();
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(m) return m[1] + '-' + String(+m[2]).padStart(2,'0') + '-' + String(+m[3]).padStart(2,'0');
  return s.slice(0,10);
}
function inRange(d, start, end){
  return normDate(d) >= start && normDate(d) <= end;
}

// 计算 ISO 周次（YYYY-Www）
function weekLabel(dateStr){
  const d = new Date(dateStr);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((utc - yearStart) / 86400000 / 7 + 1);
  return utc.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

module.exports = async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS'){ res.status(200).end(); return; }
  if(req.method !== 'POST'){ res.status(405).json({ok:false, error:'Method'}); return; }

  try{
    const data = req.body || {};
    const range = data.range === 'month' ? 'month' : 'week';
    const start = String(data.start || '').slice(0,10);
    const end = String(data.end || '').slice(0,10);
    if(!start || !end) return res.status(200).json({ok:false, skipped:true, reason:'缺少 start/end'});

    const token = await getToken();

    // 1) 历史评分
    const hist = await listAllRecords(token, TBL.history);
    const inWin = hist.filter(r => {
      const f = r.fields || {};
      return f['主播'] && f['日期'] && inRange(f['日期'], start, end);
    });
    if(!inWin.length){
      return res.status(200).json({ok:true, empty:true, reason:'时间窗内无评分数据', range, start, end});
    }

    // 2) 按主播聚合
    const byHost = {};
    inWin.forEach(r => {
      const f = r.fields || {};
      const host = f['主播'];
      if(!byHost[host]) byHost[host] = {host, studio: f['直播间']||'', dates: [], totals: [], c1s: [], best: null};
      const b = byHost[host];
      b.dates.push(normDate(f['日期']));
      const t = parseFloat(f['总分']);
      if(!isNaN(t)) b.totals.push(t);
      const c1 = parseFloat(f['c1产品理解']);
      if(!isNaN(c1)) b.c1s.push(c1);
      if(!b.best || t > b.best.total) b.best = {date: normDate(f['日期']), total: t, grade: f['等级']||''};
    });
    const hosts = Object.keys(byHost).sort();
    const agg = hosts.map(h => {
      const b = byHost[h];
      const avg = b.totals.length ? Math.round(b.totals.reduce((a,x)=>a+x,0)/b.totals.length*10)/10 : 0;
      const avgC1 = b.c1s.length ? Math.round(b.c1s.reduce((a,x)=>a+x,0)/b.c1s.length*10)/10 : 0;
      const firstT = b.totals.length ? b.totals[0] : 0;
      const lastT = b.totals.length ? b.totals[b.totals.length-1] : 0;
      return {host:h, studio:b.studio, count:b.totals.length, avg, avgC1, trend: lastT - firstT, best:b.best, dates:b.dates};
    }).sort((a,b)=>b.avg-a.avg);
    const top1 = agg.length ? agg.reduce((a,b)=> (b.best && (!a.best || b.best.total > a.best.total)) ? b : a, agg[0]) : null;

    // 3) 黄金话术
    const goldens = await listAllRecords(token, TBL.golden);
    const gInWin = goldens.filter(r => {
      const f = r.fields || {};
      return f['主播'] && f['日期'] && inRange(f['日期'], start, end);
    });

    // 4) 问题话术（按类型统计）
    const problems = await listAllRecords(token, TBL.problem);
    const pInWin = problems.filter(r => {
      const f = r.fields || {};
      return f['主播'] && f['日期'] && inRange(f['日期'], start, end);
    });
    const pType = {};
    pInWin.forEach(r => {
      const desc = String(r.fields['问题描述']||'');
      const m = desc.match(/^(.+?)（未命中/);
      const key = m ? m[1] : '其他';
      pType[key] = (pType[key]||0) + 1;
    });
    const topProblems = Object.keys(pType).sort((a,b)=>pType[b]-pType[a]).slice(0,3)
      .map(k => k + '×' + pType[k]).join('；') || '';

    // 5) 写周/月总结表
    const tableId = range === 'month' ? TBL.month : TBL.week;
    const dedupField = range === 'month' ? '月份' : '周起始';
    const existRecs = await listAllRecords(token, tableId);
    const existMap = {};
    existRecs.forEach(r => {
      const f = r.fields || {};
      const k = String(f[dedupField]||'') + '_' + String(f['主播']||'');
      existMap[k] = r.record_id;
    });

    let written = 0, updated = 0;
    for(const a of agg){
      const myG = gInWin.filter(r => (r.fields||{})['主播'] === a.host).slice(0,2)
        .map(r => String((r.fields||{})['话术文本']||'').slice(0,60)).join('｜') || '';
      const isTop = top1 && top1.host === a.host;
      const fields = range === 'month' ? {
        '月份': start.slice(0,7),
        '主播': a.host, '直播间': a.studio||'',
        '综合评分(月均)': String(a.avg),
        '月度亮点': myG,
        '待改进': topProblems,
        '月TOP1': isTop ? (a.best ? a.best.total + '分 ' + (a.best.grade||'') : '') : ''
      } : {
        '周起始': start, '周结束': end,
        '主播': a.host, '直播间': a.studio||'',
        '综合评分(周均)': String(a.avg),
        '周内亮点': myG,
        '待改进': topProblems,
        '周TOP1': isTop ? (a.best ? a.best.total + '分 ' + (a.best.grade||'') : '') : ''
      };
      const key = (range === 'month' ? start.slice(0,7) : start) + '_' + a.host;
      if(existMap[key]){
        const up = await updateRecord(token, tableId, existMap[key], fields);
        if(up.code === 0) updated++;
      } else {
        const cr = await createRecord(token, tableId, fields);
        if(cr.code === 0) written++;
      }
    }

    // 6) V3.9：周聚合时为 6 名明细（明星）主播生成"问题整改"行
    let detailWritten = 0, detailUpdated = 0;
    let detailGenerated = 0;
    if(range === 'week'){
      const detailExist = await listAllRecords(token, TBL.detail);
      const detailMap = {};
      detailExist.forEach(r => {
        const k = String((r.fields||{})['周起始']||'') + '_' + String((r.fields||{})['主播']||'');
        detailMap[k] = r.record_id;
      });
      const weekNum = weekLabel(start);
      for(const star of STARS){
        const starP = pInWin.filter(r => (r.fields||{})['主播'] === star);
        const pByType = {};
        starP.forEach(r => {
          const desc = String(r.fields['问题描述']||'');
          const m = desc.match(/^(.+?)（未命中/);
          const key = m ? m[1] : '其他';
          pByType[key] = (pByType[key]||0) + 1;
        });
        const lackList = Object.keys(pByType).sort((a,b)=>pByType[b]-pByType[a]).slice(0,3)
          .map(k => k + '×' + pByType[k]).join('；');
        const recList = starP.slice(0,3).map(r => String(r.fields['问题描述']||'').slice(0,80)).join(' | ');
        const starHist = agg.find(a => a.host === star);
        const plan = starHist && starHist.trend < -5 ? '近期评分下滑，需重点辅导'
                  : (starP.length ? '按欠缺能力补齐相应讲解' : '保持现有水平，关注薄弱点');
        // 无问题且分数高跳过
        if(!lackList && !recList && (!starHist || starHist.avg >= 75)) continue;
        detailGenerated++;
        const dFields = {
          '周次': weekNum, '周起始': start, '周结束': end,
          '主播': star, '直播间': STAR_STUDIO[star]||'',
          '欠缺能力': lackList || '—', '问题记录': recList || '—', '整改计划': plan
        };
        const dk = start + '_' + star;
        if(detailMap[dk]){
          const dup = await updateRecord(token, TBL.detail, detailMap[dk], dFields);
          if(dup.code === 0) detailUpdated++;
        } else {
          const dcr = await createRecord(token, TBL.detail, dFields);
          if(dcr.code === 0) detailWritten++;
        }
      }
    }

    return res.status(200).json({ok:true, range, start, end, hosts: agg.length, written, updated, empty:false,
      top1: top1 ? top1.host + ' ' + (top1.best ? top1.best.total : '') + '分' : '',
      detail: range === 'week' ? {stars: STARS.length, generated: detailGenerated, written: detailWritten, updated: detailUpdated} : undefined});
  }catch(e){
    return res.status(500).json({ok:false, error: e.message});
  }
};