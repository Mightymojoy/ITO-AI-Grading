// =====================================================
// 全表联动验证脚本（一次全联动 · 每次改表后必跑）
// 模拟一次真实评分（用 8.18 SRT 或 mock 数据）→ 逐表验证写入：
//   ① 主播日报(fill) ② 黄金话术库 ③ 问题话术库 ④ 历史评分
//   ⑤ 周总结 ⑥ 月总结 ⑦ TOP1 ⑧ 明星主播（6位之一）
// 用法: node verify_all_tables.js
// =====================================================
const fs = require('fs'), vm = require('vm');

const CLOUD_FILL = 'https://cloud-five-pi.vercel.app/api/feishu-fill';
const CLOUD_SYNC = 'https://cloud-five-pi.vercel.app/api/feishu-sync';
const CLOUD_WM   = 'https://cloud-five-pi.vercel.app/api/feishu-week-month';

// 沙箱加载评分引擎（真实前端代码）
const sandbox = {
  document: { getElementById: () => ({ value:'', style:{}, innerHTML:'', textContent:'', className:'', files:[], _id:'' }), querySelectorAll: () => [], createElement: () => ({style:{}}) },
  window: {}, console, setTimeout, FileReader: function(){}, File: function(){}, Blob: function(){}, DataTransfer: function(){},
  localStorage: { _d:{}, getItem:function(k){ return this._d[k] || null; }, setItem:function(k,v){ this._d[k]=String(v); }, removeItem:function(k){ delete this._d[k]; } },
  fetch: globalThis.fetch, location:{protocol:'https:', hostname:'mightymojoy.github.io'}
};
sandbox.window = sandbox;
const html = fs.readFileSync('index.html','utf8');
const code = fs.readFileSync('standard.js','utf8') + '\n' + fs.readFileSync('outfit.js','utf8') + '\n' + (html.match(/<script>([\s\S]*?)<\/script>/)||['',''])[1];
vm.createContext(sandbox); vm.runInContext(code, sandbox);

async function call(url, body){
  try{
    const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    return await r.json();
  }catch(e){ return {ok:false, error:e.message}; }
}

(async () => {
  // ===== 1) 真实评分（8.18 赵亚男 SRT，明星名单外的常规主播）=====
  const text = fs.readFileSync('samples/2026.8.18-综合-赵亚男_原文.srt','utf8');
  sandbox.__t = text;
  vm.runInContext('var __s = parseTranscript(__t); var __fk = detectProductFromName("2026.8.18-综合-赵亚男_原文.srt", __t); var __r = runGrading(__s, __fk || "auto");', sandbox);
  const r = sandbox.__r;
  const meta = vm.runInContext('autoDetectMeta("2026.8.18-综合-赵亚男_原文.srt")', sandbox);
  r.host = meta.host || '赵亚男'; r.studio = meta.studio || ''; r.date = meta.date || '2026-08-18';
  r.product = r.sellpoints ? r.sellpoints.product : '';
  console.log('===== 评分对象: ' + r.host + ' | ' + r.total + '分 ' + r.grade + ' | 产品: ' + r.product.slice(0,30));

  // ===== 2) ① 主播日报 fill =====
  const fillBody = {host:r.host, date:r.date, studio:r.studio, result:r};
  const fr = await call(CLOUD_FILL, fillBody);
  console.log('\n[① 主播日报] ' + (fr.ok ? '✅ '+(fr.created?'新建':'更新')+' ('+fr.fieldsWritten+'字段)' : '❌ '+(fr.reason||fr.error||'')));

  // ===== 3) ②③④ 黄金话术/问题话术/历史评分 sync =====
  const payload = {golden:[], problems:[], history:[], cases:[], stars:[]};
  if(r.golden && r.golden.items){
    for(const g of r.golden.items){ if(g.star >= 4) payload.golden.push({host:r.host, date:r.date, studio:r.studio, tags:g.tags||[], star:g.star, text:g.text}); }
  }
  if(r.training && r.training.length){
    for(const t of r.training){ payload.problems.push({host:r.host, date:r.date, studio:r.studio, type:t.mod||'能力缺口', desc:t.gap||'', prio:''}); }
  }
  let c1s = null;
  if(r.modules) for(const m of r.modules){ if(m.key==='c1') c1s = m.score; }
  payload.history.push({host:r.host, date:r.date, studio:r.studio, product:r.product||'', total:r.total, grade:r.grade, c1:c1s});
  // 明星主播（用曲姝锜模拟明星名单内的写入）
  if(['宿浩淇','苏蓬','曲姝锜','甘晋铭','全程','王菲'].indexOf(r.host) >= 0){
    payload.stars.push({host:r.host, studio:r.studio, total:r.total, modules:r.modules||[], training:r.training||[]});
  }
  const sr = await call(CLOUD_SYNC, payload);
  console.log('[②③④ 金句/问题/历史 sync] ' + (sr.ok ? '✅ 写入'+sr.written+'/去重'+sr.skipped+'/失败'+sr.failed : '❌ '+(sr.error||'')));
  if(sr.results) sr.results.forEach(x => console.log('     ' + x.type + ': ' + (x.r.ok?'✅':'❌ '+(x.r.reason||x.r.error||''))));

  // ===== 4) ⑤⑥ 周总结/月总结 week-month =====
  const now = new Date();
  const pad2 = n => String(n).padStart(2,'0');
  const fmt = d => d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
  const day = (now.getDay()+6)%7;
  const monday = new Date(now); monday.setDate(now.getDate()-day);
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  const wm = await call(CLOUD_WM, {range:'week', start:fmt(monday), end:fmt(sunday)});
  console.log('[⑤ 周总结] ' + (wm.ok ? '✅ 聚合'+wm.hosts+'主播'+(wm.detail?' | 明星'+wm.detail.generated+'生成': '') : '❌ '+(wm.error||wm.reason||'')));
  const mm = await call(CLOUD_WM, {range:'month', start:now.getFullYear()+'-'+pad2(now.getMonth()+1)+'-01', end:now.getFullYear()+'-'+pad2(now.getMonth()+1)+'-31'});
  console.log('[⑥ 月总结] ' + (mm.ok ? '✅ 聚合'+mm.hosts+'主播' : '❌ '+(mm.error||mm.reason||'')));

  // ===== 5) ⑦ TOP1（批量场景需要至少2人，这里用简化单条验证同步通路）=====
  const t1 = await call(CLOUD_SYNC, {top1:[{date:r.date||'2026-08-18', studio:r.studio||'综合', host:r.host, total:r.total, grade:r.grade, criteria:['横向最优'], reason:'验证', second:'', diff:0, c1Check:'✓ 通过'}]});
  console.log('[⑦ TOP1] ' + (t1.ok ? '✅ 写入'+(t1.written||0)+'/去重'+(t1.skipped||0) : '❌ '+(t1.error||'')));

  // ===== 6) ⑧ 明星主播（曲姝锜 mock 评分）=====
  const st = await call(CLOUD_SYNC, {stars:[{host:'曲姝锜', studio:'轻熟质享客', total:75, modules:r.modules||[], training:r.training||[]}]});
  console.log('[⑧ 明星主播] ' + (st.ok ? '✅ 写入'+(st.written||0)+'/失败'+(st.failed||0) : '❌ '+(st.error||'')));

  console.log('\n===== 全表联动验证完成 =====');
  console.log('通过项: ' + [fr.ok, sr.ok, wm.ok, mm.ok, t1.ok, st.ok].filter(Boolean).length + '/6');
})().catch(e => console.error('FATAL', e.message));