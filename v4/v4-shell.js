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
// ---------- v4.9.1：本地一体化工作台（8791）飞书写回端点接管 ----------
// app-core.js 在 host 为 127.0.0.1/localhost 时把 FEISHU_FILL_URL / FEISHU_SYNC_URL
// 默认指向 127.0.0.1:3712（v3 asr 端口）。本地一体化模式（本服务 8791）下 3712 未启
// → autoFillFeishu / syncFeishuLibs / syncWeekMonth 的 fetch 静默失败 → 主播日报漏写。
// 本模块纯加法覆盖：本地 http(s) 打开（非 3712 端口）→ 同源 /api/feishu-* →
// 由一体化服务代理转发云端 Vercel 函数（免跨域、不依赖 3712、双击即用）。
// localStorage.feishu_fill_url / feishu_sync_url 手动覆盖仍最优先。
(function(){
  try{
    if(typeof location === 'undefined' || typeof window === 'undefined') return;
    var isLocalHttp = (location.protocol === 'http:' || location.protocol === 'https:') &&
      (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
    if(!isLocalHttp) return;               // 线上 GitHub Pages / Vercel：走默认云端端点，不接管
    if(location.port === '3712') return;   // 直接由 v3 asr 服务托管页面：保持原样
    var base = location.origin;
    if(typeof FEISHU_FILL_URL !== 'undefined'){
      window.FEISHU_FILL_URL = localStorage.getItem('feishu_fill_url') || base + '/api/feishu-fill';
    }
    if(typeof FEISHU_SYNC_URL !== 'undefined'){
      window.FEISHU_SYNC_URL = localStorage.getItem('feishu_sync_url') || base + '/api/feishu-sync';
    }
    console.log('[v4.9.1] 本地一体化模式：飞书写回端点已接管 → fill=' + window.FEISHU_FILL_URL + ' sync=' + window.FEISHU_SYNC_URL);
  }catch(e){ console.log('飞书端点接管跳过:', e.message); }
})();
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
  // v4.8.10 关键：切到「问题库」页时主动重渲染，确保培训清单芯片一定生成
  // （app-core.js 初始化时用的是未打补丁的 renderProblemLib，不重渲染就没有芯片）
  if(key === 'problem'){
    try{ renderProblemLib(); }catch(e){}
    [300, 1000, 2500].forEach(function(d){
      setTimeout(function(){ try{ renderProblemLib(); }catch(e){} }, d);
    });
  }
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
  fetch(url, {signal: ctrl ? ctrl.signal : undefined}).then(function(resp){
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
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
    '工作台版本：<b>v4.7.9</b>（壳层）<br>' +
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
    // v4.10：历史评分明细行 = 摘要 + checkbox 展开「完整评分记录」（默认折叠，点开才显示）
    rows.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
    v4HisEnsureStyle();
    var hisDetN = 0, hisMissN = 0;
    h += '<div style="font-size:11px;color:var(--text3);margin-bottom:4px">点击行内「查看完整评分记录」展开该次评分的模块分卡与逐子点判定证据；再点收起</div>';
    for(var e2=0;e2<rows.length;e2++){
      var r = rows[e2];
      var det = v4DetailByTs(r.ts, r.host);   // v4.10.2：双键匹配（ts+host），防批量同 ts 错配
      var uid = 'v4his-' + String(r.ts) + '-' + e2;
      h += '<div class="v4his-row">'
        + '<input type="checkbox" class="v4his-tg" id="' + uid + '">'
        + '<div class="v4his-sum">'
        + '<span style="min-width:78px">' + esc(r.date || '—') + '</span>'
        + '<b style="min-width:64px">' + esc(r.host || '—') + '</b>'
        + '<span style="min-width:52px;color:var(--gold)"><b>' + r.total + '</b> 分</span>'
        + (r.c1Score !== null && r.c1Score !== undefined ? '<span style="font-size:11px;color:var(--text2);min-width:64px">c1 <b style="color:var(--ink)">' + r.c1Score + '</b></span>' : '')
        + (r.grade ? '<span style="font-size:10.5px;color:var(--text3);border:1px solid #e6ddc8;border-radius:4px;padding:0 4px">' + esc(r.grade) + '</span>' : '')
        + '<span style="font-size:11px;color:var(--text2);flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc((r.product || '—')) + '</span>'
        + '<label for="' + uid + '" class="v4his-lb">查看完整评分记录</label>'
        + '</div>'
        + '<div class="v4his-det">' + (det ? v4DetailHTML(det) : '<div class="v4his-none">该记录无完整明细存档（升级 v4.10 前产生的数据，需重新评分后才会沉淀逐子点证据）</div>') + '</div>'
        + '</div>';
      if(det) hisDetN++; else hisMissN++;
    }
    h += '<div style="margin-top:4px;font-size:11px;color:var(--text3)">完整存档 ' + hisDetN + ' 条 ｜ 仅摘要 ' + hisMissN + ' 条（v4.10 起每次评分自动沉淀完整明细）</div>';
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

// ---------- 7.10 v4.10 完整评分记录存档（历史 tab 行展开查看明细，B-双写一期本地） ----------
// 需求：历史评分每条可点开 → 查看完整评分记录（模块分卡 + 逐子点判定证据），默认折叠。
// 实现：grading_detail_v1 = [{ts, host, date, studio, product, total, grade, c1Score, semUsed, mods:[{key,name,score,stds:[{id,label,score,level,sem:{evs}}]}]}]
//       ts 与 grading_history_v1 摘要条目同源关联；快照在 v4.3 链 orig push 后落（唯一落库总闸）。
// 铁律：app-core.js 一字不动；全走 v4-shell 纯加法。
function v4SemMeta(state){
  switch(state){
    case 'HIT':     return {t:'达标', c:'#3d6b35', b:'#e8ece4'};
    case 'EQUIV':   return {t:'换说法达标', c:'#2f5f8f', b:'#e3edf7'};
    case 'NEGATE':  return {t:'讲错', c:'#b3452e', b:'#f6e3dd'};
    case 'UNCLEAR': return {t:'存疑待人工', c:'#9a7b2d', b:'#f6f0d8'};
    case 'MISS':    return {t:'未讲到', c:'#7d828b', b:'#eef0f3'};
    default:        return {t:String(state||'?'), c:'#7d828b', b:'#eef0f3'};
  }
}
function v4SemPointName(stdId, subId){
  try{
    var pid = String(subId || '').split('-')[1] || '';
    var V4SW = (typeof window.V4SEM === 'object') ? window.V4SEM : null;
    var def = V4SW ? (V4SW.POINTS[stdId] || V4SW.POINTS_22) : null;
    if(def && def.points){ for(var i=0;i<def.points.length;i++){ if(def.points[i].id === pid) return def.points[i].name; } }
  }catch(e){}
  return '';
}
// 压缩快照（quote 截 120 / reason 截 150，防 localStorage 膨胀；上限 300 条）
// v4.10.3：扩捕 weight/weighted/name/desc + 派生概要（核心优势/核心问题/最优能力/最弱能力/一句话总评）——对齐截图形态
function v4DetailSnapshot(r, ts){
  var mods = [];
  for(var mi=0; mi<(r.modules||[]).length; mi++){
    var m = r.modules[mi]; if(!m || !m.standards) continue;
    var sm = {key:String(m.key||m.id||''), name:String(m.name||m.title||m.key||''),
              score:(m.score!=null?m.score:null),
              weight:(m.weight!=null?m.weight:null),
              weighted:(m.weighted!=null?m.weighted:null),
              analyze:!!m.analyze, stds:[]};
    for(var si=0; si<m.standards.length; si++){
      var s = m.standards[si]; if(!s) continue;
      var ss = {id:String(s.id||''), label:String(s.label||s.name||''),
                name:String(s.name||s.label||''),
                desc:String(s.desc||''),
                score:(s.score!=null?s.score:null),
                level:(s.level!=null?s.level:null)};
      var sem = (s.complete && s.complete.sem) || null;
      if(sem && sem.evs && sem.evs.length){
        var evs = [];
        for(var ei=0; ei<sem.evs.length; ei++){
          var ev = sem.evs[ei] || {};
          evs.push({
            subId: String(ev.subId||''), state: String(ev.state||''),
            confidence: (ev.confidence!=null ? ev.confidence : null),
            quoteTs: String(ev.quoteTs||''),
            quote: String(ev.quote||'').slice(0,120),
            reason: String(ev.reason||'').slice(0,150)
          });
        }
        ss.sem = {passed: (sem.passed!=null?sem.passed:null), total: (sem.total!=null?sem.total:null), evs: evs};
      }
      sm.stds.push(ss);
    }
    mods.push(sm);
  }
  var c1Score = null;
  for(var k=0;k<mods.length;k++){ if(mods[k].key === 'c1'){ c1Score = mods[k].score; break; } }
  // 派生概要：对齐 app-core L615-634 / L658-663 公式（核心优势/问题 + 最优/最弱能力 + 一句话总评）
  var scored = mods.filter(function(x){ return (x.weight||0) > 0; });
  var sortedM = scored.slice().sort(function(a,b){ return (b.score||0) - (a.score||0); });
  var best = sortedM[0], worst = sortedM[sortedM.length-1];
  // 全局最强/最弱子标准（核心优势/核心问题）
  var bestStd = null, worstStd = null;
  for(var i=0;i<mods.length;i++) for(var j=0;j<mods[i].stds.length;j++){
    var s2 = mods[i].stds[j];
    if(!bestStd || (s2.score||0) > (bestStd.score||0)) bestStd = s2;
    if(!worstStd || (s2.score||0) < (worstStd.score||0)) worstStd = s2;
  }
  var strength = '';
  if(bestStd && (bestStd.score||0) >= 80) strength = bestStd.name + ' ' + bestStd.score + '分';
  else strength = (best ? best.name + ' ' + best.score + '分' : '—');
  var problem = (worstStd ? worstStd.name + ' ' + worstStd.score + '分' : '—');
  // 一句话总评：4 条件规则（app-core L658-663 同款）
  var tagline = '';
  var tot = r.total || 0, g = r.grade || '';
  if(best && (best.score||0) >= 75 && worst && (worst.score||0) <= 30) tagline = '「会讲产品，但还没形成完整成交闭环」——' + best.name + ' 明显强于 ' + worst.name;
  else if(worst && (worst.score||0) <= 30) tagline = '「' + worst.name + '是最大短板」——需优先补齐再谈整体提升';
  else if(tot >= 80) tagline = '「整体表现优秀，保持并精细化」';
  else tagline = '「整体处于' + g + '级，需按改进建议逐项训练」';

  return {ts: ts, host: r.host, date: String(r.date||'未填'), studio: String(r.studio||''), product: String(r.product||''),
          total: r.total, grade: String(r.grade||''), c1Score: c1Score,
          bestKey: best?best.key:null, worstKey: worst?worst.key:null,
          bestStdId: bestStd?bestStd.id:null, worstStdId: worstStd?worstStd.id:null,
          strength: strength, problem: problem, tagline: tagline,
          semUsed: !!(r.__sem && r.__sem.used), mods: mods,
          scoreType:r.scoreType || 'text',
          fullDaily:r.fullDaily ? JSON.parse(JSON.stringify(r.fullDaily,function(k,v){return k==='repB64'?undefined:v;})) : null};
}
// 落库（在 v4.3 链 orig push 摘要后调用；同 r 对象只存一次，防 renderResult 重入重复）
function v4DetailSave(r){
  try{
    if(!r || typeof r.total !== 'number' || !r.host || r.host === '未识别') return;
    if(r.__v410Saved) return;                                     // 同一评分对象只落一次
    var lib = v4ReadLS('grading_history_v1', '[]');
    var last = r.resultId ? lib.find(function(x){return x.resultId===r.resultId;}) : (lib.length ? lib[lib.length-1] : null);
    if(!last || String(last.host||'') !== String(r.host||'')) return;   // 摘要最后一条必须是本次，防批量错配
    var ts = (last.ts != null) ? last.ts : Date.now();
    // Mark saved only after storage succeeds.
    var det = v4DetailSnapshot(r, ts);
    var ds = v4ReadLS('grading_detail_v1', '[]');
    var dupIdx = -1;
    for(var i=0;i<ds.length;i++){ if(String(ds[i].ts) === String(ts) && ds[i].host === r.host && ds[i].date === String(r.date||'')){ dupIdx = i; break; } }
    if(dupIdx >= 0) ds[dupIdx] = det; else ds.push(det);
    if(ds.length > 300) ds = ds.slice(ds.length - 300);    // v4.10.1：上限 400 → 300（每条 detail ≈10-15KB，300 条 ≈3-4MB，留余量给摘要库 + golden/problems）
    localStorage.setItem('grading_detail_v1', JSON.stringify(ds));
    r.__v410Saved = true;
  }catch(e){ console.error('[v4.10] 完整评分记录存档异常:', e); r.__storageError='完整报告保存失败，请导出备份'; }
}
// 展开块样式（独立注入，不依赖 v4.9 闭包）
var _v4HisStyleInjected = false;
function v4HisEnsureStyle(){
  if(_v4HisStyleInjected) return;
  _v4HisStyleInjected = true;
  try{
    var st = document.createElement('style');
    st.textContent = '.v4his-row{border:1px solid #efe6d2;border-radius:6px;margin:5px 0;background:#fff}'
      + '.v4his-tg{display:none}'
      + '.v4his-sum{display:flex;align-items:center;gap:8px;font-size:12px;padding:6px 10px;flex-wrap:wrap}'
      + '.v4his-lb{margin-left:auto;cursor:pointer;color:#9a7b2d;font-size:11px;user-select:none;-webkit-user-select:none;white-space:nowrap}'
      + '.v4his-lb:hover{color:#c9a962}'
      + '.v4his-lb:before{content:"\\25B8  "}'
      + '.v4his-tg:checked ~ .v4his-sum .v4his-lb:before{content:"\\25BE  "}'
      + '.v4his-det{display:none;padding:8px 10px;border-top:1px dashed #efe6d2}'
      + '.v4his-tg:checked ~ .v4his-det{display:block}'
      + '.v4his-none{font-size:11px;color:#b0a48e}';
    document.head.appendChild(st);
  }catch(e){}
}
// 完整评分记录 HTML（存档 detail → 模块分卡 + 每子点判定证据）
function v4DetailHTML(det){
  if(det && det.fullDaily) return buildGptDailyHTML(det.fullDaily);
  // ---- v4.10.3：按截图样式重写（综合总分头 + 模块胶囊 + 子点判定三段卡）----
  var h = '';
  // ---- 顶部：综合总分头（截图"67/D级"大字号区）----
  var gCl = (det.grade === 'A' || det.grade === 'B') ? 'var(--gold)' : (det.grade === 'C' ? 'var(--warn)' : 'var(--danger)');
  h += '<div style="display:flex;gap:14px;align-items:flex-start;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">'
    + '<div style="text-align:center;flex:none">'
    + '<div style="font-size:34px;font-weight:800;color:' + gCl + ';line-height:1">' + (det.total || 0) + '</div>'
    + '<div style="font-size:10px;color:var(--text3);margin-top:2px">综合得分 / 100</div>'
    + '<div style="display:inline-block;margin-top:4px;padding:1px 8px;border-radius:10px;background:' + gCl + ';color:#fff;font-size:11px;font-weight:700">' + esc(det.grade || '') + ' 级</div>'
    + '</div>'
    + '<div style="flex:1;min-width:0;font-size:12px;line-height:1.75;color:var(--text1)">'
    + '<div style="font-weight:700;color:var(--ink);margin-bottom:4px">' + esc(det.host || '') + (det.studio ? ' · ' + esc(det.studio) : '') + (det.date ? ' · ' + esc(det.date) : '') + '</div>'
    + '<div><b style="color:var(--gold)">核心优势：</b>' + esc(det.strength || '—') + '</div>'
    + '<div><b style="color:var(--danger)">核心问题：</b>' + esc(det.problem || '—') + '</div>'
    + (det.bestKey ? '<div><b>最优能力：</b>' + esc(v4ModNameByKey(det.mods, det.bestKey) + ' ' + v4ModScoreByKey(det.mods, det.bestKey) + ' 分') + '</div>' : '')
    + (det.worstKey ? '<div><b>最弱能力：</b>' + esc(v4ModNameByKey(det.mods, det.worstKey) + ' ' + v4ModScoreByKey(det.mods, det.worstKey) + ' 分') + '</div>' : '')
    + '<div><b style="color:var(--gold)">一句话总评：</b>' + esc(det.tagline || '—') + '</div>'
    + '</div></div>';
  if(det.product) h += '<div style="font-size:11.5px;color:var(--text2);margin-bottom:6px">考核产品：<b style="color:var(--ink)">' + esc(det.product) + '</b> ｜ ' + (det.semUsed ? '<span style="color:#3d6b35;font-weight:700">语义判定</span>' : '<span style="color:#9a927f">关键词规则</span>') + '</div>';
  // ---- 模块胶囊区（截图"6+2 胶囊"三列布局）----
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">';
  for(var mi=0; mi<(det.mods||[]).length; mi++){
    var m = det.mods[mi]; if(!m) continue;
    var isAna = !(m.weight && m.weight > 0);
    var sc = (m.score != null ? m.score : 0);
    var scoreCl = isAna ? 'var(--text3)' : (sc >= 75 ? 'var(--ok)' : (sc < 45 ? 'var(--danger)' : 'var(--warn)'));
    h += '<div style="text-align:center;padding:6px 4px;border:1px solid ' + (isAna ? '#e8e3d3' : 'var(--border)') + ';border-radius:6px;background:' + (isAna ? '#f6f4ee' : '#fdfbf4') + '">'
      + '<div style="font-size:11px;color:var(--text2);line-height:1.2">' + esc(m.name || m.key || '') + '</div>'
      + '<div style="font-size:10px;color:var(--text3);margin-top:1px">' + (isAna ? '分析项' : ('权重 ' + m.weight + '%')) + '</div>'
      + '<div style="font-size:18px;font-weight:800;color:' + scoreCl + ';margin-top:2px">' + sc + '</div>'
      + '<div style="font-size:10px;color:var(--text3)">' + (isAna ? '不计入总分' : ('加权 ' + m.weighted)) + '</div>'
      + '</div>';
  }
  h += '</div>';
  // ---- 能力明细 + 子点判定三段卡（截图样式）----
  var any = false;
  for(var mi2=0; mi2<(det.mods||[]).length; mi2++){
    var m2 = det.mods[mi2]; if(!m2 || !m2.stds || !m2.stds.length) continue;
    any = true;
    var wLabel2 = (m2.weight && m2.weight > 0) ? ('权重 ' + m2.weight + '% · 能力分 ' + m2.score + ' · 加权 ' + m2.weighted) : '权重 0% · 只分析不计分';
    h += '<div style="margin-top:8px;padding:6px 8px;border:1px solid #efe6d2;border-radius:6px;background:#fdfbf4">'
      + '<div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:4px">' + esc(m2.name || m2.key || '') + ' <span style="font-weight:400;color:var(--text3);font-size:11px">· ' + wLabel2 + '</span></div>';
    for(var si=0; si<m2.stds.length; si++){
      var s = m2.stds[si];
      // 子点判定三态徽标（完成度 + 质量星 + 子点分）
      var evs = (s.sem && s.sem.evs) || [];
      var hitCnt = 0, missCnt = 0, totalKw = evs.length;
      for(var ei=0; ei<evs.length; ei++){
        var st = evs[ei].state;
        if(st === 'HIT' || st === 'EQUIV' || st === 'UNCLEAR') hitCnt++; else missCnt++;
      }
      var cmpN = totalKw ? (hitCnt + '/' + totalKw) : '—';
      var qCl = 'var(--text3)';
      if(totalKw) qCl = (hitCnt >= totalKw * 0.8) ? 'var(--ok)' : (hitCnt >= totalKw * 0.5 ? 'var(--warn)' : 'var(--danger)');
      var scCl = s.score != null ? (s.score >= 80 ? 'var(--ok)' : (s.score >= 45 ? 'var(--warn)' : 'var(--danger)')) : 'var(--text3)';
      var lvTxt = s.level != null ? ('Lv ' + s.level) : '—';
      h += '<div style="margin-top:6px;padding:5px 8px;background:#fff;border:1px solid #f1ebd9;border-radius:5px">'
        // 子点编号 + 子点名 + 三态徽标
        + '<div style="display:flex;align-items:center;gap:6px;font-size:11.5px;flex-wrap:wrap">'
        + '<span style="font-weight:700;color:#5a4632">' + esc(s.id || '') + '</span>'
        + '<span style="font-weight:600;color:var(--ink)">' + esc(s.name || s.label || '') + '</span>'
        + '<span style="display:inline-block;padding:0 5px;border-radius:3px;font-size:10px;background:' + qCl + ';color:#fff">完成度 ' + cmpN + '</span>'
        + '<span style="display:inline-block;padding:0 5px;border-radius:3px;font-size:10px;background:' + qCl + ';color:#fff">质量 ' + lvTxt + '</span>'
        + '<span style="display:inline-block;padding:0 5px;border-radius:3px;font-size:10px;background:' + scCl + ';color:#fff;font-weight:700">' + (s.score != null ? (s.score + ' 分') : '—') + '</span>'
        + '</div>';
      // 评判标准原句
      if(s.desc) h += '<div style="margin-top:3px;font-size:10.5px;color:var(--text2);line-height:1.5">评判标准：' + esc(s.desc) + '</div>';
      // ---- 命中区（HIT/EQUIV/UNCLEAR）----
      var hitRows = '';
      var missRows = '';
      for(var ei2=0; ei2<evs.length; ei2++){
        var ev2 = evs[ei2];
        var st2 = ev2.state;
        var meta = v4SemMeta(st2);
        var subNm = v4SemPointName(s.id, ev2.subId);
        var line = '<div style="display:flex;align-items:flex-start;gap:5px;padding:3px 0;line-height:1.5">'
          + '<span style="display:inline-block;padding:0 6px;border-radius:3px;font-size:10px;color:' + meta.c + ';background:' + meta.b + ';font-weight:700;flex:none">' + meta.t + '</span>'
          + '<span style="font-size:11px;color:var(--ink);flex:none">' + esc(ev2.subId || '') + (subNm ? ' ' + esc(subNm) : '') + '</span>'
          + (ev2.quoteTs ? '<span style="font-size:10px;color:#b0a48e;flex:none">[' + esc(ev2.quoteTs) + ']</span>' : '')
          + ((ev2.quote || ev2.reason) ? '<div style="flex:1;font-size:10.5px;color:var(--text2);line-height:1.5;margin-top:1px">'
            + (ev2.quote ? '<div style="color:#6b5b45">「' + esc(ev2.quote) + '」</div>' : '')
            + (ev2.reason ? '<div style="color:#9a927f">' + esc(ev2.reason) + '</div>' : '')
            + '</div>' : '')
          + '</div>';
        if(st2 === 'HIT' || st2 === 'EQUIV' || st2 === 'UNCLEAR') hitRows += line; else missRows += line;
      }
      if(hitRows){
        h += '<div style="margin-top:5px"><div style="font-size:10.5px;color:var(--gold);font-weight:700;margin-bottom:2px">命中（' + hitCnt + '）</div>' + hitRows + '</div>';
      }
      if(missRows){
        h += '<div style="margin-top:5px"><div style="font-size:10.5px;color:var(--danger);font-weight:700;margin-bottom:2px">未命中（' + missCnt + '）</div>' + missRows + '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
  }
  if(!any) h += '<div class="v4his-none">该记录无模块明细存档</div>';
  return h;
}
// 取 mod 名（按 key 查 det.mods）
function v4ModNameByKey(mods, key){
  if(!mods || !key) return '';
  for(var i=0;i<mods.length;i++){ if(mods[i] && mods[i].key === key) return mods[i].name || key; }
  return key;
}
// 取 mod 分（按 key 查 det.mods）
function v4ModScoreByKey(mods, key){
  if(!mods || !key) return '—';
  for(var i=0;i<mods.length;i++){ if(mods[i] && mods[i].key === key) return (mods[i].score != null ? mods[i].score : '—'); }
  return '—';
}
// 从 detail 库按 ts + host 双键取完整记录（无 → 返回 null）
// v4.10.2：仅按 ts 匹配在批量同毫秒场景会错配（两条摘要 ts 相同 → 返回第一条）→ 追加 host 校验
function v4DetailByTs(ts, host){
  try{
    var ds = v4ReadLS('grading_detail_v1', '[]');
    for(var i=0;i<ds.length;i++){
      if(String(ds[i].ts) === String(ts) && (!host || ds[i].host === host)) return ds[i];
    }
  }catch(e){}
  return null;
}
// patch clearHistoryLib：清摘要库时同步清明细库（防孤儿）
(function(){
  if(typeof clearHistoryLib !== 'function') return;
  var origCL = clearHistoryLib;
  window.clearHistoryLib = function(){
    var out = origCL.apply(this, arguments);
    try{ localStorage.removeItem('grading_detail_v1'); }catch(e){}
    return out;
  };
})();

// ---------- 7.6 优秀案例TOP3 本地沉淀（v4.3：包装 addHistoryRecord，评分时顺带存当日前3优秀案例） ----------
// 新键 grading_cases_lib_v1：{date, host, studio, product, mod, std, ts, ev}
(function(){
  if(typeof addHistoryRecord !== 'function') return;
  var orig = addHistoryRecord;
  window.addHistoryRecord = function(r){
    var out = orig.apply(this, arguments);
    try{
      // ---- v4.10：完整评分记录存档（grading_detail_v1，orig push 摘要后取最后一条 ts 关联）----
      try{ v4DetailSave(r); }catch(e){ console.error('[v4.10] v4DetailSave:', e); }
      // ---- v4.6：一次评分 → 路由写入多个 tab（主播日报 / 周总结 / 月总结 / 明星主播）----
      try{ v4RouteScore(r); }catch(e){ console.error('[v4.6] 评分路由写入异常:', e); r.__storageError='日报缓存保存失败，请导出备份'; }
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
    _updatedAt: r.updatedAt || new Date().toISOString(),
    _resultId: r.resultId || '',
    '评分类型': r.scoreType === 'full-daily' ? '完整日报' : '文本评分',
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
  if(dupIdx >= 0){
    cache=cache.filter(function(old){return !keyFields.every(function(k){return String(old[k]||'')===String(row[k]||'');});});
    cache.splice(Math.min(dupIdx,cache.length),0,row);
  }else cache.push(row);
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

// ---------- 7.9 修复周/月总结周次算错（v4.7.9）----------
// 引擎 syncWeekMonth() 用 new Date()（今天）算周次，而不是评分日期。
// 后果：补录历史评分时，记录会被归到"今天所在的周"，而评分实际属于另一周 → 周总结里查不到。
// 例：08-31 补录 08-27（周四）的评分，应归 08-24~08-30 周，却被算成 08-31~09-06 周。
// 修法：包装 autoFillFeishu 记下本次评分日期，再覆盖 syncWeekMonth 用它来算周/月。
var V4_LAST_SCORE_DATE = '';
(function(){
  if(typeof autoFillFeishu !== 'function') return;
  var orig = autoFillFeishu;
  window.autoFillFeishu = function(r){
    if(r && r.date && r.date !== '未填' && r.date !== '未识别') V4_LAST_SCORE_DATE = r.date;
    return orig.apply(this, arguments);
  };
})();
(function(){
  // 按本地时区解析 YYYY-M-D，避免 new Date('2026-08-27') 被当成 UTC 导致差一天
  function v4ParseDate(s){
    var p = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
  }
  window.syncWeekMonth = function(){
    try{
      var now = v4ParseDate(V4_LAST_SCORE_DATE) || new Date();
      var pad2 = function(n){ return String(n).padStart(2,'0'); };
      var fmt = function(d){ return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); };
      var day = (now.getDay() + 6) % 7;
      var monday = new Date(now); monday.setDate(now.getDate() - day);
      var sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      var wkStart = fmt(monday), wkEnd = fmt(sunday);
      var y = now.getFullYear(), m = now.getMonth() + 1;
      var monthStart = y + '-' + pad2(m) + '-01';
      var monthEnd = y + '-' + pad2(m) + '-31';
      var WM_URL = (typeof FEISHU_FILL_URL !== 'undefined' ? FEISHU_FILL_URL : '')
                     .replace('feishu-fill', 'feishu-week-month');
      if(!WM_URL) return;
      console.log('[v4.7.9] 周月汇总按评分日期 ' + (V4_LAST_SCORE_DATE || '(今天)') +
                  ' 计算：周 ' + wkStart + '~' + wkEnd + '，月 ' + monthStart);
      fetch(WM_URL, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({range:'week', start:wkStart, end:wkEnd})})
        .then(function(rs){ return rs.json(); }).then(function(j){
          if(j.ok && !j.empty) console.log('周总结已更新:', j.hosts, '主播');
        })['catch'](function(e){ console.log('周总结更新异常:', e.message); });
      fetch(WM_URL, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({range:'month', start:monthStart, end:monthEnd})})
        .then(function(rs){ return rs.json(); }).then(function(j){
          if(j.ok && !j.empty) console.log('月总结已更新:', j.hosts, '主播');
        })['catch'](function(e){ console.log('月总结更新异常:', e.message); });
    }catch(e){ console.log('syncWeekMonth 异常:', e.message); }
  };
})();

// 批量评分后：只把 TOP1 那一位写入「多主播TOP1评分」，其余不主动记录
(function(){
  if(typeof syncTop1ToFeishu !== 'function') return;
  var orig = syncTop1ToFeishu;
  window.syncTop1ToFeishu = function(results, top1){
    if((results || []).some(function(r){return r.__semCtx && !r.__semDone;})) return;
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
      var n = v4FsUpsert(V4_FS_LOCAL_KEY.top1, row, ['日期']);
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
var V4_FS_REQUEST_ID = 0;
function v4FeishuLoad(key){
  var requestId = ++V4_FS_REQUEST_ID;
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
        if(requestId !== V4_FS_REQUEST_ID || V4_FS_STATE.key !== key) return;
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
    if(requestId !== V4_FS_REQUEST_ID || V4_FS_STATE.key !== key) return;
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
// ---- v4.8.5 问题库培训清单：问题分布标签可点击展开 + 飞书数据兜底 ----
(function(){
  if(typeof renderProblemLib !== 'function') return;
  var _origPL = renderProblemLib;
  // 飞书问题类型 → 内部 category 映射
  var _TYPE_MAP = {
    '产品理解能力':'sellpoint_miss', '可视化道具运用':'sellpoint_miss',
    '场景化表达能力（延展性）':'sellpoint_miss', '卖点提炼能力':'sellpoint_miss',
    '情绪感染能力':'low_ability', '逻辑组织能力（流畅度）':'low_ability',
    '促单话术':'low_ability', '互动节奏':'low_ability'
  };
  function v4BuildMergedLib(_origGL){
    var lib = (typeof _origGL === 'function') ? _origGL() : [];
    var localKeys = {};
    for(var i=0;i<lib.length;i++) localKeys[lib[i].key] = 1;
    var feishuData = null;
    try { feishuData = (window.V4FS && window.V4FS['tbl_tblORA9bSl8M63EO']) ? window.V4FS['tbl_tblORA9bSl8M63EO'].rows : null; } catch(e) {}
    if(feishuData && feishuData.length){
      for(var j=0;j<feishuData.length;j++){
        var row = feishuData[j], fk = 'feishu_'+j;
        if(localKeys[fk]) continue;
        var typeStr = String(row['问题类型'] || '');
        lib.push({key:fk, host:row['主播']||'', cat:_TYPE_MAP[typeStr]||'baseline_error', text:row['问题描述']||'', date:row['日期']||'', priority:''});
      }
    }
    return lib;
  }
  // 关键：patch getProblemLib 让原版 renderProblemLib 就能读到合并数据
  if(typeof getProblemLib === 'function'){
    var _origGL = getProblemLib;
    window.getProblemLib = function(){ return v4BuildMergedLib(_origGL); };
  }
  // 多路重试：飞书数据是异步网络加载，单次 .then() 可能被后续渲染覆盖
  // 用多个时间点各试一次，确保增强最终一定生效
  var _retryDelays = [0, 120, 400, 900, 1800, 3500];
  function v4EnhanceWithRetry(){
    for(var i=0;i<_retryDelays.length;i++){
      (function(delay){
        setTimeout(function(){ try{ v4EnhanceTrainingTable(); }catch(e){} }, delay);
      })(_retryDelays[i]);
    }
  }
  window.renderProblemLib = function(){
    _origPL.apply(this, arguments);
    v4EnhanceWithRetry();
    // 同时监听飞书数据加载完成事件（如果数据尚未加载）
    var ensure = (typeof v4FsEnsure === 'function') ? v4FsEnsure : null;
    if(ensure){
      ensure('tbl_tblORA9bSl8M63EO').then(function(){ v4EnhanceWithRetry(); });
    }
  };
  function v4EnhanceTrainingTable(){
    var box = $('problemLibBlock'); if(!box) return;
    var tbls = box.querySelectorAll('table'), trainTbl = null;
    for(var ti=0;ti<tbls.length;ti++){
      var ths = tbls[ti].querySelectorAll('th'), hit = false;
      for(var tj=0;tj<ths.length;tj++){
        if(ths[tj].textContent.replace(/\s/g,'') === '问题分布'){ hit = true; break; }
      }
      if(hit){ trainTbl = tbls[ti]; break; }
    }
    if(!trainTbl) return;
    var lib = v4BuildMergedLib();
    var sum = (typeof summarizeProblems === 'function') ? summarizeProblems(lib) : null;
    if(!sum || !sum.byHost) return;
    var rows = trainTbl.querySelectorAll('tr');
    for(var ri=0;ri<rows.length;ri++){
      var cells = rows[ri].querySelectorAll('td');
      if(cells.length < 3) continue;
      var hn = cells[0].textContent.trim(), hd = sum.byHost[hn];
      if(!hd) continue;
      var distCell = cells[2], cats = Object.keys(hd.counts), html = '';
      for(var ci=0;ci<cats.length;ci++){
        var cat = cats[ci], cnt = hd.counts[cat];
        var catName = cat === 'sellpoint_miss' ? '讲品覆盖'
                     : cat === 'low_ability' ? '能力短板'
                     : cat === 'baseline_error' ? '信息准确性' : cat;
        var items = hd.items.filter(function(it){ return it.cat === cat; });
        var detail = items.map(function(it){
          return '<div style="padding:2px 0;line-height:1.6;font-size:11.5px;color:var(--text1)">· ' + esc(it.text || '') + '</div>';
        }).join('');
        html += '<span class="prob-chip" data-action="toggleProbDetail" style="display:inline-block;margin:2px 6px 2px 0;padding:2px 9px;border-radius:12px;font-size:11px;border:1px solid var(--gold);color:var(--gold);cursor:pointer;white-space:nowrap;transition:all .15s">' + esc(catName + '×' + cnt) + '</span>';
        html += '<div class="prob-detail" style="display:none;margin:6px 0 10px 12px;padding:8px 12px;background:var(--bg2);border-left:3px solid var(--gold);border-radius:0 4px 4px 0">' + detail + '</div>';
      }
      distCell.innerHTML = html;
    }
  }
})();
// 点击分类芯片 → 展开/收起该分类的具体问题描述（独立监听器，不并入死代码陷阱）
document.addEventListener('click', function(ev){
  var t = ev.target;
  while(t && t !== document.body){
    if(t.getAttribute && t.getAttribute('data-action') === 'toggleProbDetail'){
      ev.preventDefault(); ev.stopPropagation();
      var d = t.nextElementSibling;
      if(!d || !d.classList.contains('prob-detail')) return;
      if(d.style.display === 'none'){
        d.style.display = ''; t.style.background = 'var(--gold)'; t.style.color = '#fff';
      } else {
        d.style.display = 'none'; t.style.background = ''; t.style.color = 'var(--gold)';
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
  rows.forEach(function(r){ Object.keys(r).forEach(function(k){ if(k.charAt(0)!=='_' && fixed.indexOf(k) < 0) extra[k] = 1; }); });
  return fixed.concat(Object.keys(extra));
}
function dailyCols(rows){ return v4FsCols(rows, V4_FS_DAILY_COLS); }
function dateDesc(a,b){ var da=String(a['日期']||''), db=String(b['日期']||''); return da>db?-1:da<db?1:0; }
// 合并：本地缓存（评分实时产生）+ 同步产物（飞书历史），以同步产物为准覆盖同(主播+日期)
function mergeDaily(local, synced){
  var map = Object.create(null);
  function key(r){return JSON.stringify([r['主机']||r['主播']||'', r['日期']||'']);}
  synced.forEach(function(r){map[key(r)]=r;});
  local.forEach(function(r){
    var old=map[key(r)];
    // Undated snapshots cannot prove that they include this local revision.
    var remoteTime=old && Date.parse(old._updatedAt || '');
    var localTime=Date.parse(r._updatedAt || '');
    if(!old || !remoteTime || !localTime || localTime >= remoteTime) map[key(r)]=r;
  });
  return Object.keys(map).map(function(k){return map[k];}).sort(dateDesc);
}
document.addEventListener('DOMContentLoaded', function(){
  var rb = document.getElementById('fsReloadBtn');
  if(rb) rb.onclick = function(){ v4FsReload(); };
});

// =====================================================
// ---------- v4.11 语义判定适配器 ----------
// v4Evaluate 返回最终评分 Promise；不渲染、不落库、不发送飞书请求。
// workflow.js 负责任务归属、最终提交和页面状态；评分公式仍由 semantic-core 维护。
// =====================================================
(function(){
  if(typeof runGrading !== 'function' || typeof window.V4SEM !== 'object') return;

  var V4S = window.V4SEM;
  var _coreRunGrading = runGrading;              // app-core 原版（关键词引擎，唯一计分公式来源）

  // ---- 开关与 API 地址（设置页可覆盖；semantic_enabled='0' 关闭） ----
  function semEnabled(){
    try{ return localStorage.getItem('semantic_enabled') !== '0'; }catch(e){ return true; }
  }
  function semApiUrl(){
    // 本地化工作台自动指向：页面由本地一体化服务打开（127.0.0.1 / localhost）时，
    // 判定接口与页面同源 → 直接用 location.origin + /semantic-judge，无需手动配（仍允许 localStorage 手动覆盖）
    var h = '';
    try{ h = window.location.hostname; }catch(e){}
    if(h === '127.0.0.1' || h === 'localhost'){
      try{
        var ls = localStorage.getItem('semantic_api_url');
        if(ls) return ls;
      }catch(e){}
      return window.location.origin + '/semantic-judge';
    }
    try{ return localStorage.getItem('semantic_api_url') || V4S.CFG.apiUrl; }catch(e){ return V4S.CFG.apiUrl; }
  }

  window.runGrading = function(segs, productKey, options){
    var r = _coreRunGrading(segs, productKey);
    if(r && !r.noProduct && r.modules && semEnabled() && !(options && options.skipSemantic)){
      r.__semCtx={segs:segs || [], productKey:productKey, t:Date.now()};
    }
    return r;
  };
  window.v4Evaluate = async function(segs, productKey, job){
    var r=window.runGrading(segs,productKey);
    if(r.noProduct) return r;
    if(r.__semCtx) await semUpgrade(r,job);
    return r;
  };
  window.v4AttachSemanticEvidence=attachSemEvidence;

  // ---- 组装云端请求 ----
  function semPayload(segs, productKey){
    var judges = [];
    try{ judges = V4S.buildJudges(); }catch(e){}
    var text = '';
    try{ text = V4S.truncate(segs || []); }catch(e){}
    var prodName = '';
    try{
      if(typeof GRADING_STANDARD !== 'undefined' && GRADING_STANDARD.sellpoints && productKey && GRADING_STANDARD.sellpoints[productKey]){
        prodName = GRADING_STANDARD.sellpoints[productKey].name;
      }
    }catch(e){}
    return { product: prodName, judges: judges, text: text, _v: '4.9.0' };
  }

  // ---- 异步升级（防重入；超时/失败 → 降级保留关键词版） ----
  async function semUpgrade(r,job){
    var ctx=r.__semCtx, url=semApiUrl();
    var payload=semPayload(ctx.segs,ctx.productKey);
    V4Jobs.progress(job,'语义评分中…');
    try{
      if(!payload.text || !payload.judges.length) throw new Error('缺少有效逐字稿或判定标准');
      var data=await V4Jobs.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},job,V4S.CFG.timeoutMs || 25000);
      V4Jobs.assertActive(job);
      if(!data.evidences || !data.evidences.length) throw new Error('空判定结果');
      var app=V4S.apply(r,data);
      r.__sem={used:true,mode:'semantic',applied:app.applied,flags:app.flags,api:url,ms:Date.now()-ctx.t,judged:data.evidences.length};
    }catch(e){
      V4Jobs.assertActive(job);
      r.__sem={used:false,degraded:true,reason:e.message};
    }
    r.__semDone=true;
    return r;
  }

  // ---- 判定依据明细 v4.9.2：每张语义判定卡可展开查看逐子点证据（有依可寻） ----
  // 证据源：V4S.apply 覆写后 s.complete.sem = {mode,passed,total,full,half,states,evs}
  // evs 元素：{subId,state,confidence,quoteTs,quote,reason}（模型真实返回，逐条展示）
  var _semEvStyleInjected = false;
  var _semEvSeq = 0;       // v4.9.5：semEvTg id 唯一序号（批量两主播同 stdId 时避免 label for 错乱）
  function semEvEnsureStyle(){
    if(_semEvStyleInjected) return;
    _semEvStyleInjected = true;
    try{
      var st = document.createElement('style');
      st.textContent = '.semEvTg{display:none}'
        + '.semEvLb{display:block;cursor:pointer;font-size:11px;color:#9a7b2d;margin-top:6px;user-select:none;-webkit-user-select:none}'
        + '.semEvLb:hover{color:#c9a962}'
        + '.semEvLb:before{content:"\\25B8  "}'
        + '.semEvTg:checked + .semEvLb:before{content:"\\25BE  "}'
        + '.semEvBd{display:none;margin-top:6px;border:1px solid #efe6d2;background:#fdfbf4;border-radius:6px;padding:6px 10px}'
        + '.semEvTg:checked + .semEvLb + .semEvBd{display:block}'
        + '.semEvRow{font-size:11.5px;line-height:1.6;padding:4px 0;border-bottom:1px dashed #efe6d2;word-break:break-all}'
        + '.semEvRow:last-child{border-bottom:none}'
        + '.semEvTag{display:inline-block;padding:0 6px;border-radius:4px;font-size:10.5px;margin-right:6px;vertical-align:1px}'
        + '.semEvPt{font-weight:600;color:#5a4632;margin-right:8px}'
        + '.semEvTs{color:#b0a48e;font-size:10.5px;margin-left:4px}'
        + '.semEvQ{color:#6b5b45;display:block;margin-top:2px}'
        + '.semEvRs{color:#9a927f;font-size:10.5px;margin-top:1px}';
      document.head.appendChild(st);
    }catch(e){}
  }
  function semEvMeta(state){
    switch(state){
      case 'HIT':     return {t:'达标', c:'#3d6b35', b:'#e8ece4'};
      case 'EQUIV':   return {t:'换说法达标', c:'#2f5f8f', b:'#e3edf7'};
      case 'NEGATE':  return {t:'讲错', c:'#b3452e', b:'#f6e3dd'};
      case 'UNCLEAR': return {t:'存疑待人工', c:'#9a7b2d', b:'#f6f0d8'};
      case 'MISS':    return {t:'未讲到', c:'#7d828b', b:'#eef0f3'};
      default:        return {t:String(state||'?'), c:'#7d828b', b:'#eef0f3'};
    }
  }
  function semPointNameOf(stdId, pId){
    try{
      var def = V4S.POINTS[stdId] || V4S.POINTS_22;
      if(def && def.points){ for(var i=0;i<def.points.length;i++){ if(def.points[i].id === pId) return def.points[i].name; } }
    }catch(e){}
    return pId;
  }
  function semEvidenceHTML(s, sem){
    var stdId = String(s.id);
    var def = null;
    try{ def = V4S.POINTS[stdId] || (stdId === '2.2' ? V4S.POINTS_22 : null); }catch(e){}
    var order = [], seen = {};
    if(def && def.points){ for(var i=0;i<def.points.length;i++) order.push(def.points[i].id); }
    for(var e=0;e<(sem.evs||[]).length;e++){            // 兜底：def 未覆盖但模型判到的子点也列出
      var pid = String((sem.evs[e].subId || '').split('-')[1] || '');
      if(pid && order.indexOf(pid) < 0) order.push(pid);
    }
    var rows = '';
    for(var o=0;o<order.length;o++){
      var pId = order[o];
      if(seen[pId]) continue; seen[pId] = 1;
      var ev = null;
      for(var x=0;x<(sem.evs||[]).length;x++){ if(String(sem.evs[x].subId) === stdId + '-' + pId){ ev = sem.evs[x]; break; } }
      var st = ev ? ev.state : (sem.states ? (sem.states[pId] || 'MISS') : 'MISS');
      var meta = semEvMeta(st);
      var quote = (ev && ev.quote) ? ev.quote : '';
      var reason = (ev && ev.reason) ? ev.reason : (st === 'MISS' ? '未发现对应原句（模型未给出证据）' : '');
      var ts = (ev && ev.quoteTs) ? ev.quoteTs : '';
      var conf = (ev && ev.confidence != null) ? (' · 置信 ' + Math.round(Number(ev.confidence) * 100) + '%') : '';
      rows += '<div class="semEvRow">'
        + '<span class="semEvTag" style="color:' + meta.c + ';background:' + meta.b + '">' + meta.t + '</span>'
        + '<span class="semEvPt">' + stdId + '-' + pId + ' ' + esc(semPointNameOf(stdId, pId)) + '</span>'
        + ((ts || conf) ? '<span class="semEvTs">' + esc(ts) + conf + '</span>' : '')
        + (quote ? '<span class="semEvQ">「' + esc(quote) + '」</span>' : '')
        + (reason ? '<span class="semEvRs">' + esc(reason) + '</span>' : '')
        + '</div>';
    }
    if(!rows) return '';
    var subTxt = (sem.passed != null) ? ('通过 ' + sem.passed + '/' + sem.total + ' 子点达标') : ((sem.evs||[]).length + ' 条判定证据');
    var uid = String(stdId).replace('.', '-') + '-' + (++_semEvSeq);     // v4.9.5 加序号：批量两位主播卡 1.1 同 id 会让 label for 错乱 toggle 第一张
    return '<input type="checkbox" class="semEvTg" id="semEv-' + uid + '">'
      + '<label for="semEv-' + uid + '" class="semEvLb">查看判定依据（' + subTxt + '）—— 逐子点证据原文与判定理由</label>'
      + '<div class="semEvBd">' + rows + '</div>';
  }
  // 平铺单 r 的全部语义判定卡（r→module→standard 顺序）
  function semEvFlat(r){
    var out = [];
    if(!r || !r.modules) return out;
    for(var mi=0; mi<r.modules.length; mi++){
      var m = r.modules[mi]; if(!m || !m.standards) continue;
      for(var si=0; si<m.standards.length; si++){
        var s = m.standards[si];
        var sem = (s && s.complete && s.complete.sem) || null;
        if(!sem || !sem.evs || !sem.evs.length) continue;
        out.push({ stdId: String(s.id || ''), sem: sem });
      }
    }
    return out;
  }
  // 在 cards 范围内按 .std-id 精确匹配注入（不依赖 DOM 顺序 / 游标，杜绝跨主播错配）
  function semEvInject(cards, list){
    var injected = 0;
    if(!cards || !list || !list.length) return injected;
    for(var c=0; c<cards.length; c++){
      var idEl = cards[c].querySelector('.std-id');
      if(!idEl) continue;
      var cid = String(idEl.textContent || '').trim();
      if(!cid) continue;
      var item = null;
      for(var i=0; i<list.length; i++){ if(list[i].stdId === cid){ item = list[i]; break; } }
      if(!item) continue;
      var bd = cards[c].querySelector('.std-bd');
      if(!bd || bd.querySelector('.semEvLb')) continue;     // 防重复注入
      semEvEnsureStyle();
      var fakeS = { id: cid, complete: { sem: item.sem } };
      bd.insertAdjacentHTML('beforeend', semEvidenceHTML(fakeS, item.sem));
      injected++;
    }
    return injected;
  }
  // 批量（≥2 主播）：renderBatchCompare 按总分降序渲染每个 <details>（summary 含 host · total 分），
  // 用 summary 的 host+total 双键锚定对应 r，再在 details 范围内按 .std-id 注入 → 不受排序与残留卡干扰
  function semEvBatchAttach(results){
    var dets = document.querySelectorAll('#batchCompare details');
    if(!dets.length) return 0;
    var used = {};
    var totalInjected = 0;
    for(var d=0; d<dets.length; d++){
      var sm = dets[d].querySelector('summary');
      if(!sm) continue;
      var txt = sm.textContent || '';
      var host = String((txt.split('·')[0] || '')).trim();
      var totalEl = sm.querySelector('b');
      var total = totalEl ? parseFloat(String(totalEl.textContent || '').replace(/[^0-9.-]/g, '')) : NaN;
      var r = null;
      for(var i=0; i<results.length; i++){
        if(used[i] || !results[i]) continue;
        var hSame = (String(results[i].host || '').trim() === host);
        var tSame = isNaN(total) ? true : (Number(results[i].total) === total);
        if(hSame && tSame){ r = results[i]; used[i] = true; break; }
      }
      if(!r) continue;                       // details 无对应语义结果 → 跳过
      totalInjected += semEvInject(dets[d].querySelectorAll('.std'), semEvFlat(r));
    }
    return totalInjected;
  }
  function attachSemEvidence(rOrResults){
    if(!rOrResults) return;
    if(Array.isArray(rOrResults) && rOrResults.length > 1){
      try{ semEvBatchAttach(rOrResults); }catch(e){ console.error('[v4.9.4] batch attachSemEvidence:', e); }
      return;
    }
    var r = Array.isArray(rOrResults) ? rOrResults[0] : rOrResults;
    if(!r || !r.modules) return;
    var list = semEvFlat(r);
    if(!list.length) return;
    // 单条（每日评分 / 一键日报子结果）：全文档 .std 卡按 .std-id 精确匹配注入
    semEvInject(document.querySelectorAll('#singleReport .std'), list);
  }

  // ---- 状态条（常驻 #result 顶部） ----
  function semStatusText(msg, bg, color){
    try{
      var el = document.getElementById('semStatus');
      if(!el){
        var box = document.getElementById('result');
        if(!box) return;
        el = document.createElement('div');
        el.id = 'semStatus';
        el.style.cssText = 'font-size:12px;padding:5px 10px;border-radius:6px;margin:6px 0;display:none';
        box.insertBefore(el, box.firstChild);
      }
      if(msg){ el.style.display = 'block'; el.textContent = msg; }
      else { el.style.display = 'none'; return; }
      if(bg) el.style.background = bg;
      if(color) el.style.color = color;
    }catch(e){}
  }

  // 设置页回填 + 版本口径（v4.9）
  try{
    if(typeof v4RenderSettings === 'function'){
      var _origRS = v4RenderSettings;
      window.v4RenderSettings = function(){
        _origRS.apply(this, arguments);
        var box = document.getElementById('set-current');
        if(box){
          var extra = document.createElement('div');
          extra.style.marginTop = '6px';
          extra.innerHTML = '评分引擎：<b>语义判定 v4.9</b>（云端 ' + '<b>' + semApiUrl() + '</b>' + '）——关键词只做兜底降级<br>语义开关：' + (semEnabled() ? '<b style="color:var(--ok)">开</b>（评分按文字意思是否达标给分）' : '<b style="color:var(--danger)">关</b>（回退 v3.9 关键词引擎）');
          box.appendChild(extra);
        }
      };
    }
  }catch(e){}
})();

// ---------- 8. 启动 ----------
(function(){
  var t = document.getElementById('tbToday');
  if(t) t.textContent = v4TodayStr() + ' · 工作台模式';
  v4Navigate();
  try{ v4ArchRender('golden'); }catch(e){}
  try{ v4ArchRender('history'); }catch(e){}
  try{ v4ArchRender('cases'); }catch(e){}
  // v4.8.10 关键：app-core.js 先于 v4-shell.js 执行，页面初始化时调用的是「未打补丁」的
  // renderProblemLib，培训清单没有芯片。补丁生效后必须主动重渲染，否则
  // 「评分时能看到、刷新后消失」。延迟多点触发，规避初始化时序竞争。
  [0, 500, 1500, 3000].forEach(function(d){
    setTimeout(function(){ try{ renderProblemLib(); }catch(e){} }, d);
  });
})();

// ---------- 9. autoFillMeta 日期补零补丁（v4.11.1） ----------
// bug：文件名 2026.8.18-轻熟-赵亚男_原文.srt → autoDetectMeta 输出 meta.date = "2026-8-18"
//      （1 位月/日）→ <input type="date"> 只接受严格 YYYY-MM-DD（4-2-2），写入被静默拒绝
//      → toast 仍弹「已从文件名自动识别」，但日期框实际为空，用户误以为已填。
// 修复：monkey-patch autoFillMeta，orig 调用后重新解析文件名，把 1 位月/日规范化补零再写入
//      dateInput（不能在 orig 后回读 di.value——它已被 date input 静默清空，必须重算）。
// 铁律：纯壳层加法，app-core.js 一字不动。
(function(){
  try{
    var orig = window.autoFillMeta;
    if(typeof orig !== 'function') return;
    window.autoFillMeta = function(input){
      var ret = orig(input);
      try{
        if(!input || !input.files || !input.files[0]) return ret;
        var meta = (typeof window.autoDetectMeta === 'function') ? window.autoDetectMeta(input.files[0].name) : null;
        var di = document.getElementById('dateInput');
        if(meta && meta.date && di){
          var m = String(meta.date).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          if(m){
            var norm = m[1] + '-' + (m[2].length === 1 ? '0' + m[2] : m[2]) + '-' + (m[3].length === 1 ? '0' + m[3] : m[3]);
            di.value = norm;
          }
        }
      }catch(e){}
      return ret;
    };
  }catch(e){}
})();
