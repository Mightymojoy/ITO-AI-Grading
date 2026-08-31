// =====================================================
// v4 工作台壳层（纯加法，不修改 app-core.js 任何逻辑）
// 职责：① hash 路由 ② 全局 JS 错误捕获条 ③ 工作台首页渲染
//       ④ 设置页（服务地址覆盖 / 版本口径 / 着装标准表）
// 数据读取：只读 localStorage 既有键（grading_history_v1 /
//           grading_v2_golden_lib / grading_problem_lib_v1）
// =====================================================

// ---------- 0. 全局 JS 错误捕获（红色错误条，常驻显示 + 可关闭） ----------
(function(){
  var bar = document.getElementById('errbar');
  function showErr(msg){
    if(!bar) return;
    bar.style.display = 'block';
    bar.innerHTML = '<b>JS 错误：</b>' + String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;') +
      ' <button onclick="this.parentNode.style.display=\'none\'" style="float:right;border:none;background:none;color:inherit;cursor:pointer;font-size:13px">✕</button>';
  }
  window.onerror = function(msg, src, line, col){ showErr(msg + '（' + (src||'').split('/').pop() + ':' + line + ':' + col + '）'); };
  window.addEventListener('unhandledrejection', function(e){ showErr('Promise 异常：' + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
})();

// ---------- 1. hash 路由 ----------
var V4_PAGES = {
  dashboard: '工作台首页',
  daily:     '每日评分',
  vision:    '一键完整日报',
  batch:     '批量 TOP1',
  feishu:    '飞书云端数据',
  golden:    '黄金话术库',
  problem:   '问题话术库',
  cases:     '优秀案例TOP3',
  history:   '历史评分',
  settings:  '设置'
};
// v4.4：hash 支持参数（#/feishu?t=daily）
function v4HashParts(){
  var raw = (location.hash || '').replace(/^#\/?/, '');
  var qi = raw.indexOf('?');
  var key = qi >= 0 ? raw.slice(0, qi) : raw;
  var q = qi >= 0 ? raw.slice(qi + 1) : '';
  var params = {};
  if(q){
    var arr = q.split('&');
    for(var a=0; a<arr.length; a++){
      var kv = arr[a].split('=');
      if(kv[0]) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
  }
  return {key: key, params: params};
}
function v4Navigate(){
  var hp = v4HashParts();
  var key = hp.key || 'dashboard';
  if(!V4_PAGES[key]) key = 'dashboard';
  var pages = document.querySelectorAll('.page');
  for(var i=0;i<pages.length;i++){ pages[i].classList.remove('active'); }
  var pg = document.getElementById('page-' + key);
  if(pg) pg.classList.add('active');
  var links = document.querySelectorAll('#v4nav a');
  var curT = hp.params.t || '';
  for(var j=0;j<links.length;j++){
    var lp = links[j].getAttribute('data-page') || '';
    var lt = links[j].getAttribute('data-t') || '';
    var hit = (lp === key) && (!lt || lt === curT);
    // 飞书页：只有精确匹配 t 的那一项高亮；其它页按 page 高亮
    if(hit) links[j].classList.add('active');
    else links[j].classList.remove('active');
  }
  var title = document.getElementById('pageTitle');
  if(title) title.textContent = V4_PAGES[key];
  if(key === 'dashboard') try{ v4RenderDashboard(); }catch(e){}
  if(key === 'settings')  try{ v4RenderSettings(); }catch(e){}
  if(key === 'feishu')    try{ v4FeishuLoad(curT || 'daily'); }catch(e){}
}
window.addEventListener('hashchange', v4Navigate);

// ---------- 2. 工具 ----------
function v4TodayStr(){
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function v4ReadLS(key, fallback){
  try{ return JSON.parse(localStorage.getItem(key) || fallback); }catch(e){ return JSON.parse(fallback); }
}

// ---------- 3. 工作台首页 ----------
function v4RenderDashboard(){
  // 统计（只读 localStorage，与核心同键）
  var hist   = v4ReadLS('grading_history_v1', '[]');
  var golden = v4ReadLS('grading_v2_golden_lib', '{"items":[]}');
  var probs  = v4ReadLS('grading_problem_lib_v1', '[]');
  var today  = v4TodayStr();
  var todayN = 0, hosts = {};
  for(var i=0;i<hist.length;i++){
    if(hist[i].date === today) todayN++;
    hosts[hist[i].host] = 1;
  }
  document.getElementById('dash-stat-today').textContent   = todayN;
  document.getElementById('dash-stat-history').textContent = hist.length;
  document.getElementById('dash-stat-golden').textContent  = (golden.items || []).length;
  document.getElementById('dash-stat-problem').textContent = probs.length;
  // 最近评分（最近 8 条）
  var box = document.getElementById('dash-recent');
  if(!hist.length){
    box.innerHTML = '暂无记录——去「每日评分」完成第一次评分（历史数据与 v3 共库，之前评过的直接可见）';
  } else {
    var recent = hist.slice().sort(function(a,b){ return (b.ts||0)-(a.ts||0); }).slice(0, 8);
    var h = '<table><tr><th style="width:14%">主播</th><th style="width:12%">日期</th><th style="width:9%">总分</th><th style="width:11%">c1 产品理解</th><th>考核产品</th></tr>';
    for(var j=0;j<recent.length;j++){
      var r = recent[j];
      h += '<tr><td><b>' + esc(r.host) + '</b></td><td>' + esc(r.date || '—') + '</td><td><b style="color:var(--gold)">' + r.total + '</b></td><td>' + (r.c1Score !== null && r.c1Score !== undefined ? r.c1Score : '—') + '</td><td style="font-size:11.5px;color:var(--text2)">' + v4ExpandCell(r.product || '—', 44) + '</td></tr>';
    }
    box.innerHTML = h + '</table><div style="margin-top:6px"><a href="#/history" style="font-size:11.5px;color:var(--gold)">查看全部历史 →</a></div>';
  }
  // 服务探针
  try{ v4Probe('svc-asr',   (typeof ASR_URL    !== 'undefined' ? ASR_URL    : 'http://127.0.0.1:3712') + '/api/health', 'svc-asr-txt'); }catch(e){}
  try{ v4Probe('svc-vision',(typeof VISION_URL !== 'undefined' ? VISION_URL : 'http://127.0.0.1:3713') + '/api/health', 'svc-vision-txt'); }catch(e){}
}
function v4Probe(lightId, url, txtId){
  var light = document.getElementById(lightId);
  var txt = document.getElementById(txtId);
  var ctrl = ('AbortController' in window) ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 2500) : null;
  fetch(url, {signal: ctrl ? ctrl.signal : undefined}).then(function(){
    if(timer) clearTimeout(timer);
    light.className = 'light on';
    txt.textContent = '已连接';
  }).catch(function(){
    if(timer) clearTimeout(timer);
    light.className = 'light off';
    txt.textContent = '未启动（评分/日报功能不可用，逐字稿直评不受影响）';
  });
}

// ---------- 4. 设置页 ----------
function v4RenderSettings(){
  // 当前生效地址
  var cur = document.getElementById('set-current');
  cur.innerHTML = '当前生效：ASR <b>' + esc(ASR_URL) + '</b> ｜ Vision <b>' + esc(VISION_URL) + '</b><br>飞书 fill <b>' + esc(FEISHU_FILL_URL) + '</b><br>飞书 sync <b>' + esc(FEISHU_SYNC_URL) + '</b>';
  // 输入框回填 localStorage 覆盖值
  document.getElementById('set-asr').value    = localStorage.getItem('asr_url') || '';
  document.getElementById('set-vision').value = localStorage.getItem('vision_url') || '';
  document.getElementById('set-fill').value   = localStorage.getItem('feishu_fill_url') || '';
  document.getElementById('set-sync').value   = localStorage.getItem('feishu_sync_url') || '';
  document.getElementById('set-read').value   = localStorage.getItem('feishu_data_dir') || 'data';
  // 版本口径
  document.getElementById('set-versions').innerHTML =
    '工作台版本：<b>v4.7.8</b>（壳层）<br>' +
    '评分引擎：<b>v3.9</b>（app-core.js · 07a97a7 字符级零改动）<br>' +
    '评分标准：<b>' + esc(GRADING_STANDARD.version) + '</b> · ' + esc(GRADING_STANDARD.meta.name) + '<br>' +
    '评分口径：' + esc(GRADING_STANDARD.meta.scoring) + '<br>' +
    '证据口径：' + esc(GRADING_STANDARD.meta.evidence) + '<br>' +
    '着装标准：V4（' + esc(OUTFIT_STANDARD.meta.scoring) + '）<br>' +
    'localStorage 键与 v3 完全一致：grading_history_v1 / grading_v2_golden_lib / grading_problem_lib_v1（历史数据无缝延续）';
  // 着装标准表
  var hosts = OUTFIT_STANDARD.hosts || {};
  var byStudio = {};
  for(var name in hosts){
    var st = hosts[name].studio || '其他';
    if(!byStudio[st]) byStudio[st] = [];
    byStudio[st].push({name:name, o:hosts[name]});
  }
  var h = '<table><tr><th style="width:24%">主播</th><th>直播间</th></tr>';
  var order = ['云端商务家','轻熟质享客','摩登新贵女','天猫直播间'];
  for(var oi=0; oi<order.length; oi++){
    var list = byStudio[order[oi]] || [];
    for(var li=0; li<list.length; li++){
      var it = list[li];
      h += '<tr><td><b>' + esc(it.name) + '</b></td><td>' + esc(it.o.studio) + '</td></tr>';
    }
  }
  document.getElementById('set-outfit').innerHTML = h + '</table>';
}
// 设置页按钮（保存后刷新让核心重读 localStorage）
document.addEventListener('DOMContentLoaded', function(){
  var save = document.getElementById('setSaveBtn');
  var reset = document.getElementById('setResetBtn');
  if(save) save.onclick = function(){
    var map = {'set-asr':'asr_url','set-vision':'vision_url','set-fill':'feishu_fill_url','set-sync':'feishu_sync_url','set-read':'feishu_data_dir'};
    for(var id in map){
      var v = document.getElementById(id).value.trim();
      if(v) localStorage.setItem(map[id], v);
      else localStorage.removeItem(map[id]);
    }
    toastErr('服务地址已保存，即将刷新生效…');
    setTimeout(function(){ location.reload(); }, 800);
  };
  if(reset) reset.onclick = function(){
    localStorage.removeItem('asr_url'); localStorage.removeItem('vision_url');
    localStorage.removeItem('feishu_fill_url'); localStorage.removeItem('feishu_sync_url');
    toastErr('已恢复默认地址，即将刷新…');
    setTimeout(function(){ location.reload(); }, 800);
  };
  // 飞书直达链接（v4.3）
  var flSave = document.getElementById('flSaveBtn');
  if(flSave) flSave.onclick = function(){
    var base = document.getElementById('fl-base').value.trim();
    if(base) localStorage.setItem('feishu_wiki_url', base); else localStorage.removeItem('feishu_wiki_url');
    var fkMap = { 'fl-daily':'daily','fl-top1':'top1','fl-week':'week','fl-weekstar':'weekstar','fl-month':'month','fl-reward':'reward','fl-punish':'punish' };
    var n = 0;
    for(var id in fkMap){
      var v2 = document.getElementById(id).value.trim();
      var key = 'feishu_tbl_' + fkMap[id];
      if(v2){ localStorage.setItem(key, v2); n++; } else localStorage.removeItem(key);
    }
    toastErr('飞书链接已保存（' + n + ' 项直达），立即生效');
    v4RenderSettings();
  };
  // 回填已存链接
  var baseEl = document.getElementById('fl-base');
  if(baseEl){
    baseEl.value = localStorage.getItem('feishu_wiki_url') || '';
    var fkMap2 = { 'fl-daily':'daily','fl-top1':'top1','fl-week':'week','fl-weekstar':'weekstar','fl-month':'month','fl-reward':'reward','fl-punish':'punish' };
    for(var id2 in fkMap2){ document.getElementById(id2).value = localStorage.getItem('feishu_tbl_' + fkMap2[id2]) || ''; }
  }
});

// ---------- 5. 导航点击绑定（双保险：href 默认导航 + 点击兜底） ----------
// v4.1 修复：v4.0 导航 <a> 无 href 且只靠 hashchange，点击无反应。
// 现规则：a 带 href 走浏览器默认 hash 导航；此处再兜底——同 hash 重复点击强制刷新视图，异常时直接切页。
(function(){
  var nav = document.getElementById('v4nav');
  if(!nav) return;
  nav.addEventListener('click', function(ev){
    var t = ev.target;
    while(t && t !== nav && !(t.tagName === 'A' && t.getAttribute('data-page'))) t = t.parentNode;
    if(!t || t === nav) return;
    var key = t.getAttribute('data-page');
    var tt = t.getAttribute('data-t');
    var target = '#/' + key + (tt ? '?t=' + tt : '');
    if(location.hash === target){
      ev.preventDefault();
      v4Navigate();
    } else {
      // 不同 hash：交给默认导航；若 200ms 后 hash 未变（环境异常），强制切页兜底
      setTimeout(function(){
        if(location.hash !== target) v4Navigate();
      }, 200);
    }
  });
})();

// ---------- 6. 话术库入库规则包装（v4.2：只记录 4 星 / 5 星） ----------// 实现：包装全局 addGoldenToLib，入库前过滤 star<4 的条目；app-core.js 文件零改动。
// 说明：只影响 v4 的入库行为；v3 不受影响；历史已入库的 3 星条目保留，可用下方"清理 3 星存档"按钮一次性移除。
(function(){
  if(typeof addGoldenToLib !== 'function') return;
  var origAdd = addGoldenToLib;
  window.addGoldenToLib = function(host, studio, date, product, golden){
    try{
      if(golden && golden.items && golden.items.length){
        var kept = [], drop = 0;
        for(var i=0;i<golden.items.length;i++){
          if(golden.items[i].star >= 4) kept.push(golden.items[i]); else drop++;
        }
        if(drop > 0) console.log('[v4.2] 话术库新规则：过滤 ' + drop + ' 条 <4 星，仅入库 ' + kept.length + ' 条 4/5 星');
        var g2 = {}; for(var k in golden) g2[k] = golden[k];
        g2.items = kept;
        golden = g2;
      }
    }catch(e){ console.error('[v4.2] 入库过滤异常，回退原始行为:', e); }
    return origAdd(host, studio, date, product, golden);
  };
})();

// ---------- 7. 归档索引查看器（v4.2：话术库 / 历史评分 统一 月→日→明细 三级查看） ----------
var V4ARCH = {};  // 每个查看器的选择状态 {golden:{month,day}, history:{month,day}}

function v4ArchData(type){
  if(type === 'golden'){
    var lib = v4ReadLS('grading_v2_golden_lib', '{"items":[]}');
    return (lib.items || []).slice();
  }
  if(type === 'cases') return v4ReadLS('grading_cases_lib_v1', '[]');
  return v4ReadLS('grading_history_v1', '[]');
}
// 日期归一化（全局，归档查看器与飞书表共用）：兼容 2026-8-13 / 2026-08-13 混合格式
// 返回 {m:'YYYY-MM', d:'YYYY-MM-DD'}，解析不出时均为 ''
function v4NormDate(s){
  var p = String(s || '').match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if(!p) return {m:'', d:''};
  var mo = p[2].length === 1 ? '0' + p[2] : p[2];
  var da = p[3] ? (p[3].length === 1 ? '0' + p[3] : p[3]) : '';
  return {m: p[1] + '-' + mo, d: da ? p[1] + '-' + mo + '-' + da : ''};
}
// 长文本单元格：超 n 字时渲染「截断 + 展开/收起」结构（点击由全局委托处理）
function v4ExpandCell(v, n){
  v = (v === undefined || v === null) ? '' : String(v);
  if(v.length <= n) return esc(v);
  return '<span class="fs-expand"><span class="fs-short">' + esc(v.slice(0,n)) +
         '</span><span class="fs-full" style="display:none">' + esc(v) +
         '</span> <a class="fs-toggle" data-action="toggleExpand">展开</a></span>';
}
function v4ArchRender(type){
  var box = document.getElementById('v4arch-' + type);
  if(!box) return;
  var items = v4ArchData(type);
  // 分组：月 → 日（date 形如 2026-08-28；异常归入"未填"）
  var byMonth = {}, order = [];
  for(var i=0;i<items.length;i++){
    var d = String(items[i].date || '');
    var nd0 = v4NormDate(d);
    var m = nd0.m || '未填';
    var day = nd0.d;
    if(!byMonth[m]){ byMonth[m] = {count:0, days:{}}; order.push(m); }
    byMonth[m].count++;
    if(day) byMonth[m].days[day] = (byMonth[m].days[day] || 0) + 1;
  }
  order.sort().reverse();
  if(!order.length){
    box.innerHTML = '<div style="font-size:12px;color:var(--text3)">暂无存档记录——完成一次评分后自动归档</div>';
    return;
  }
  var st = V4ARCH[type] = V4ARCH[type] || {};
  if(!st.month || byMonth[st.month] === undefined) st.month = order[0];
  var days = Object.keys(byMonth[st.month].days).sort().reverse();
  if(st.day && days.indexOf(st.day) < 0 && st.day !== 'all') st.day = days[0] || 'all';
  if(!st.day) st.day = days[0] || 'all';
  // 月份索引条
  var h = '<div class="arch-bar"><span class="arch-lb">月份</span>';
  for(var a=0;a<order.length;a++){
    var mo = order[a];
    h += '<button class="arch-chip' + (mo === st.month ? ' on' : '') + '" data-type="' + type + '" data-act="month" data-v="' + mo + '">' + mo + '（' + byMonth[mo].count + '）</button>';
  }
  h += '</div>';
  // 日期索引条
  h += '<div class="arch-bar"><span class="arch-lb">日期</span>';
  h += '<button class="arch-chip' + (st.day === 'all' ? ' on' : '') + '" data-type="' + type + '" data-act="day" data-v="all">全月（' + byMonth[st.month].count + '）</button>';
  for(var b=0;b<days.length;b++){
    var dy = days[b];
    h += '<button class="arch-chip' + (dy === st.day ? ' on' : '') + '" data-type="' + type + '" data-act="day" data-v="' + dy + '">' + dy.slice(5) + '（' + byMonth[st.month].days[dy] + '）</button>';
  }
  h += '</div>';
  // 明细表
  var rows = items.filter(function(x){
    var ndF = v4NormDate(x.date);
    var m = ndF.m || '未填';
    if(m !== st.month) return false;
    if(st.day === 'all') return true;
    return ndF.d === st.day;
  });
  if(type === 'golden'){
    rows.sort(function(a,b){ return (b.star||0)-(a.star||0); });
    h += '<table><tr><th style="width:10%">日期</th><th style="width:9%">主播</th><th style="width:12%">分类</th><th style="width:7%">星级</th><th>金句</th><th style="width:13%">标签</th></tr>';
    for(var c=0;c<rows.length;c++){
      var g = rows[c];
      var stc = g.star >= 5 ? 'style="color:var(--danger);font-weight:700"' : 'style="color:var(--gold);font-weight:700"';
      h += '<tr><td>' + esc(String(g.date || '—').slice(5)) + '</td><td><b>' + esc(g.host || '—') + '</b></td><td>' + esc(g.type || '—') + '</td><td><span ' + stc + '>' + '★'.repeat(g.star || 0) + '</span></td><td style="font-size:11.5px">' + (g.ts ? '<span class="evt">' + esc(g.ts) + '</span>' : '') + v4ExpandCell(g.text || '', 80) + '</td><td style="font-size:11px;color:var(--text2)">' + esc((g.tags || []).join('·')) + '</td></tr>';
    }
    h += '</table>';
    // 存档清理（含 <4 星的旧数据时提示）
    var lowN = 0;
    for(var d2=0;d2<items.length;d2++){ if((items[d2].star || 0) < 4) lowN++; }
    h += '<div style="margin-top:6px;font-size:11.5px;color:var(--text3)">入库规则（v4.2 起）：仅记录 4 星 / 5 星' +
      (lowN > 0 ? ' ｜ 存档中有 <b>' + lowN + '</b> 条旧规则（3 星）数据 <button class="btn btn-ghost" style="font-size:11px;padding:1px 10px" data-type="golden" data-act="clean3">清理 3 星存档</button>' : ' ｜ 存档无 <4 星数据') + '</div>';
  } else if(type === 'cases'){
    rows.sort(function(a,b){ return (b.t||0)-(a.t||0); });
    h += '<table><tr><th style="width:10%">日期</th><th style="width:9%">主播</th><th style="width:14%">能力 · 子标准</th><th>优秀案例（原文证据 + 时间戳）</th></tr>';
    for(var c2=0;c2<rows.length;c2++){
      var cs = rows[c2];
      h += '<tr><td>' + esc(String(cs.date || '—').slice(5)) + '</td><td><b>' + esc(cs.host || '—') + '</b></td><td style="font-size:11.5px;color:var(--gold)">' + esc(cs.mod || '') + (cs.std ? ' · ' + esc(cs.std) : '') + '</td><td style="font-size:11.5px">' + (cs.ts ? '<span class="evt">' + esc(cs.ts) + '</span>' : '') + v4ExpandCell(cs.ev || '', 80) + '</td></tr>';
    }
    h += '</table><div style="margin-top:6px;font-size:11.5px;color:var(--text3)">沉淀规则（v4.3 起）：每次单主播/批量评分自动记录当日前 3 条优秀案例（≥90 分高质量证据段落），按 主播+日期+原文 去重</div>';
  } else {
    rows.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
    h += '<table><tr><th style="width:11%">日期</th><th style="width:12%">主播</th><th style="width:8%">总分</th><th style="width:12%">c1 产品理解</th><th>考核产品</th></tr>';
    for(var e2=0;e2<rows.length;e2++){
      var r = rows[e2];
      h += '<tr><td>' + esc(r.date || '—') + '</td><td><b>' + esc(r.host || '—') + '</b></td><td><b style="color:var(--gold)">' + r.total + '</b></td><td>' + (r.c1Score !== null && r.c1Score !== undefined ? r.c1Score : '—') + '</td><td style="font-size:11.5px;color:var(--text2)">' + v4ExpandCell(r.product || '—', 44) + '</td></tr>';
    }
    h += '</table>';
  }
  box.innerHTML = h;
}
// 查看器事件（索引切换 / 3星清理）——事件委托，动态渲染也能点
document.addEventListener('click', function(ev){
  var t = ev.target;
  while(t && t !== document.body && !(t.getAttribute && t.getAttribute('data-act'))) t = t.parentNode;
  if(!t || t === document.body) return;
  var type = t.getAttribute('data-type'), act = t.getAttribute('data-act'), v = t.getAttribute('data-v');
  if(act === 'month'){ V4ARCH[type] = {month: v, day: null}; v4ArchRender(type); }
  else if(act === 'day'){ V4ARCH[type].day = v; v4ArchRender(type); }
  else if(act === 'clean3' && type === 'golden'){
    var lib = v4ReadLS('grading_v2_golden_lib', '{"items":[]}');
    var kept = [], removed = 0;
    for(var i=0;i<(lib.items || []).length;i++){
      if((lib.items[i].star || 0) >= 4) kept.push(lib.items[i]); else removed++;
    }
    if(!removed) return;
    if(!confirm('确定清理存档中 ' + removed + ' 条 3 星话术？此操作不可恢复（4/5 星保留 ' + kept.length + ' 条）。')) return;
    localStorage.setItem('grading_v2_golden_lib', JSON.stringify({items: kept}));
    try{ renderGoldenLib(); }catch(e){}
    v4ArchRender('golden');
    toastErr('已清理 ' + removed + ' 条 3 星存档，保留 4/5 星 ' + kept.length + ' 条');
  }
});

// 核心渲染后联动刷新归档查看器（不改核心函数文件，包装调用）
(function(){
  if(typeof renderGoldenLib === 'function'){
    var a = renderGoldenLib;
    window.renderGoldenLib = function(){ a(); try{ v4ArchRender('golden'); }catch(e){} };
  }
  if(typeof renderHistoryLib === 'function'){
    var b = renderHistoryLib;
    window.renderHistoryLib = function(){ b(); try{ v4ArchRender('history'); }catch(e){} };
  }
})();

// ---------- 7.5 飞书工作台直达（v4.3：侧边栏云端 7 项，链接可在设置页配置） ----------
var V4_FL_KEYS = { daily:'主播日报', top1:'多主播TOP1评分', week:'周总结', weekstar:'周总结-明星主播', month:'月总结', reward:'激励记录', punish:'惩罚记录' };
var V4_FL_BASE_DEFAULT = 'https://my.feishu.cn/wiki/GQgowqCIcijjENk8Vl8c2OQVnvj';
function v4FeishuUrl(fkey){
  return localStorage.getItem('feishu_tbl_' + fkey) || (localStorage.getItem('feishu_wiki_url') || V4_FL_BASE_DEFAULT);
}
// v4.6 起：侧边栏 7 项一律在工作台内渲染，不再 window.open 跳飞书（保留 url 仅用于设置页展示）

// ---------- 7.6 优秀案例TOP3 本地沉淀（v4.3：包装 addHistoryRecord，评分时顺带存当日前3优秀案例） ----------
// 新键 grading_cases_lib_v1：{date, host, studio, product, mod, std, ts, ev}
(function(){
  if(typeof addHistoryRecord !== 'function') return;
  var orig = addHistoryRecord;
  window.addHistoryRecord = function(r){
    var out = orig.apply(this, arguments);
    try{
      // ---- v4.6：一次评分 → 路由写入多个 tab（主播日报 / 周总结 / 月总结 / 明星主播）----
      try{ v4RouteScore(r); }catch(e){ console.error('[v4.6] 评分路由写入异常:', e); }
      // ---- 优秀案例 TOP3（原有逻辑不变）----
      if(r && r.cases && r.cases.good && r.cases.good.length && r.host && r.host !== '未识别'){
        var lib = v4ReadLS('grading_cases_lib_v1', '[]');
        var added = 0;
        for(var i=0;i<r.cases.good.length && i<3;i++){
          var c = r.cases.good[i];
          var dup = lib.some(function(x){ return x.host === r.host && x.date === r.date && (x.ev || '').slice(0, 40) === String(c.ev || '').slice(0, 40); });
          if(dup) continue;
          lib.push({date: r.date || '未填', host: r.host, studio: r.studio || '', product: r.product || '', mod: c.mod || '', std: c.std || '', ts: c.ts || '', ev: c.ev || '', t: Date.now()});
          added++;
        }
        if(lib.length > 2000) lib = lib.slice(lib.length - 2000);
        if(added > 0){
          localStorage.setItem('grading_cases_lib_v1', JSON.stringify(lib));
          console.log('[v4.3] 优秀案例 +' + added + ' 条入库');
          try{ v4ArchRender('cases'); }catch(e){}
        }
      }
    }catch(e){ console.error('[v4.3] 优秀案例入库异常:', e); }
    return out;
  };
})();

// ---------- 7.8 v4.6 多表路由写入（一次评分 → 并行落多个 tab，单一 scoreEvent 数据源） ----------
// 明星主播固定名单（2026-08-28 老大确认）
var V4_STAR_HOSTS = ['宿浩淇', '苏蓬', '曲姝锜', '甘晋铭', '全程', '王菲'];
// 本地缓存 key 映射：侧边栏 key → localStorage 键
var V4_FS_LOCAL_KEY = {
  daily:    'v4_fs_daily_cache',
  week:     'v4_fs_week_cache',
  month:    'v4_fs_month_cache',
  weekstar: 'v4_fs_star_cache',
  top1:     'v4_fs_top1_cache'
};
// 日报表固定列（与飞书多维表格「主播日报」逐字对齐）；日报/周总结/月总结/明星主播 共用
var V4_FS_DAILY_COLS = ['日期','主播','直播间','综合评分','产品知识能力','逻辑组织能力(流畅度)','场景化表达能力(策展性)','可操作化运用','情绪感染能力'];
// 各 tab 的自定义固定列（未列出的 tab 一律用 V4_FS_DAILY_COLS）
var V4_FS_BASE_COLS = {
  top1: ['日期','主播','直播间','综合评分','等级','推荐标准','第二名','领先分差','参评人数','是否明星主播']
};

function v4IsStar(host){
  var h = String(host || '').trim();
  if(!h) return false;
  for(var i=0;i<V4_STAR_HOSTS.length;i++){ if(V4_STAR_HOSTS[i] === h) return true; }
  return false;
}
// ISO 周次：'2026-W35'（周一为一周起点）
function v4WeekKey(dateStr){
  var d = new Date(String(dateStr || '').replace(/-/g, '/') + ' 00:00:00');
  if(isNaN(d.getTime())) return '';
  var day = (d.getDay() + 6) % 7;            // 周一=0
  d.setDate(d.getDate() - day + 3);          // 移到本周四
  var firstThu = new Date(d.getFullYear(), 0, 4);
  var fday = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - fday + 3);
  var week = 1 + Math.round((d - firstThu) / (7 * 24 * 3600 * 1000));
  return d.getFullYear() + '-W' + (week < 10 ? '0' + week : week);
}
function v4MonthKey(dateStr){
  return v4NormDate(dateStr).m;
}
// 从评分结果构造标准行（各 tab 共用同一份 scoreEvent，避免列名漂移）
function v4ScoreRow(r, extra){
  var ms = {};
  var mods = (r && r.modules) || [];
  for(var i=0;i<mods.length;i++){ if(mods[i] && mods[i].key) ms[mods[i].key] = mods[i].score; }
  var row = {
    '日期':     (r.date || '未填'),
    '主播':     r.host,
    '直播间':   r.studio || '',
    '综合评分': r.total,
    '产品知识能力':         (typeof ms.c1 === 'number') ? ms.c1 : '',
    '逻辑组织能力(流畅度)':   (typeof ms.c2 === 'number') ? ms.c2 : '',
    '场景化表达能力(策展性)': (typeof ms.c3 === 'number') ? ms.c3 : '',
    '可操作化运用':           (typeof ms.c4 === 'number') ? ms.c4 : '',
    '情绪感染能力':           (typeof ms.c5 === 'number') ? ms.c5 : ''
  };
  if(extra){ for(var k in extra){ row[k] = extra[k]; } }
  return row;
}
// 通用 upsert：按 keyFields 组合去重（重评覆盖，不产生重复行）
function v4FsUpsert(lsKey, row, keyFields){
  var cache = v4ReadLS(lsKey, '[]');
  var dupIdx = -1;
  for(var i=0;i<cache.length;i++){
    var same = true;
    for(var f=0; f<keyFields.length; f++){
      if(String(cache[i][keyFields[f]] || '') !== String(row[keyFields[f]] || '')){ same = false; break; }
    }
    if(same){ dupIdx = i; break; }
  }
  if(dupIdx >= 0) cache[dupIdx] = row; else cache.push(row);
  if(cache.length > 3000) cache = cache.slice(cache.length - 3000);
  localStorage.setItem(lsKey, JSON.stringify(cache));
  return cache.length;
}
// 主路由：单次 / 批量每一位主播 的结果都走这里
function v4RouteScore(r){
  if(!r || typeof r.total !== 'number' || !r.host || r.host === '未识别') return;
  var date = r.date || '未填';
  var dedup = ['主播', '日期'];

  // ① 主播日报（始终写）
  v4FsUpsert(V4_FS_LOCAL_KEY.daily, v4ScoreRow(r), dedup);
  // ② 周总结（始终写，原始行 + ISO 周次列）
  v4FsUpsert(V4_FS_LOCAL_KEY.week, v4ScoreRow(r, {'周次': v4WeekKey(date)}), dedup);
  // ③ 月总结（始终写，原始行 + 月份列）
  v4FsUpsert(V4_FS_LOCAL_KEY.month, v4ScoreRow(r, {'月份': v4MonthKey(date)}), dedup);
  // ④ 明星主播 → 额外单独写一份到「周总结-明星主播」
  var star = v4IsStar(r.host);
  if(star) v4FsUpsert(V4_FS_LOCAL_KEY.weekstar, v4ScoreRow(r, {'周次': v4WeekKey(date)}), dedup);

  console.log('[v4.6] 评分已路由写入：' + r.host + ' ' + date +
              ' → 日报 / 周总结 / 月总结' + (star ? ' / 明星主播' : ''));
}

// 批量评分后：只把 TOP1 那一位写入「多主播TOP1评分」，其余不主动记录
(function(){
  if(typeof syncTop1ToFeishu !== 'function') return;
  var orig = syncTop1ToFeishu;
  window.syncTop1ToFeishu = function(results, top1){
    var out = orig.apply(this, arguments);
    try{
      if(!top1 || !top1.host || typeof top1.total !== 'number') return out;
      var valid = (results || []).filter(function(r){ return typeof r.total === 'number'; });
      var second = null;
      for(var i=0;i<valid.length;i++){
        if(valid[i] !== top1 && (!second || valid[i].total > second.total)) second = valid[i];
      }
      var criteria = [];
      try{
        var met = checkTop1Criteria(top1, valid);
        for(var j=0;j<met.length;j++) criteria.push(met[j].label);
      }catch(e){}
      var row = {
        '日期':         top1.date || '',
        '主播':         top1.host,
        '直播间':       top1.studio || '',
        '综合评分':     top1.total,
        '等级':         top1.grade || '',
        '推荐标准':     criteria.join('、') || '未满足任一推荐标准',
        '第二名':       second ? second.host : '',
        '领先分差':     second ? (Math.round((top1.total - second.total) * 10) / 10) : '',
        '参评人数':     valid.length,
        '是否明星主播': v4IsStar(top1.host) ? '是' : '否'
      };
      var n = v4FsUpsert(V4_FS_LOCAL_KEY.top1, row, ['主播', '日期']);
      // TOP1 若是明星主播 → 明星 tab 也补一份（幂等，与 ④ 去重键一致不会重复）
      if(v4IsStar(top1.host)){
        v4FsUpsert(V4_FS_LOCAL_KEY.weekstar, v4ScoreRow(top1, {'周次': v4WeekKey(top1.date || '')}), ['主播', '日期']);
      }
      console.log('[v4.6] TOP1 已写入本地：' + top1.host + '（' + top1.total + ' 分）→ 共 ' + n + ' 条');
    }catch(e){ console.error('[v4.6] TOP1 本地写入异常:', e); }
    return out;
  };
})();

// ---------- 7.7 飞书数据表内嵌渲染（v4.6：读本地同步产物 data/*.js，全程不跳转飞书） ----------
var V4_FS_NAMES = {daily:'主播日报', top1:'多主播TOP1评分', week:'周总结', weekstar:'周总结-明星主播', month:'月总结', reward:'激励记录', punish:'惩罚记录'};
var V4_FS_STATE = {key:'', table:null, columns:[], rows:[], syncedAt:''};
var V4_FS_PENDING = {};

// 以 <script src> 注入载入：file:// 双击打开也能用（fetch/XHR 在 file:// 会被 CORS 拦截）
// 默认即带时间戳：否则浏览器会缓存旧的 data/*.js，同步后不点「重新载入」就一直看到旧数据。
// 只在首次加载各表时各请求一次（v4FsEnsure 有内存缓存，切 tab 不会重复下载）。
var V4_FS_BUST = Date.now();
function v4FsScript(src){
  return new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = src + (V4_FS_BUST ? '?_=' + V4_FS_BUST : '');
    s.charset = 'utf-8';
    s.onload = function(){ if(s.parentNode) s.parentNode.removeChild(s); resolve(true); };
    s.onerror = function(){ if(s.parentNode) s.parentNode.removeChild(s); reject(new Error('load fail')); };
    document.head.appendChild(s);
  });
}
function v4FsPath(key){
  var base = localStorage.getItem('feishu_data_dir') || 'data';
  return String(base).replace(/\/+$/, '') + '/' + key + '.js';
}
function v4FsEnsure(key){
  window.V4FS = window.V4FS || {};
  if(window.V4FS[key]) return Promise.resolve(window.V4FS[key]);
  if(V4_FS_PENDING[key]) return V4_FS_PENDING[key];
  V4_FS_PENDING[key] = v4FsScript(v4FsPath(key)).then(function(){
    V4_FS_PENDING[key] = null;
    return window.V4FS[key] || null;
  })['catch'](function(){ V4_FS_PENDING[key] = null; return null; });
  return V4_FS_PENDING[key];
}
// 未同步时的引导空态（不跳转、不报错）
function v4FsNoData(key){
  var box = document.getElementById('v4arch-feishu');
  var st = document.getElementById('fsStatus');
  if(st) st.textContent = '暂无数据';
  if(!box) return;
  var name = esc(V4_FS_NAMES[key] || key);
  var tip;
  if(key === 'daily'){
    tip = '「主播日报」还没有评分数据。<br>操作方法：在左侧「<b>每日评分</b>」页上传视频 / 粘贴转写文本 → 填主播名 → 点「开始评分」。<br>评分完成后结果会<b>自动写入</b>本页，切回这里即可看到表格，无需任何额外操作。';
  }else if(key === 'week' || key === 'month'){
    tip = '「' + name + '」还没有评分数据。<br>每次评分（单主播 / 批量）都会<b>自动写入</b>本页，并自动带上' +
          (key === 'week' ? '「周次」（如 2026-W35）' : '「月份」（如 2026-08）') +
          '分组列，无需任何额外操作。';
  }else if(key === 'weekstar'){
    tip = '「' + name + '」只记录 <b>' + esc(V4_STAR_HOSTS.join('、')) + '</b> 这 6 位明星主播的评分。<br>给以上任一位评分后，结果会<b>自动单独写入</b>本页；其他主播不会写入这里（但仍会正常写入日报 / 周总结 / 月总结）。';
  }else if(key === 'top1'){
    tip = '「' + name + '」只在<b>批量评分</b>后记录当次 <b>TOP1</b> 那一位主播。<br>操作方法：左侧「<b>批量 TOP1</b>」页 → 上传多位主播的逐字稿 → 点「批量评分 · TOP1 评选」。<br>只有 TOP1 会记入本页，其余参评主播<b>不主动记录</b>在此（但仍会写入主播日报 / 周总结 / 月总结）。';
  }else{
    tip = '「' + name + '」还没有数据。<br>生成方法：在本机项目根目录双击运行 <b>同步飞书数据.bat</b>（首次运行会提示你填 <code>.env</code> 里的飞书 App ID / App Secret）。<br>同步完成后回到本页点「重新载入」即可看到表格。';
  }
  box.innerHTML = '<div class="fs-tip">' + tip + '</div>';
}
function v4FsShowSync(){
  var el = document.getElementById('fsSyncAt');
  if(el) el.textContent = V4_FS_STATE.syncedAt ? ('最近同步：' + V4_FS_STATE.syncedAt) : '';
}
function v4FeishuLoad(key){
  V4_FS_STATE.key = key;
  var box = document.getElementById('v4arch-feishu');
  var st = document.getElementById('fsStatus');
  var ttl = document.getElementById('fs-title');
  if(ttl) ttl.textContent = '飞书数据表 · ' + (V4_FS_NAMES[key] || key);
  if(box) box.innerHTML = '<div class="fs-meta">正在载入「' + (V4_FS_NAMES[key] || key) + '」…</div>';
  if(st) st.textContent = '载入中…';

  // ---- v4.6 本地快速通道：daily/week/month/weekstar/top1 均由评分自动写入，评完即见、零取数 ----
  var lsKey = V4_FS_LOCAL_KEY[key];
  if(lsKey){
    var localCache = v4ReadLS(lsKey, '[]');
    if(localCache && localCache.length > 0){
      // 本地缓存有数据 → 先渲染（即时响应），后台异步加载同步产物做 merge
      V4_FS_STATE.columns = v4FsCols(localCache, V4_FS_BASE_COLS[key] || V4_FS_DAILY_COLS);
      V4_FS_STATE.rows = localCache.slice().sort(dateDesc);
      V4_FS_STATE.syncedAt = '本地实时（最近一次评分自动写入）';
      if(st) st.textContent = '共 ' + localCache.length + ' 条（本地评分结果）';
      v4FsShowSync();
      v4FeishuRender();
      v4FsFillSel(key);
      // 后台加载 data/<key>.js 做合并（去重：以同步产物为准覆盖同 主播+日期）
      v4FsEnsure(key).then(function(synced){
        if(!synced || !synced.rows || !synced.rows.length) return;
        var merged = mergeDaily(localCache, synced.rows);
        V4_FS_STATE.columns = v4FsCols(merged, V4_FS_BASE_COLS[key] || V4_FS_DAILY_COLS);
        V4_FS_STATE.rows = merged;
        V4_FS_STATE.syncedAt = synced.syncedAt || '';
        if(st) st.textContent = '共 ' + merged.length + ' 条（本地+飞书已合并）';
        v4FsShowSync();
        v4FeishuRender();
      });
      return;
    }
    // 无本地缓存 → 走通用路径
  }

  return v4FsEnsure(key).then(function(d){
    if(!d || !d.ok){ v4FsNoData(key); return; }
    V4_FS_STATE.table = d.table || null;
    V4_FS_STATE.columns = d.columns || [];
    V4_FS_STATE.rows = d.rows || [];
    V4_FS_STATE.syncedAt = d.syncedAt || '';
    var n = (d.rows || []).length;
    if(st) st.textContent = '共 ' + n + ' 条' + (d.limited ? '（已达上限）' : '') + ' ｜ ' + (d.table && d.table.name ? d.table.name : '');
    v4FsShowSync();
    v4FeishuRender();
    v4FsFillSel(key);
  });
}
// 表选择器：读本地同步索引 data/_index.js，切到任一已同步的表
function v4FsFillSel(curKey){
  var sel = document.getElementById('fsTableSel');
  if(!sel) return;
  v4FsEnsure('_index').then(function(idx){
    if(!idx || !idx.tables || !idx.tables.length){ sel.style.display = 'none'; return; }
    sel.style.display = '';
    var h = '';
    for(var i=0;i<idx.tables.length;i++){
      var t = idx.tables[i];
      h += '<option value="' + esc(t.key) + '"' + (t.key === curKey ? ' selected' : '') + '>' + esc(t.name) + '（' + (t.count || 0) + '）</option>';
    }
    sel.innerHTML = h;
    sel.onchange = function(){
      var k = sel.value;
      try{ history.replaceState(null, '', '#/feishu?t=' + k); }catch(e){}
      v4FeishuLoad(k);
    };
  });
}
// 渲染：存在日期列 → 月/日归档索引；否则平铺表格
function v4FeishuRender(){
  var box = document.getElementById('v4arch-feishu');
  if(!box) return;
  var rows = V4_FS_STATE.rows, cols = V4_FS_STATE.columns;
  if(!rows.length){ box.innerHTML = '<div style="font-size:12px;color:var(--text3)">该表暂无记录</div>'; return; }
  // 找日期列：列名含"日期/周/月"或值匹配 YYYY-MM-DD
  var dateCol = '';
  for(var c=0;c<cols.length;c++){
    var nm = cols[c];
    if(/日期|^周|^月|时间/.test(nm)){ dateCol = nm; break; }
  }
  if(!dateCol){
    for(var c2=0;c2<cols.length;c2++){
      var v = String(rows[0][cols[c2]] || '');
      if(/^\d{4}-\d{1,2}-\d{1,2}/.test(v)){ dateCol = cols[c2]; break; }
    }
  }
  var h = '';
  if(dateCol){
    // 月→日 分组（v4NormDate 为全局函数，与归档查看器共用）
    var byMonth = {}, order = [];
    for(var i=0;i<rows.length;i++){
      var nd = v4NormDate(rows[i][dateCol]);
      var m = nd.m || '未填';
      var day = nd.d;
      if(!byMonth[m]){ byMonth[m] = {count:0, days:{}}; order.push(m); }
      byMonth[m].count++;
      if(day) byMonth[m].days[day] = (byMonth[m].days[day] || 0) + 1;
    }
    order.sort().reverse();
    var fk = 'feishu:' + (V4_FS_STATE.table ? V4_FS_STATE.table.table_id : '');
    var stt = V4ARCH[fk] = V4ARCH[fk] || {};
    if(!stt.month || byMonth[stt.month] === undefined) stt.month = order[0];
    var days = Object.keys(byMonth[stt.month].days).sort().reverse();
    if(!stt.day || (days.indexOf(stt.day) < 0 && stt.day !== 'all')) stt.day = days[0] || 'all';
    h += '<div class="arch-bar"><span class="arch-lb">月份</span>';
    for(var a=0;a<order.length;a++){
      h += '<button class="arch-chip' + (order[a] === stt.month ? ' on' : '') + '" data-fsm="' + fk + '" data-fsact="month" data-v="' + order[a] + '">' + order[a] + '（' + byMonth[order[a]].count + '）</button>';
    }
    h += '</div>';
    h += '<div class="arch-bar"><span class="arch-lb">日期</span>';
    h += '<button class="arch-chip' + (stt.day === 'all' ? ' on' : '') + '" data-fsm="' + fk + '" data-fsact="day" data-v="all">全月（' + byMonth[stt.month].count + '）</button>';
    for(var b=0;b<days.length;b++){
      h += '<button class="arch-chip' + (days[b] === stt.day ? ' on' : '') + '" data-fsm="' + fk + '" data-fsact="day" data-v="' + days[b] + '">' + days[b].slice(5) + '（' + byMonth[stt.month].days[days[b]] + '）</button>';
    }
    h += '</div>';
    var shown = rows.filter(function(x){
      var nd = v4NormDate(x[dateCol]);
      var m = nd.m || '未填';
      if(m !== stt.month) return false;
      if(stt.day === 'all') return true;
      return nd.d === stt.day;
    });
    // 按日期列降序排列（最新在前）
    shown.sort(function(a,b){
      var da = v4NormDate(a[dateCol]).d, db = v4NormDate(b[dateCol]).d;
      return (da < db ? 1 : (da > db ? -1 : 0));
    });
    h += v4FeishuTable(shown, cols, dateCol);
  } else {
    h += '<div style="font-size:11.5px;color:var(--text3);margin-bottom:6px">该表无日期列，按原始顺序平铺（共 ' + rows.length + ' 条）</div>';
    h += v4FeishuTable(rows, cols, '');
  }
  box.innerHTML = h;
}
// 飞书风格表格：粘性表头 + 首列冻结 + 斑马纹 + 数值右对齐 + 等级徽章
function v4FeishuTable(rows, cols, dateCol){
  if(!rows.length) return '<div class="fs-empty">无记录</div>';
  var h = '<div class="fs-wrap"><table class="fs-tbl"><thead><tr>';
  for(var c=0;c<cols.length;c++) h += '<th>' + esc(cols[c]) + '</th>';
  h += '</tr></thead><tbody>';
  for(var i=0;i<rows.length && i<500;i++){
    h += '<tr>';
    for(var c2=0;c2<cols.length;c2++){
      var raw = rows[i][cols[c2]];
      var v = (raw === undefined || raw === null) ? '' : String(raw);
      var isDate = (cols[c2] === dateCol);
      if(isDate && v.length > 10) v = v.slice(0,10);
      var cls = (!isDate && /^[+-]?\d+(\.\d+)?$/.test(v)) ? ' class="num"' : '';
      var gm = v.match(/^\s*([A-E])级?\s*$/);
      var cell;
      if(gm) cell = '<span class="fs-g g' + gm[1] + '">' + gm[1] + '</span>';
      else { cell = v4ExpandCell(v, 80); }
      h += '<td' + cls + ' title="' + esc(v).replace(/"/g, '&quot;') + '">' + cell + '</td>';
    }
    h += '</tr>';
  }
  return h + '</tbody></table></div>';
}
// 飞书页：索引切换 / 重新拉取 / 在飞书打开
document.addEventListener('click', function(ev){
  var t = ev.target;
  while(t && t !== document.body && !(t.getAttribute && t.getAttribute('data-fsact'))) t = t.parentNode;
  if(!t || t === document.body) return;
  var fk = t.getAttribute('data-fsm'), act = t.getAttribute('data-fsact'), v = t.getAttribute('data-v');
  if(act === 'month'){ V4ARCH[fk] = {month: v, day: null}; v4FeishuRender(); }
  else if(act === 'day'){ V4ARCH[fk].day = v; v4FeishuRender(); }
});
// 长文本展开/收起：独立监听，不并入上面的 data-fsact 冒泡查找
// （上面的 handler 会 while 上溯找 data-fsact，找不到就 return，塞进去永远是死代码）
document.addEventListener('click', function(ev){
  var t = ev.target;
  while(t && t !== document.body){
    if(t.getAttribute && t.getAttribute('data-action') === 'toggleExpand'){
      ev.preventDefault();
      ev.stopPropagation();
      var sp = t.parentNode;
      var s = sp.querySelector('.fs-short'), f = sp.querySelector('.fs-full');
      if(!s || !f) return;
      if(s.style.display === 'none'){
        s.style.display = ''; f.style.display = 'none'; t.textContent = '展开';
      } else {
        s.style.display = 'none'; f.style.display = 'inline'; t.textContent = '收起';
      }
      return;
    }
    t = t.parentNode;
  }
});
// 重新载入：清内存缓存 + 递增穿透参数，确保读到磁盘上刚同步出来的最新数据
function v4FsReload(){
  window.V4FS = window.V4FS || {};
  var k = V4_FS_STATE.key || (v4HashParts().params.t || 'daily');
  window.V4FS = {};
  V4_FS_PENDING = {};
  V4_FS_BUST = Date.now();
  v4FeishuLoad(k);
}

// ---- 日报专用工具 ----
// 飞书「主播日报」标准列序（与截图/多维表格完全对齐）
// 固定列在前，数据中多出的列追加在后（避免本地与飞书两侧列序漂移）
function v4FsCols(rows, fixed){
  if(!rows || !rows.length) return fixed.slice();
  var extra = {};
  rows.forEach(function(r){ Object.keys(r).forEach(function(k){ if(fixed.indexOf(k) < 0) extra[k] = 1; }); });
  return fixed.concat(Object.keys(extra));
}
function dailyCols(rows){ return v4FsCols(rows, V4_FS_DAILY_COLS); }
function dateDesc(a,b){ var da=String(a['日期']||''), db=String(b['日期']||''); return da>db?-1:da<db?1:0; }
// 合并：本地缓存（评分实时产生）+ 同步产物（飞书历史），以同步产物为准覆盖同(主播+日期)
function mergeDaily(local, synced){
  var map = {};
  synced.forEach(function(r){ var k = (r['主机']||r['主播']||'') + '|' + (r['日期']||''); map[k] = r; });
  local.forEach(function(r){
    var k = (r['主播']||'') + '|' + (r['日期']||'');
    if(!map[k]) map[k] = r; // 本地有、飞书没有 → 保留（可能是还没回写成功的新评分）
  });
  var out = [];
  for(var k in map) out.push(map[k]);
  return out.sort(dateDesc);
}
document.addEventListener('DOMContentLoaded', function(){
  var rb = document.getElementById('fsReloadBtn');
  if(rb) rb.onclick = function(){ v4FsReload(); };
});

// ---------- 8. 启动 ----------
(function(){
  var t = document.getElementById('tbToday');
  if(t) t.textContent = v4TodayStr() + ' · 工作台模式';
  v4Navigate();
  try{ v4ArchRender('golden'); }catch(e){}
  try{ v4ArchRender('history'); }catch(e){}
  try{ v4ArchRender('cases'); }catch(e){}
})();
