// =====================================================
// v4 工作台壳层（纯加法，不修改 app-core.js 任何逻辑）
// 职责：① hash 路由 ② 全局 JS 错误捕获条 ③ 工作台首页渲染
//       ④ 设置页（服务地址覆盖 / 版本口径 / 着装标准表）
// 数据读取：只读 localStorage 既有键（grading_history_v1 /
//           grading_v2_golden_lib / grading_problem_lib_v1）
// =====================================================

// ---------- 版本口径（唯一真源） ----------
// 铁律：界面上的版本号一律由本常量驱动，禁止再往 HTML 里写死一个字面量。
// 历史坑（v4.11.14 修）：v4/index.html 的 #pageBadge 从 v4.11.11 起就没人再改过，
//   v4.11.12 / v4.11.13 界面仍显示 v4.11.11 → 据此判断"包没更新"是错的
//   （2026-09-17 排查同事端降级问题时被它带偏过一次）。
// v4/index.html 里残留的静态字样只是 JS 完全失效时的兜底，运行时会立刻被下面覆盖。
var V4_VERSION = 'v4.11.52';
// v4.11.36：存档格式版本 ≠ 壳层版本。rawV 只在「rawTotal/rawPen/rawBlk 这套字段的形态真变」时才动，
//   **不跟 V4_VERSION 走**（否则每次改样式/改文案都要假装改了存档格式，溯源反而失真）。
//   ⚠️ 渲染侧从不读 rawV（write-only 溯源标记）；断言请读本常量，别跟 V4_VERSION 比。
var V4RAW_FMT = '4.11.35';
(function(){
  function paint(){
    ['pageBadge', 'brandVer', 'footVer'].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.textContent = V4_VERSION;
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();

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
  // 统计（只读 localStorage，与核心同键）· v4.11.8 起先按 主播+日期 去重再统计/展示
  var histRaw = v4ReadLS('grading_history_v1', '[]');
  var seen0 = {};
  var hist = [];
  histRaw.slice().sort(function(a,b){ return (b.ts||0)-(a.ts||0); }).forEach(function(x){
    var k = (x.host||'') + '|' + (x.date||'');
    if(seen0[k]) return;
    seen0[k] = 1; hist.push(x);
  });
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
  // 最近评分（最近 8 条 · 上面 hist 已按 主播+日期 去重）
  var box = document.getElementById('dash-recent');
  if(!hist.length){
    box.innerHTML = '暂无记录——去「每日评分」完成第一次评分（历史数据与 v3 共库，之前评过的直接可见）';
  } else {
    var recent = hist.slice(0, 8);
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
    '工作台版本：<b>' + V4_VERSION + '</b>（壳层）<br>' +
    '评分引擎：<b>v3.9</b>（app-core.js · 讲品窗口 20 分钟口径）<br>' +
    '转写模式：<b>异步任务 + 进度轮询</b>（长视频不再受 600 秒总闸限制，需引擎包 v1.2+）<br>' +
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
  // v4.11.8：历史评分按 主播+日期 去重（保留 ts 最新），与飞书历史表强一致口径对齐
  var hs = v4ReadLS('grading_history_v1', '[]');
  var seenH = {}, outH = [];
  hs.slice().sort(function(a,b){ return (b.ts||0)-(a.ts||0); }).forEach(function(x){
    var k = (x.host||'') + '|' + (x.date||'');
    if(seenH[k]) return;
    seenH[k] = 1; outH.push(x);
  });
  return outH;
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
        + '<div class="v4his-det">' + (det ? v4DetailHTML(det) : '<div class="v4his-none">该记录暂无完整报告。<b>完整报告功能于 v4.11.24（2026-09-23）上线</b>，此前的记录没有生成过报告、无法回填 —— 重新评分一次即可，评完立即全员可见。</div>') + '</div>'
        + '</div>';
      if(det) hisDetN++; else hisMissN++;
    }
    h += '<div style="margin-top:4px;font-size:11px;color:var(--text3)">可展开完整报告 ' + hisDetN + ' 条 ｜ 仅摘要 ' + hisMissN +
      ' 条' + (hisMissN ? '（仅摘要的多为 v4.11.24 上线前的历史记录，未生成过报告、无法回填）' : '') + '</div>';
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
// =====================================================
// v4.11.34→v4.11.35「不计违规项综合评分结果」—— 让被判 0 分的场次也能看到一整份真实讲解水平的评分结果
// 业务诉求（2026-10-13 老大，两轮）：
//   ① 「评分结果新增一个，不管违规项的给出一个得分结果」
//   ② 「理解错了，我要的是如果不管违规的规则，然后给出一个综合评分结果」
//      ⇒ v4.11.34 的「总分卡右侧并列小方块」形态被否 —— 要的是**一整份**结果，不是挂在 0 分旁边的数字。
//        v4.11.35 改为：独立成块（金边 · 与红线横幅分开）的完整结果卡 = 综合得分 + 等级 +
//        核心优势/核心问题 + 最优/最弱能力 + 一句话总评 + 模块加权明细 + 账目拆解 + 口径说明。
// 口径（老大 10-13 拍板 =「只撤整场归零」这一层；写死，**不参与任何判罚**）：
//   = **完全不做平台红线处置**时的总分，即 redlineApply 执行【之前】的 r.total；
//     也就是 app-core.js:574-581 的原公式（**一字未改**）：
//        总分 = Σ(模块能力分 × 权重%) − min(12, 信息准确性红旗处数 × 4)
//   ⚠️ 注意「信息准确性（违规项）」那 −4/处 仍在分里（老大选的就是只撤归零）；
//      因此块内**必须**把这一笔显式列出来，否则模块加权合计对不上总分（差 0～12）。
//   ⚠️ 它【不改变】本场 0 分判定：不写回 r.total / r.grade，不进摘要库、不写回任何**正式**评分字段。
//   v4.11.37 起：本值会以「78.5（精确）／55.5（上限值）」的形式**另存**于飞书独立列
//     「未记录 违规-综合评分」（见文件末尾 v4.11.37 块）；「综合评分」列仍为 0，判定不变。
//   v4.11.38 起：老记录也能精确复算（见下 ② 路）⇒ 「（上限值）」标记实际几乎不再出现，
//     仅在「既无原分留存、又取不到红旗处数」时兜底。
// 取数三条路（v4.11.38 起；精确优先，绝不拿反推值冒充精确值）：
//   ① 原始留存：`r.__redline.rawTotal`（v4.11.34 起在 redlineApply 入口捕获）→ 存档 det.rawTotal
//      配套 det.rawPen / det.rawBlk（v4.11.35 起）＝ 那一笔信息准确性红旗，用于账目式拆解
//   ② 精确复算（v4.11.38 新增）：Σ mods[weight>0].weighted − min(12, 处数×4)，处数取 v4RawBlk()
//      ⚠️ 关键：处数在 `det.extra.bl.errs` 里**自 extraV 4.11.22 起就一直在**（109/109 条实测都有）
//         ⇒ v4.11.34 之前的老记录也能把原分**精确**算回来，不必退化成「上限值」。
//         实测 45 条独立样本逐条闭合（38 条非判 0 的飞书「综合评分」＋ 7 条带 rawTotal 的判 0 场次），
//         复现脚本 = 仓库根 `_probe_raw_exact.py`（只读本地备份，输出 `_probe_raw_exact.out.txt`）。
//   ③ 反推上限（最后兜底）：Σ mods[weight>0].weighted —— 连处数都取不到时才用；
//      ⚠️ 它 = 原总分 + 那笔 0～12 分 ⇒ 是**上限**，必须带「反推上限值」标记。
// 渲染单一来源：`v4RawResultHTML(src, ctx)` —— 历史详情 / 当场报告 / GPT 完整日报三处**共用**，
//   禁止任何一处再手写一遍（v4.11.34 就是吃了这个亏：横幅一行小字 vs 详情小方块，两套形态）。
// 回退：localStorage `v4raw_enabled='0'`（或 V4RAW.off()）后刷新页面即恢复原状。
// =====================================================
function v4RawOn(){
  try{ return localStorage.getItem('v4raw_enabled') !== '0'; }catch(e){ return true; }
}
function v4RawGrade(t){
  var gs = null;
  try{ gs = (typeof GRADING_STANDARD !== 'undefined' && GRADING_STANDARD) ? GRADING_STANDARD.grades : null; }catch(e){}
  if(!gs || !gs.length) gs = [{name:'A',min:90},{name:'B',min:80},{name:'C',min:70},{name:'D',min:60},{name:'E',min:0}];
  for(var i=0;i<gs.length;i++){ if(t >= gs[i].min) return gs[i].name; }
  return 'E';
}
// ---- v4.11.38：「信息准确性红旗处数」取值 —— 把「反推上限」修正成「精确复算」的关键 ----
//   三处来源**同源**（app-core.js:497 `bl.errors` → :665 `r.baseline.errors` → 存档 det.rawBlk /
//   det.extra.bl.errs），按可信度排序取第一个拿到的：
//     ① det.rawBlk        —— v4.11.35 起与 rawTotal 同批沉淀（最权威）
//     ② r.baseline.errors —— 运行时结果对象上就有（当场报告走这条）
//     ③ det.extra.bl.errs —— extraV 4.11.22 起就有，**老存档也能拿到**（本回升级的主角）
//   ⚠️ 三者在同一场评分里是同一次计算的产物，已用 45 条独立样本逐条闭合验证（见 _probe_raw_exact.py）。
function v4RawBlk(x){
  try{
    if(!x) return null;
    if(typeof x.rawBlk === 'number') return x.rawBlk;
    if(x.baseline && typeof x.baseline.errors === 'number') return x.baseline.errors;
    var ex = x.extra;
    if(ex && ex.bl && typeof ex.bl.errs === 'number') return ex.bl.errs;
    return null;                     // 取不到 ⇒ 调用方退回「上限值」口径，绝不猜一个数
  }catch(e){ return null; }
}
// 那笔扣分：每处 −4、封顶 −12（与 app-core.js:579 同式，一字不差）
function v4RawPen(blk){ return (typeof blk === 'number') ? Math.min(12, blk * 4) : null; }
// 入参可以是运行时结果 r，也可以是存档记录 det
// 返回：{total, exact, grade, via, blk, pen}
//   via = 'stored'  原分直接留存（rawTotal）
//       | 'rebuilt' 用「模块加权 − 红旗扣分」精确复算（v4.11.38）
//       | 'derived' 只有模块加权 ⇒ 上限值
function v4RawScore(x){
  try{
    if(!x) return null;
    var t = null, exact = false, via = null;
    var blk = v4RawBlk(x), pen = v4RawPen(blk);
    if(x.__redline && typeof x.__redline.rawTotal === 'number'){ t = x.__redline.rawTotal; exact = true; via = 'stored'; }
    else if(typeof x.rawTotal === 'number'){ t = x.rawTotal; exact = true; via = 'stored'; }
    if(t == null){
      var mods = x.mods || x.modules || [], sum = 0, has = false;
      for(var i=0;i<mods.length;i++){
        var m = mods[i]; if(!m) continue;
        // ⚠️ 必须是 number 才累加：写成 `!= null` 的话，脏数据里 weighted='x' 会走字符串拼接
        //    （0 + 'x' = '0x'）⇒ Math.round('0x'*10) = NaN ⇒ 界面显示成空，比不显示更糟。
        if((m.weight || 0) > 0 && typeof m.weighted === 'number'){ sum += m.weighted; has = true; }
      }
      if(!has) return null;          // 无计权模块 ⇒ 无从反推，宁可不显示
      if(pen !== null){ t = sum - pen; exact = true; via = 'rebuilt'; }   // v4.11.38：精确复算
      else            { t = sum;                      via = 'derived'; }   // 兜底：上限值
    }
    var tot = Math.round(t * 10) / 10;
    if(tot < 0) tot = 0;             // 与 app-core `if(total < 0) total = 0` 同口径
    return { total: tot, exact: exact, grade: v4RawGrade(tot), via: via, blk: blk, pen: pen };
  }catch(e){ return null; }
}
// v4.11.40：「未记录 违规-综合评分」的**取值口径**（老大 2026-10-14 定稿）——
//   「综合评分」= 含平台红线处置后的最终分（判 0 就是 0）；
//   「未记录 违规-综合评分」= **完全不做红线处置**时的综合得分 ⇒ **任何场次都必须有值**：
//     · 判 0 场次 ⇒ 撤掉「整场归零」后的原分（0 分的同时看得到"本该得多少"）
//     · 非判 0 场次 ⇒ 与「综合评分」相同（红线没动分，app-core 原公式的结果就是它）
//   ⚠️ v4.11.37 初版只在判 0 时给值（理由：非判 0 写了是重复噪音）—— 该取舍**已作废**：
//      两列是**并列对照**关系，非判 0 留空会让看表的人误判成"漏填/没算"。
//   ⚠️ 本函数在**顶层**（v4ScoreRow 也要用）；下面 v4.11.37 块里的 FMT_EXACT/FMT_DERIVED
//      是同一个字面量但在 IIFE 内 ⇒ 改口径时两处必须同步（现已统一走本函数）。
function v4RawCellText(x){
  try{
    if(!x || typeof v4RawScore !== 'function') return '';
    var q = v4RawScore(x);
    if(!q || typeof q.total !== 'number') return '';
    return q.total + (q.exact ? '（精确）' : '（上限值）');
  }catch(e){ return ''; }
}
// ---- v4.11.35：「不计违规项综合评分结果」= 一整份结果块（历史详情 / 当场报告共用同一份）----
//  口径（老大 10-13 拍板）：**只撤「整场归零」这一步** —— 即 redlineApply 执行【之前】的 r.total，
//    也就是 app-core.js:574-581 的原公式（一字未改）：
//       总分 = Σ(模块能力分 × 权重%) − min(12, 信息准确性红旗处数 × 4)
//  ⚠️ 因此块内必须把「信息准确性红旗」那一笔显式列出来 —— 否则「模块加权合计」会对不上总分
//     （两者差 0～12）。这不是 bug，是口径本身如此。
//  入参 src 与 v4DetailSnapshot 返回同形：历史详情传 det，当场报告传 v4DetailSnapshot(r)。
function v4RawTagline(best, worst, tot, grade){
  if(best && (best.score||0) >= 75 && worst && (worst.score||0) <= 30)
    return '「会讲产品，但还没形成完整成交闭环」——' + best.name + ' 明显强于 ' + worst.name;
  if(worst && (worst.score||0) <= 30) return '「' + worst.name + '是最大短板」——需优先补齐再谈整体提升';
  if(tot >= 80) return '「整体表现优秀，保持并精细化」';
  return '「整体处于' + grade + '级，需按改进建议逐项训练」';
}
function v4RawResultHTML(src, ctx){
  try{
    if(!src || !v4RawOn()) return '';
    var q = v4RawScore(src);
    if(!q) return '';
    var mods = src.mods || [];
    var scored = [];
    for(var i=0;i<mods.length;i++){ if(mods[i] && (mods[i].weight||0) > 0) scored.push(mods[i]); }
    if(!scored.length) return '';
    var sorted = scored.slice().sort(function(a,b){ return (b.score||0) - (a.score||0); });
    var best = sorted[0], worst = sorted[sorted.length-1];
    var gCl = (q.grade === 'A' || q.grade === 'B') ? '#a8873f' : (q.grade === 'C' ? '#a8873f' : '#b0524c');
    // 模块加权合计：**不逐模块四舍五入**，与 app-core recompute 同口径（否则 8 个模块能差出 ±0.4）
    var sumRaw = 0;
    for(var j=0;j<scored.length;j++) sumRaw += (scored[j].score||0) * (scored[j].weight||0) / 100;
    sumRaw = Math.round(sumRaw * 10) / 10;
    // 一句话总评要用「无违规口径」的 total / grade 重算 —— 存档里的 tagline 是按 0 分/E 级写的，直接抄会自相矛盾
    var tg = v4RawTagline(best, worst, q.total, q.grade);
    var modLine = [];
    for(var k=0;k<scored.length;k++){
      modLine.push(esc(scored[k].name || scored[k].key || '') + ' ' + (scored[k].score||0) + '×' + (scored[k].weight||0) + '%');
    }
    // 头行：只拼「真的有值」的部分（主播 / 直播间 / 日期）；全空则整行不渲染
    // ⚠️ 别照抄总分卡的拼法（app-core 那处会留下一个孤零零的「 · 未填」悬空分隔符，真机上很难看）
    var metaParts = [];
    if(src.host) metaParts.push(esc(src.host));
    if(src.studio) metaParts.push(esc(src.studio));
    if(src.date && String(src.date) !== '未填') metaParts.push(esc(src.date));
    var metaLine = metaParts.length
      ? '<div style="font-weight:700;color:#3f3a33;margin-bottom:4px">' + metaParts.join(' · ') + '</div>'
      : '';
    // v4.11.38：q 里已带回 blk/pen（含从 det.extra.bl.errs 复算的那条路）⇒ 作为 src 字段的兜底
    var pen = (typeof src.rawPen === 'number') ? src.rawPen : ((q && typeof q.pen === 'number') ? q.pen : null);
    var blk = (typeof src.rawBlk === 'number') ? src.rawBlk : ((q && typeof q.blk === 'number') ? q.blk : null);
    var accLine = '';
    if(q.exact && pen !== null){
      accLine = '<div>账目：模块加权合计 <b>' + sumRaw + '</b>'
        + ' − 信息准确性红旗 <b>' + pen + '</b>'
        + (blk !== null ? '（<b>' + blk + '</b> 处 × −4，封顶 12）' : '')
        + ' = <b>' + q.total + '</b>'
        + ((sumRaw - pen < 0) ? '（已触底截为 0）' : '') + '</div>'
        + (q.via === 'rebuilt'
            ? '<div>取值：<b>精确值</b>（原分未单独留存，按存档「模块加权合计 − 信息准确性红旗」'
              + '精确复算 —— 与 app-core 原公式同式）</div>'
            : '');
    }else if(q.exact){
      accLine = '<div>取值：<b>精确值</b>（本场评分时留存，未拆出信息准确性红旗明细）</div>';
    }else{
      accLine = '<div>取值：<b>上限值</b>（本记录既无原分留存、也取不到信息准确性红旗处数，'
        + '只能按存档模块加权反推 —— 未扣那笔 0～12 分，所以真实值只会更低，不会更高）</div>';
    }
    return '<div class="v4raw-result" data-v4raw="1" style="border:1px solid #e6ddc8;border-left:4px solid #c9a962;'
      + 'background:#fdfbf4;border-radius:8px;padding:12px 14px;margin:10px 0;font-size:13px;line-height:1.7">'
      + '<div style="font-weight:600;color:#a8873f;margin-bottom:8px;overflow:hidden">'
      + '不计违规项综合评分结果'
      + '<span style="font-weight:400;color:#9a927f;font-size:12px"> —— 完全不做平台红线处置时的综合评分</span>'
      + (q.exact
          ? '<span style="float:right;font-weight:700;font-size:12px;color:#fff;background:#c9a962;'
            + 'border:1px solid #c9a962;border-radius:10px;padding:1px 9px;white-space:nowrap">精确值</span>'
          : '<span style="float:right;font-weight:700;font-size:12px;color:#b0524c;background:#fbf3f2;'
            + 'border:1px solid #b0524c;border-radius:10px;padding:1px 9px;white-space:nowrap">反推上限值</span>')
      + '</div>'
      + '<div style="display:flex;gap:14px;align-items:flex-start">'
      + '<div style="text-align:center;flex:none">'
      + '<div style="font-size:34px;font-weight:800;color:' + gCl + ';line-height:1">' + q.total + '</div>'
      + '<div style="font-size:10px;color:#9a927f;margin-top:2px">综合得分 / 100</div>'
      + '<div style="display:inline-block;margin-top:4px;padding:1px 8px;border-radius:10px;background:' + gCl
      + ';color:#fff;font-size:11px;font-weight:700">' + esc(q.grade) + ' 级</div>'
      + '</div>'
      + '<div style="flex:1;min-width:0;font-size:12px;line-height:1.75;color:#5c564e">'
      + metaLine
      + '<div><b style="color:#a8873f">核心优势：</b>' + esc(src.strength || '—') + '</div>'
      + '<div><b style="color:#b0524c">核心问题：</b>' + esc(src.problem || '—') + '</div>'
      + '<div><b>最优能力：</b>' + esc((best ? (best.name || best.key) : '—') + ' ' + (best ? (best.score||0) : 0) + ' 分') + '</div>'
      + '<div><b>最弱能力：</b>' + esc((worst ? (worst.name || worst.key) : '—') + ' ' + (worst ? (worst.score||0) : 0) + ' 分') + '</div>'
      + '<div><b style="color:#a8873f">一句话总评：</b>' + esc(tg) + '</div>'
      + '</div></div>'
      + '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e6ddc8;font-size:11.5px;color:#8b857c;line-height:1.7">'
      + '<div>模块加权：' + modLine.join(' · ') + '</div>'
      + accLine
      + '<div>口径：＝ <b>完全不做平台红线处置</b>时的综合评分结果，仅用于复盘主播真实讲解水平，'
      + '<b>不改变本场 0 分判定</b>，不写回「综合评分」等正式评分字段；'
      + '本值另存于飞书独立列「<b>未记录 违规-综合评分</b>」。</div>'
      + '</div></div>';
  }catch(e){ return ''; }
}

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

  // v4.11.34：只有「本场被红线判 0 / 模块判 0」时才沉淀原分（未判 0 时它等于 total，存了是噪音）
  var _rl = r.__redline || null;
  var _zeroed = !!(_rl && (_rl.sessionZero || _rl.moduleZero));
  var _raw = _zeroed ? v4RawScore(r) : null;
  // v4.11.35：把「信息准确性红旗」那一笔一并沉淀 ⇒ 「不计违规项综合评分结果」才能给出账目式拆解
  //   （模块加权合计 − min(12, 处数×4) = 原分；不存这笔，历史详情就只剩一个孤零零的总分，对不上模块加权）
  var _blErr = (r.baseline && typeof r.baseline.errors === 'number') ? r.baseline.errors : null;
  var _rawPen = (_raw && _raw.exact && _blErr !== null) ? Math.min(12, _blErr * 4) : null;

  return {ts: ts, host: r.host, date: String(r.date||'未填'), studio: String(r.studio||''), product: String(r.product||''),
          total: r.total, grade: String(r.grade||''), c1Score: c1Score,
          bestKey: best?best.key:null, worstKey: worst?worst.key:null,
          bestStdId: bestStd?bestStd.id:null, worstStdId: worstStd?worstStd.id:null,
          strength: strength, problem: problem, tagline: tagline,
          semUsed: !!(r.__sem && r.__sem.used), mods: mods,
          scoreType:r.scoreType || 'text',
          // v4.11.34：不计违规项得分（存档格式版本标记 = rawV，见 v4shell 头部注释；
          //   老存档无此字段 ⇒ 渲染侧回退「按模块加权反推」）
          rawTotal: _raw ? _raw.total : null,
          rawGrade: _raw ? _raw.grade : null,
          rawSrc:   _raw ? (_raw.exact ? 'exact' : 'derived') : null,
          rawV:     _raw ? V4RAW_FMT : null,
          rawPen:   _rawPen,
          rawBlk:   (_raw && _raw.exact) ? _blErr : null,
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
  // v4.11.35：GPT 风格完整日报（full-daily）也必须带上这一份结果 —— 否则「一键完整日报」的判 0 场次看不到，
  //   与 v4.11.34 同源的盲区（那块只挂在普通形态上）。
  if(det && det.fullDaily) return buildGptDailyHTML(det.fullDaily) + v4RawResultHTML(det, 'full');
  // ---- v4.10.3：按截图样式重写（综合总分头 + 模块胶囊 + 子点判定三段卡）----
  var h = '';
  // ---- 顶部：综合总分头（截图"67/D级"大字号区）----
  var gCl = (det.grade === 'A' || det.grade === 'B') ? 'var(--gold)' : (det.grade === 'C' ? 'var(--warn)' : 'var(--danger)');
  // ---- v4.11.35：只在「本场被红线判 0（或旧存档带 rawTotal）」时，于总分卡**下方**补一整份结果块 ----
  //   ⚠️ v4.11.34 那个「总分卡右侧并列小方块」已被老大否掉（他要的是**一整份**综合评分结果，
  //     不是挂在 0 分旁边的一个数字）⇒ 此处只留判定，渲染统一走 v4RawResultHTML；
  //     当场报告与历史详情必须永远同源，别再各写一套。
  var _detRL = det.redline || null;
  var _detZeroed = !!(_detRL && (_detRL.sessionZero || _detRL.moduleZero));
  var _wantRaw = v4RawOn() && (_detZeroed || typeof det.rawTotal === 'number');
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
  // ---- v4.11.35：一整份「不计违规项综合评分结果」紧随总分卡之后（与当场报告同一份 builder）----
  if(_wantRaw) h += v4RawResultHTML(det, 'history');
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
var V4_FS_DAILY_COLS = ['日期','主播','直播间','综合评分','产品知识能力','逻辑组织能力(流畅度)','场景化表达能力(延展性)','可视化道具运用','情绪感染能力','需求识别能力','临场反应能力','转化引导能力','改善建议'];
// =====================================================
// ---------- v4.11.48（2026-10-20）直播数据三列进「主播日报」 ----------
// 老大诉求：飞书「主播日报」新增 单小时GSV / 观看成交率 / 时均UV 三列，工作台要同步显示。
// 数据来源：飞书本身（sync_feishu.js 同步产物 v4/data/daily.js）—— 工作台不自己算，
//   与飞书同一份真相；这三列由 live-dashboard 侧回填（脚本 sync_live_metrics.py）。
// 口径（与 live-dashboard/trend.html 一致，写在这里备查）：
//   单小时GSV = (销售额 − 退款) / (时长分钟/60)   ← **净**销售/小时，不是 GMV
//   观看成交率 = 成交人数 / 观看人数              ← 一天多场先加总再算比率，不取平均
//   时均UV    = 观看人数 / (时长分钟/60)
// ⚠️ 绝不能加进共用的 V4_FS_DAILY_COLS —— 周总结/月总结/明星主播三张表没有这三列，
//   加进去会让它们各自多出三列空白（v4.11.40 已有同类注释）。
//   所以这里只给 daily 单开一份，且用 splice 插在「直播间」之后（不重抄整份数组，
//   V4_FS_DAILY_COLS 将来增列时日报会自动跟随）。
// 回退：删掉 V4_FS_BASE_COLS.daily 这一项即恢复原状（其余代码无需改动）。
// =====================================================
var V4_FS_LIVE_COLS = ['单小时GSV', '观看成交率', '时均UV'];
// 各 tab 的自定义固定列（未列出的 tab 一律用 V4_FS_DAILY_COLS）
var V4_FS_BASE_COLS = {
  daily: (function(){
    var a = V4_FS_DAILY_COLS.slice();
    var at = a.indexOf('直播间');
    a.splice(at + 1, 0, V4_FS_LIVE_COLS[0], V4_FS_LIVE_COLS[1], V4_FS_LIVE_COLS[2]);
    return a;
  })(),
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
function v4ScoreRow(r, extra, withRaw){
  var ms = {};
  var mods = (r && r.modules) || [];
  for(var i=0;i<mods.length;i++){ if(mods[i] && mods[i].key) ms[mods[i].key] = mods[i].score; }
  var row = {
    _updatedAt: r.updatedAt || new Date().toISOString(),
    _resultId: r.resultId || '',
    '日期':     (r.date || '未填'),
    '主播':     r.host,
    '直播间':   r.studio || '',
    '综合评分': r.total,
    '产品知识能力':         (typeof ms.c1 === 'number') ? ms.c1 : '',
    '逻辑组织能力(流畅度)':   (typeof ms.c2 === 'number') ? ms.c2 : '',
    '场景化表达能力(延展性)': (typeof ms.c3 === 'number') ? ms.c3 : '',
    '可视化道具运用':           (typeof ms.c4 === 'number') ? ms.c4 : '',
    '情绪感染能力':           (typeof ms.c5 === 'number') ? ms.c5 : '',
    '需求识别能力':           (typeof ms.c6 === 'number') ? ms.c6 : '',
    '临场反应能力':           (typeof ms.c7 === 'number') ? ms.c7 : '',
    '转化引导能力':           (typeof ms.c8 === 'number') ? ms.c8 : ''
  };
  // v4.11.40：本列与「综合评分」**并列写进日报本地行** ——
  //   ① 本地快速通道（v4FeishuLoad）在飞书数据到位前先渲染 localCache ⇒ 本地行不带这一列的话，
  //      首屏那一下这列是空的（要等 merge 完成才补上）；
  //   ② v4.11.11 版的 mergeDaily 在「本地 5 分钟内刚评」时让本地行**整行胜出** ⇒ 行本身必须带全字段。
  //   ⚠️ 只给**日报**加（withRaw=true）：周总结/月总结/明星主播三张表没有这一列，
  //      无差别加会让那三个 tab 各多出一列空的（它们共用 V4_FS_DAILY_COLS，动不得）。
  if(withRaw) row['未记录 违规-综合评分'] = v4RawCellText(r);
  // 改善建议（与后端 feishu-fill.js 同构：r.training ≤3 项聚合）
  if(r.training && r.training.length){
    var adv = r.training.slice(0,3).map(function(t){
      return (t.mod || '') + ' ' + (typeof t.score === 'number' ? t.score + '分' : '') + '：' + (t.gap || '') + (t.action ? '（' + t.action + '）' : '');
    }).filter(function(s){ return s.trim() !== '：'; }).join('；');
    if(adv) row['改善建议'] = adv.length > 300 ? adv.slice(0,300) + '...' : adv;
  }
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
  v4FsUpsert(V4_FS_LOCAL_KEY.daily, v4ScoreRow(r, null, true), dedup);
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
// v4.11.48：数值判定加白名单 —— 直播三列存的是文本（`6,912` / `1.08%`），
//   只认纯数字的正则会把它们当文本左对齐，与旁边的 `355` 参差不齐。
//   只对**白名单列**放宽（千分位 + 百分号），其余列仍按纯数字判定，避免把 `A/B`、`1-2` 之类误判成数字。
var V4_FS_NUM_COLS = { '单小时GSV': 1, '观看成交率': 1, '时均UV': 1 };
function v4IsNumCell(col, v){
  if(V4_FS_NUM_COLS[col]) return /^[+-]?[\d,]+(\.\d+)?%?$/.test(v);
  return /^[+-]?\d+(\.\d+)?$/.test(v);
}
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
      var cls = (!isDate && v4IsNumCell(cols[c2], v)) ? ' class="num"' : '';
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
// v4.11.39：个别额外列有**指定落位** —— 紧跟某个固定列之后，而不是被追加到最右侧。
//   老大 2026-10-14 指定：「未记录 违规-综合评分」紧跟「综合评分」（两列要能并排对比）。
//   ⚠️ 「综合评分」**不是首列**（前面还有日期/主播/直播间）⇒ 必须用 indexOf 求锚点下标，禁写死列号。
//   ⚠️ 若将来有多列锚定同一锚点，后插入的会排到前面 ⇒ 需改倒序/分组插入（当前只有一条映射）。
var V4_FS_AFTER = { '未记录 违规-综合评分': '综合评分' };
function v4FsCols(rows, fixed){
  if(!rows || !rows.length) return fixed.slice();
  var extra = {};
  rows.forEach(function(r){ Object.keys(r).forEach(function(k){ if(k.charAt(0)!=='_' && fixed.indexOf(k) < 0) extra[k] = 1; }); });
  var out = fixed.slice();
  Object.keys(extra).forEach(function(k){
    var anchor = V4_FS_AFTER[k];
    var at = anchor ? out.indexOf(anchor) : -1;
    if(at >= 0) out.splice(at + 1, 0, k);   // 指定落位：锚点后一位
    else out.push(k);                       // 其余额外列仍追加到末尾
  });
  return out;
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
    // ⚠️ v4.11.40 更正（原改动已回退）：**本函数不是实际生效的那个** ——
    //   v4.11.11 块（本文件靠后，`window.mergeDaily = function(...)`）在装载时把它整体覆盖，
    //   且语义完全不同：那边是「**飞书优先**，只有 5 分钟内刚评的本地行才覆盖」。
    //   因此这里**不需要**做"远端独有列补齐"：本地历史行的时间戳早已超出 grace ⇒ 飞书行胜出 ⇒
    //   飞书侧回填的值天然不会被本地空值盖掉（实测 ⑤c/⑤f，见 verify_rawcol_localrow.js）。
    //   保留本函数只为兜底（万一 v4.11.11 块没装载），故**与原实现逐字一致**，不做任何加工。
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
  // ============================================================
  // v4.11.17 平台红线（依据《抖音直播客观违规规则》，业务侧 2026-09-17 拍板口径）
  //   架构：与语义判定并列的**第二通道**，纯加法，app-core.js 一字不动。
  //     · 字面通道 v4/violation-rules.js + v4/violation-scan.js
  //       —— 确定性、零 token、可离线；"提到就判0分"本就是字面命中，不需要语义推理，
  //          且规避 DeepSeek 非确定性（实测同文本两次运行可能不同，temperature=0 也不保证）
  //     · 语义通道 V4S.apply 的 neg0（n1–n8）—— 覆盖表中"没有字面词"的类别
  //         （政治敏感／拉踩／侮辱用户／保价／诱导互动／绝对化）
  //   处置：SESSION_ZERO → 本场**总分归 0**（模块明细保留，仅供复盘）
  //        MODULE_ZERO  → 对应能力模块**归 0**，随后重算总分
  //        同场同时命中两级 → **取重**（整场归 0）
  //   ⚠️ 已知空转：模块 6/7/8 权重为 0，映射到它们的条目归 0 不改变总分（如实记录，不掩盖）
  //   回退：localStorage.setItem('redline_enabled','0') 一键关闭，无副作用。
  // ============================================================
  var REDLINE_DEFAULT = true;
  function redlineEnabled(){
    try{
      var v = localStorage.getItem('redline_enabled');
      if(v === '0') return false;
      if(v === '1') return true;
    }catch(e){}
    return REDLINE_DEFAULT;
  }

  function redlineZeroModule(r, modNum){
    var key = 'c' + modNum, n = 0;
    for(var i=0;i<r.modules.length;i++){
      var m = r.modules[i];
      if(!m || m.key !== key) continue;
      for(var j=0;j<(m.standards||[]).length;j++){ m.standards[j].score = 0; n++; }
      m.__redlineZero = true;
    }
    return n;
  }

  function redlineApply(r, segs){
    if(!r || r.noProduct || !r.modules) return r;
    if(!redlineEnabled()) return r;
    var S = window.V4ViolationScan;
    // v4.11.18（业务侧口径二次收紧）：字面通道的 GUARD 由"命中点 ±30 字窗口"改为**紧邻窗口** ——
    //   「行业第一」必须 4 字连写才判违规；只说"第一"、或只说"行业"，均不判。
    //   改动完全落在规则库 / 扫描器（两者 _v -> 1.0.2），**壳层判定逻辑未变**；
    //   此处记下两库版本号，便于线上出问题时一眼判断"规则库有没有读到"。
    // v4.11.19（业务侧三次拍板「B：诱导互动类也加语境必配」）：改动仍全部落在规则库/扫描器
    //   （两者 _v -> 1.0.3），**壳层判定逻辑一行未动**。三项变更：
    //     ① S1 第5类另 3 个裸词条 `点关注`/`评论区评论`/`行李牌字母` 加语境必配；
    //     ② 修正 `完全` 的语境白名单（移出口语搭配 `没问题|放心`）与 `公屏` 的过度提取；
    //     ③ 补 `百分百`（同 `100%`）、`最好` 的 `卖最好|卖最多` 豁免。
    //   ⚠️ 为什么非改不可 —— 用桌面 59 份真实逐字稿（8.13~9.15 / 105.7 万字，多主播多场次）实测：
    //      初版口径下 53 份场次有 **30 份（56.6%）会整场归 0**；上述三项修正后降到 **13 份（24.5%）**，
    //      且余下 13 份逐条核对**全部为真违规**（"全网最好的/吊打市面/完全不卡顿/完全不会爆开"）。
    //      不加约束则红线功能会把整场评分统一压成 0，8 个能力维度彻底失去区分度。
    // ---- v4.11.31（2026-09-30 业务侧三点拍板）—— 判定逻辑**一行未动**，改动全在规则库 ----
    //   ① 「没写的可以一律删除」  ⇒ 规则库按《抖音直播客观违规规则V3版.xlsx》全量重建（_v 3.0.0），
    //      表外 54 条旧词条不再判定（登记于 REMOVED_IN_V3）。典型：裸词 `质保`、拉踩 20 条锚点。
    //   ② 「这个是判罚标准」      ⇒ **全表取消分级**：Sheet1 原「一级/二级」与 Sheet2 原「高/中高」作废，
    //      命中任意一条 = SESSION_ZERO（整场 0）。⇒ Sheet2 由 47+123 拆分为 **170 条全整场 0**，
    //      `rel.moduleZero` 在本版**恒 false**（属预期，不是 bug）；红色横幅恒为一级形态。
    //   ③ 「给于编号」            ⇒ `reasons[].code` 携带规则编号（S1-01..S1-09 / S2-001..S2-170），
    //      横幅行首渲染为 `[S1-04] 极限词表达　触发词「行业第一」`，可回表核对。
    //   实测（48 份真实逐字稿 / 114.8 万字）：整场归 0 **29/48 (60.4%) → 37/48 (77.1%)**。
    var rel = { _v:'4.11.31', enabled:true, sessionZero:false, moduleZero:false,
                rulesV: (window.V4ViolationRules && window.V4ViolationRules._v) || '',
                scanV: (S && S._v) || '',
                reasons:[], modules:[], scan:null, err:'', guardBlocked:0, strict:false,
                // v4.11.34：「不计违规项得分」的唯一**精确**来源 —— 进入处置【之前】的 r.total。
                // 下面 step 3 会把 r.total 改成 0（sessionZero）；这里先把原分留档，别处一个字不动。
                rawTotal: (typeof r.total === 'number' ? r.total : null) };

    // ---- 1) 字面通道（确定性）----
    if(S && S.scan){
      try{
        var sc = S.scan(segs || []);
        rel.scan = (sc && sc.stat) ? sc.stat : null;
        // v4.11.17：语境约束的可观测性 —— 有多少处字面命中被"宣传语境必配"挡掉（业务可复核约束是否过宽）
        rel.guardBlocked = (sc && sc.stat && sc.stat.guardBlocked) || 0;
        rel.strict = !!(sc && sc.strict);
        if(sc && sc.ok){
          if(sc.sessionZero){
            rel.sessionZero = true;
            (sc.sessionHits||[]).forEach(function(h){
              // v4.11.31：带上规则编号（h.code，规则库 v3.0.0 起提供）⇒ 报告可「有依可寻」地引用条款
              rel.reasons.push({ src:'字面', cat:h.group, code:h.code||'', term:h.term, action:'SESSION_ZERO',
                                 ts:h.ts||'', quote:h.quote||'', count:h.count||1 });
            });
          }
          if(sc.moduleZero){
            rel.modules = (sc.modules||[]).slice();
            (sc.moduleHits||[]).forEach(function(h){
              rel.reasons.push({ src:'字面', cat:h.group, code:h.code||'', term:h.term, action:'MODULE_ZERO',
                                 mod:h.mod, ts:h.ts||'', quote:h.quote||'', count:h.count||1 });
            });
          }
        }else if(sc && sc.reason){ rel.err = String(sc.reason); }
      }catch(e){ rel.err = 'scan:' + (e && e.message); try{ console.warn('[v4.11.17] 红线字面扫描异常', e); }catch(_e){} }
    }else{ rel.err = 'violation-scan 未加载'; }

    // ---- 2) 语义通道：neg0（n1–n8）命中 → 均属 SESSION_ZERO 类别 ----
    try{
      var items = (r.baseline && r.baseline.items) || [];
      for(var i=0;i<items.length;i++){
        var f = String(items[i].field || '');
        if(f.indexOf('sem:neg:') !== 0) continue;
        rel.sessionZero = true;
        rel.reasons.push({ src:'语义', cat:f.slice(8), term:'', action:'SESSION_ZERO',
                           ts:(items[i].ev && items[i].ev.ts) || '',
                           quote:(items[i].ev && items[i].ev.ctx) || '' });
      }
    }catch(e){}

    // ---- 3) 执行处置 ----
    if(rel.modules.length){
      rel.moduleZero = true;
      var zeroed = 0;
      for(var k=0;k<rel.modules.length;k++) zeroed += redlineZeroModule(r, rel.modules[k]);
      rel.zeroedStandards = zeroed;
      try{ V4S.recompute(r); }catch(e){ try{ console.warn('[v4.11.17] recompute 异常', e); }catch(_e){} }
    }
    if(rel.sessionZero){
      // ⚠️ 必须在 recompute 之后执行，否则会被重算覆盖
      r.__redlineTotalBefore = r.total;
      r.total = 0;
      r.grade = 'E';
    }
    r.__redline = rel;
    try{
      console.log('[v4.11.17] 平台红线 sessionZero=' + rel.sessionZero + ' moduleZero=' + rel.moduleZero
        + ' 命中' + rel.reasons.length + '组' + (rel.err ? ' err=' + rel.err : ''));
    }catch(e){}
    return r;
  }
  window.v4RedlineApply = redlineApply;
  window.v4RedlineEnabled = redlineEnabled;

  // ---- 红线横幅（让"为什么 0 分"可见，避免用户以为系统坏了）----
  function redlineBanner(r, root){
    if(!r || !r.__redline) return 0;
    var rel = r.__redline;
    if(!rel.sessionZero && !rel.moduleZero) return 0;
    var host = root || document.getElementById('singleReport') || document.getElementById('result');
    if(!host) return 0;
    if(host.querySelector && host.querySelector('#redlineBanner')) return 0;
    var sess = !!rel.sessionZero;
    var acc = sess ? '#b0524c' : '#c9a962';
    var box = document.createElement('div');
    box.id = 'redlineBanner';
    box.style.cssText = 'border:1px solid ' + acc + ';border-left:4px solid ' + acc
      + ';background:' + (sess ? '#fbf3f2' : '#fbf8ef')
      + ';border-radius:8px;padding:12px 14px;margin:10px 0;font-size:13px;line-height:1.7';
    var h = '<div style="font-weight:600;color:' + acc + ';margin-bottom:6px">'
      + (sess ? '⚠️ 命中平台红线 —— 本场总分按 0 计' : '⚠️ 命中平台红线 —— 对应能力模块按 0 计') + '</div>';
    h += '<div style="color:#5c564e">';
    var shown = rel.reasons.slice(0, 8);
    for(var i=0;i<shown.length;i++){
      var x = shown[i];
      // v4.11.31：行首显示规则编号（如 [S1-04] / [S2-145]），便于回表核对
      h += '<div>· ' + (x.code ? '<span style="color:' + acc + ';font-weight:600">[' + esc(x.code) + ']</span> ' : '')
        + '<b>' + esc(x.cat) + '</b>'
        + (x.term ? '　触发词「<b>' + esc(x.term) + '</b>」' : '')
        + '　<span style="color:#8b857c">[' + esc(x.src) + '（'
        + (x.action === 'MODULE_ZERO' ? '模块归0' : '整场归0') + '）]</span>'
        + (x.ts ? ' <span style="color:#8b857c">' + esc(x.ts) + '</span>' : '')
        + (x.quote ? '<div style="color:#8b857c;font-size:12px;margin-left:12px">「' + esc(String(x.quote).slice(0, 90)) + '」</div>' : '')
        + '</div>';
    }
    if(rel.reasons.length > shown.length) h += '<div>· …另有 ' + (rel.reasons.length - shown.length) + ' 组命中</div>';
    h += '</div>';
    if(sess) h += '<div style="color:#8b857c;font-size:12px;margin-top:6px">模块明细仅供参考复盘，不计入总分。依据《抖音直播客观违规规则》。</div>';
    box.innerHTML = h;
    // v4.11.36：插横幅**之前**先记住主结论卡（= 0 分总分卡）——下方「不计违规项卡」要挂到它**之后**，
    //   而不是横幅之后（否则补充视角会跑到主结论前面）。⚠️ 必须在 insertBefore 之前取，插完 firstChild 就变成本横幅了。
    //   🔴 坑（真机实测出来的）：`#singleReport.firstChild` 往往是 index.html 缩进产生的**空白文本节点**，
    //     不是元素 ⇒ 若拿 firstChild.nextSibling 当锚点，结果卡会落进「横幅与主结论卡之间」（正好是要避免的旧顺序）。
    //     所以必须**跳过文本节点**，取第一个**元素**子节点。
    var _mainEl = null;
    for(var _n = host.firstChild; _n; _n = _n.nextSibling){ if(_n.nodeType === 1){ _mainEl = _n; break; } }
    try{ host.insertBefore(box, host.firstChild); }catch(e){ return 0; }
    // ---- v4.11.35：挂**一整份**「不计违规项综合评分结果」（与历史详情同一份 builder）----
    //   只在**整场判 0** 时挂：模块归 0 不整场归 0 时总分本就是原分，再挂一份是重复。
    //   ⚠️ 老板 10-13 明确否掉 v4.11.34 的「横幅里一行小字」形态；这里保持独立成块、金边、与横幅分开。
    //   v4.11.36 顺序变更：由「横幅之后」改为「0 分总分卡之后、模块明细之前」（老板 10-14 拍板）——
    //     主结论（0 分/E）在前、补充视角（不计违规项分）在后，符合阅读顺序。
    if(sess && v4RawOn()){
      try{
        var _detB = v4DetailSnapshot(r, Date.now());
        var _blk = v4RawResultHTML(_detB, 'daily');
        if(_blk){
          var _rb = document.createElement('div');
          _rb.className = 'v4raw-result-box';
          _rb.innerHTML = _blk;
          // 锚点 = 主结论卡的下一个兄弟；为 null（主结论卡是最后一个）时 insertBefore 等价 appendChild。
          // 下一个兄弟即使是空白文本节点也无妨：结果是「紧随主结论卡」。
          var _anchor = _mainEl ? _mainEl.nextSibling : null;
          host.insertBefore(_rb, _anchor);
        }
      }catch(e2){ console.error('[v4.11.35] raw result block:', e2); }
    }
    return 1;
  }
  window.v4RedlineBanner = redlineBanner;

  // 批量（≥2 主播）时的汇总横幅：逐条插会互相覆盖，改为在结果区顶部挂一条汇总
  function redlineBannerBatch(results){
    var hit = (results || []).filter(function(x){
      return x && x.__redline && (x.__redline.sessionZero || x.__redline.moduleZero);
    });
    if(!hit.length) return 0;
    var root = document.getElementById('result') || document.body;
    if(root.querySelector && root.querySelector('#redlineBanner')) return 0;
    var box = document.createElement('div');
    box.id = 'redlineBanner';
    box.style.cssText = 'border:1px solid #b0524c;border-left:4px solid #b0524c;background:#fbf3f2;'
      + 'border-radius:8px;padding:12px 14px;margin:10px 0;font-size:13px;line-height:1.7';
    var names = hit.map(function(x){
      return esc(x.host || '未识别') + (x.__redline.sessionZero ? '（整场0分）' : '（模块归0）');
    });
    box.innerHTML = '<div style="font-weight:600;color:#b0524c;margin-bottom:6px">⚠️ '
      + hit.length + ' 位主播命中平台红线</div><div style="color:#5c564e">' + names.join('　·　')
      + '</div><div style="color:#8b857c;font-size:12px;margin-top:6px">依据《抖音直播客观违规规则》；各主播明细见下方对应卡片。</div>';
    try{ root.insertBefore(box, root.firstChild); }catch(e){ return 0; }
    return 1;
  }
  // v4.11.17：一并导出，供端到端诊断/回归（此前只有 redlineBanner 导出，批量为闭包内部函数不可外部验证）
  window.v4RedlineBannerBatch = redlineBannerBatch;

  window.v4Evaluate = async function(segs, productKey, job){
    var r=window.runGrading(segs,productKey);
    if(r.noProduct) return r;
    if(r.__semCtx) await semUpgrade(r,job);
    redlineApply(r, segs);   // v4.11.17：红线在语义之后执行（语义可能补上 neg0 命中）
    return r;
  };
  window.v4AttachSemanticEvidence=attachSemEvidence;

  // ---- v4.11.50 品类作用域（2026-10-27）----
  // 问题：语义判定卡里的 neg（判错依据）原本**全部无差别下发**，而 1.1-c 结构部件那条整条是行李箱口径
  //   （「闭合拉链说成 SAB 即说错，本品为 YKK」）—— 而包袋正品拉链本来就是 SAB ⇒ 包袋场次讲对反被判错。
  // 修法（只在壳层；semantic-core.js 只新增 negScope 字段，判定逻辑本身未动）：
  //   按本场 productKey 的品类，把不属于该品类的 neg 从下发判据里去掉，**保留子点本身**
  //   （子点仍要判"有没有讲到"，只是不再拿别的品类的对错口径去判）。
  // 回滚阀：localStorage 置 v4cat3_enabled='0' 后刷新即恢复旧行为。
  function catScopeOn(){ try{ return localStorage.getItem('v4cat3_enabled') !== '0'; }catch(e){ return true; } }
  function catOfPk(productKey){
    try{
      var P = (typeof GRADING_STANDARD !== 'undefined' && GRADING_STANDARD.products) || {};
      return (P[productKey] && P[productKey].cat) || '';
    }catch(e){ return ''; }
  }
  function scopeJudges(judges, cat){
    if(!cat || !judges) return judges;
    var out = [];
    for(var i=0;i<judges.length;i++){
      var j = judges[i];
      if(!j || !j.points){ out.push(j); continue; }
      var pts = [];
      for(var k=0;k<j.points.length;k++){
        var p = j.points[k];
        var sc = p && p.negScope;
        if(!sc || sc === 'both' || sc === cat){ pts.push(p); continue; }
        var cp = {};
        for(var kk in p){ if(kk !== 'neg' && kk !== 'negScope') cp[kk] = p[kk]; }
        pts.push(cp);
      }
      out.push({ mod: j.mod, id: j.id, name: j.name, points: pts });
    }
    return out;
  }

  // ---- 组装云端请求 ----
  function semPayload(segs, productKey){
    var judges = [];
    try{ judges = V4S.buildJudges(); }catch(e){}
    try{ if(catScopeOn()) judges = scopeJudges(judges, catOfPk(productKey)); }catch(e){}
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
  // 诊断入口（不参与判定）：浏览器 console 可查"某品类实际下发哪些 neg 判据"
  window.v4CatScopeJudges = scopeJudges;
  window.v4CatOfPk = catOfPk;
  window.v4CatScopeOn = catScopeOn;

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
      try{ redlineBannerBatch(rOrResults); }catch(e){ console.error('[v4.11.17] batch redline banner:', e); }
      return;
    }
    var r = Array.isArray(rOrResults) ? rOrResults[0] : rOrResults;
    if(!r || !r.modules) return;
    // v4.11.17：红线横幅最先挂（即使无语义证据也要显示，故放在 semEvFlat 早退之前）
    try{ redlineBanner(r); }catch(e){ console.error('[v4.11.17] redline banner:', e); }
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

// ---------- v4.11.4：云端后端切换（GitHub Pages 线上默认端点） ----------
// 背景：ito-ai-grading.vercel.app 已配全飞书凭证 + FEISHU_TABLE_ID + DEEPSEEK key（2026-09-07），
// 且 api/feishu-fill.js 含 v4.11.3 的 c6-c7-c8 + 改善建议写入修复；cloud-five-pi 属别账号无法部署该修复。
// 本块纯加法：线上（非 file:/127.0.0.1/localhost）把 app-core 默认云端端点与 semantic-core 判定端点
// 切到 ito-ai-grading.vercel.app。localStorage 手动覆盖仍最优先——仅当值为空或仍指向旧 cloud-five-pi
// 时自动改写迁移（老浏览器存过旧值也能平滑切走，无需手动清 localStorage）。
(function(){
  try{
    if(typeof window === 'undefined' || typeof location === 'undefined') return;
    var h = '';
    try{ h = location.hostname; }catch(e){}
    var isLocal = (location.protocol === 'file:' || h === '127.0.0.1' || h === 'localhost');
    if(isLocal) return;               // 本地/8791 走既有 v4.9.1 接管块，不冲突
    var NEW_BASE = 'https://ito-ai-grading.vercel.app';
    function migrate(key, path){
      var v = null;
      try{ v = localStorage.getItem(key); }catch(e){}
      if(v === null || String(v).indexOf('cloud-five-pi') >= 0){
        var nv = NEW_BASE + path;
        try{ localStorage.setItem(key, nv); }catch(e){}
        return nv;
      }
      return String(v);               // 用户自定义非旧值 → 保留不动
    }
    var fill = migrate('feishu_fill_url', '/api/feishu-fill');
    var sync = migrate('feishu_sync_url', '/api/feishu-sync');
    if(typeof FEISHU_FILL_URL !== 'undefined') window.FEISHU_FILL_URL = fill;
    if(typeof FEISHU_SYNC_URL !== 'undefined') window.FEISHU_SYNC_URL = sync;
    if(typeof window.V4SEM === 'object' && window.V4SEM.CFG){
      var sem = migrate('semantic_api_url', '/api/semantic-judge');
      window.V4SEM.CFG.apiUrl = sem;
    }
    console.log('[v4.11.4] 云端后端切换生效 → fill=' + fill + ' sem=' + (window.V4SEM && window.V4SEM.CFG ? window.V4SEM.CFG.apiUrl : 'n/a'));
  }catch(e){ console.log('云端后端切换跳过:', (e && e.message) || e); }
})();

// ---------- v4.11.5：文件名自动识别修复（直播间简写 + 主播名剥离） ----------
// 背景：2026-09-07 实测「2026-08-26-曲姝锜-轻熟.mkv」→ app-core 的 autoDetectMeta 把直播间
// 简称「轻熟」误拼进主播名（host=「曲姝锜轻熟」），且直播间识别不到（原 studios 只给「云端」
// 配了简写别名），表单直播间留空 → 下拉框默认第一项「摩登新贵女」→ 飞书写回错主播/错直播间。
// 本块纯加法 monkey-patch：不改 app-core.js，仅覆盖 window.autoDetectMeta。
(function(){
  try{
    if(typeof window === 'undefined' || typeof window.autoDetectMeta !== 'function') return;
    var origDetect = window.autoDetectMeta;
    // 直播间简称 → 全名（与文件命名约定「日期-主播-直播间简称」对齐，如 -轻熟- / -摩登-）
    var STUDIO_ALIASES = [
      {full:'轻熟质享客', shorts:['轻熟','轻熟质享客']},
      {full:'摩登新贵女', shorts:['摩登','摩登新贵女']},
      {full:'云端商务家', shorts:['云端','云端商务家']},
      {full:'综合',       shorts:['综合']}
    ];
    window.autoDetectMeta = function(filename){
      var meta = origDetect.call(this, filename);
      if(!meta) meta = {studio:'', host:'', date:''};
      var base = String(filename || '').replace(/\.[^.]*$/, '');
      // 1) 直播间兜底：原识别留空时按简称（含完整名）再匹配
      if(!meta.studio){
        for(var i=0;i<STUDIO_ALIASES.length;i++){
          for(var j=0;j<STUDIO_ALIASES[i].shorts.length;j++){
            if(base.indexOf(STUDIO_ALIASES[i].shorts[j]) >= 0){ meta.studio = STUDIO_ALIASES[i].full; break; }
          }
          if(meta.studio) break;
        }
      }
      // 2) 主播名清洗：把误拼进主播字段的直播间简称剥掉（曲姝锜轻熟 → 曲姝锜）
      if(meta.host){
        var cleaned = meta.host;
        var hit = '';
        for(var k=0;k<STUDIO_ALIASES.length;k++){
          for(var s=0;s<STUDIO_ALIASES[k].shorts.length;s++){
            var sh = STUDIO_ALIASES[k].shorts[s];
            if(sh.length >= 2 && cleaned.indexOf(sh) >= 0 && cleaned !== sh){ hit = sh; break; }
          }
          if(hit) break;
        }
        if(hit) cleaned = cleaned.split(hit).join('');
        cleaned = cleaned.replace(/[^一-龥]/g, '');
        if(cleaned && cleaned.length >= 1 && cleaned.length <= 5){
          meta.host = cleaned;
        } else {
          // 剥空/超长/含非中文 → fallback 重新提（fallback 取最长连续中文段，天然排除短简称）
          var fb = '';
          try{ if(typeof fallbackHostFromFile === 'function') fb = fallbackHostFromFile(base); }catch(e){}
          if(fb) meta.host = fb;
        }
      }
      return meta;
    };
    console.log('[v4.11.5] autoDetectMeta 已接管：直播间简写兜底 + 主播名剥离');
  }catch(e){ console.log('[v4.11.5] 识别接管跳过:', (e && e.message) || e); }
})();

// ---------- v4.11.7：自动识别主品判定接管（段归属 + name/aliases 强信号 + 跨品共词去权） ----------
// 背景：v4.11.6 部署后甘晋铭讲 TRUFFLE PRO BACKPACK 仍被识别为 PISTACHIO Plus。
// 根因：truffle_pro_backpack 的 productExclusive 词表是空的（v4.11.6 "真·独家词" 永远 0 分），
// 只能拼卖点词×1，但 pistachio_plus 7 个卖点 vs truffle 卖点命中数仍胜出。
// v4.11.7 强化：把 product.name 全名命中（×100）+ aliases 命中（×50）作为强归属信号。
// 只要 transcript 出现「TRUFFLE PRO BACKPACK」/「双肩包」等 aliases，该段就强归 Truffle。
// 段归属计分公式：
//   product.name 全名匹配 ×100 + aliases 命中 ×50 + 真·独家专属词 ×10 + 卖点词 ×1
// 段归属最高分品 → 主品 = 归属段累计字符数最多。
(function(){
  try{
    if(typeof window === 'undefined' || typeof window.runGrading !== 'function') return;
    if(typeof GRADING_STANDARD === 'undefined' || !GRADING_STANDARD) return;

    // 预计算：每品的「真·独家专属词」（该词不出现在其他品的 name/aliases/卖点词/专属词表）
    function v4BuildExclPool(){
      var STD = GRADING_STANDARD;
      var keys = Object.keys(STD.products || {});
      if(!keys.length) return null;
      var exclMap = {};
      for(var i=0;i<keys.length;i++){
        var k = keys[i];
        exclMap[k] = (STD.productExclusive && STD.productExclusive[k]) || [];
      }
      // usedBy: 词 w 出现在哪些品的任意词典（专属词表 / 卖点 keywords / aliases / name）
      function usedBy(w){
        var owners = [];
        for(var a=0;a<keys.length;a++){
          var k2 = keys[a];
          var hit = false;
          if(!hit && (exclMap[k2]||[]).indexOf(w) >= 0) hit = true;
          if(!hit && STD.sellpoints && STD.sellpoints[k2] && STD.sellpoints[k2].list){
            for(var b=0;b<STD.sellpoints[k2].list.length;b++){
              if((STD.sellpoints[k2].list[b].keywords||[]).indexOf(w) >= 0){ hit = true; break; }
            }
          }
          if(!hit && STD.products[k2]){
            var al = STD.products[k2].aliases || [];
            if(al.indexOf(w) >= 0 || STD.products[k2].name === w) hit = true;
          }
          if(hit) owners.push(k2);
        }
        return owners;
      }
      var pool = {};
      for(var c=0;c<keys.length;c++){
        var k3 = keys[c];
        pool[k3] = [];
        for(var d=0;d<exclMap[k3].length;d++){
          var w = exclMap[k3][d];
          if(!w) continue;
          // 转写文本为小写场景：词统一小写比
          var wl = String(w).toLowerCase();
          if(usedBy(w).length <= 1) pool[k3].push(wl);
        }
      }
      return pool;
    }

    // 段归属主品判定
    // v4.11.7 强化：加 product.name 全名命中 ×100 + name 括号内中文别名命中 ×200 + aliases 命中 ×50
    // 关键修复：truffle_pro_backpack.name = "TRUFFLE PRO BACKPACK（双肩包）" ——「双肩包」藏括号内
    // 但 truffle.aliases 列表里没有单独的「双肩包」词，v4.11.6 漏了 → 加 name 括号内中文提取
    function v4AutoProductKey(segs){
      try{
        var STD = GRADING_STANDARD;
        var pool = v4BuildExclPool();
        if(!pool) return '';
        var keys = Object.keys(STD.products || {});
        if(!keys.length) return '';
        var hostChars = {};
        for(var i=0;i<keys.length;i++) hostChars[keys[i]] = 0;
        for(var s=0;s<segs.length;s++){
          var t = String((segs[s] && segs[s].text) || '').toLowerCase();
          if(!t) continue;
          var bestK = '', bestSc = 0;
          for(var p=0;p<keys.length;p++){
            var pk = keys[p];
            var sc = 0;
            // 1) product.name 全名匹配（×100）
            var name = (STD.products[pk] && STD.products[pk].name) ? String(STD.products[pk].name).toLowerCase() : '';
            if(name && t.indexOf(name) >= 0) sc += 100;
            // 2) name 括号内中文别名（如"双肩包"）—— 强信号 ×200
            var nameInner = '';
            if(name){
              var nm = name.match(/[（(]([^）)]+)[）)]/);
              if(nm) nameInner = nm[1].toLowerCase();
            }
            if(nameInner && t.indexOf(nameInner) >= 0) sc += 200;
            // 3) aliases 命中（×50/次）
            var al = (STD.products[pk] && STD.products[pk].aliases) || [];
            for(var aa=0;aa<al.length;aa++){
              var aw = String(al[aa] || '').toLowerCase(); if(!aw) continue;
              if(t.indexOf(aw) >= 0) sc += 50;
            }
            // 4) 真·独家专属词命中（×10）
            var excl = pool[pk] || [];
            for(var x=0;x<excl.length;x++){ if(excl[x] && t.indexOf(excl[x]) >= 0) sc += 10; }
            // 5) 卖点词命中（×1，基础分）
            var sp = STD.sellpoints && STD.sellpoints[pk];
            var list = (sp && sp.list) || [];
            for(var l=0;l<list.length;l++){
              var kws = list[l].keywords || [];
              for(var w=0;w<kws.length;w++){
                var kw = kws[w]; if(!kw) continue;
                if(t.indexOf(String(kw).toLowerCase()) >= 0){ sc += 1; break; }
              }
            }
            if(sc > bestSc){ bestSc = sc; bestK = pk; }
          }
          if(bestK && bestSc > 0) hostChars[bestK] += t.length;
        }
        var top = '', topChars = 0;
        for(var k in hostChars){
          if(hostChars[k] > topChars){ topChars = hostChars[k]; top = k; }
        }
        return topChars > 0 ? top : '';
      }catch(e){ return ''; }
    }

    var _gOrigRun = window.runGrading;
    window.runGrading = function(segs, productKey, options){
      var pk = productKey;
      var isAuto = (pk === 'auto' || pk === '' || pk === null || typeof pk === 'undefined');
      if(isAuto && segs && segs.length){
        var k = v4AutoProductKey(segs);
        if(k){ pk = k; }
        else if(options && options._v4116Log !== true){ console.log('[v4.11.7] 自动识别无产品特征 → 回落原 auto（noProduct 兜底）'); }
        if(k) console.log('[v4.11.7] 自动识别主品判定接管 →', k, '（原 auto）');
      }
      return _gOrigRun(segs, pk, options);
    };
    window.v4AutoProductKey = v4AutoProductKey;   // 暴露供诊断
    // v4.11.7 调试入口：浏览器 console 跑 `v4DebugAutoKey([{text:'...'}])` 可看每段归属
    window.v4DebugAutoKey = function(segs){
      var pool = v4BuildExclPool();
      var STD = GRADING_STANDARD;
      var keys = Object.keys(STD.products || {});
      var t0 = String((segs[0] && segs[0].text) || '').toLowerCase();
      var res = [];
      for(var p=0;p<keys.length;p++){
        var pk = keys[p];
        var sc = 0, parts = [];
        var name = (STD.products[pk] && STD.products[pk].name) || '';
        if(name && t0.indexOf(String(name).toLowerCase()) >= 0){ sc += 100; parts.push('name×100('+name+')'); }
        var al = (STD.products[pk] && STD.products[pk].aliases) || [];
        for(var aa=0;aa<al.length;aa++){ var aw=String(al[aa]||'').toLowerCase(); if(aw && t0.indexOf(aw)>=0){ sc += 50; parts.push('alias×50('+aw+')'); break; } }
        var excl = pool[pk] || [];
        for(var x=0;x<excl.length;x++){ if(excl[x] && t0.indexOf(excl[x])>=0){ sc += 10; parts.push('excl×10('+excl[x]+')'); } }
        var sp = STD.sellpoints && STD.sellpoints[pk];
        var list = (sp && sp.list) || [];
        for(var l=0;l<list.length;l++){
          var kws = list[l].keywords || [];
          for(var w=0;w<kws.length;w++){
            var kw=kws[w]; if(!kw) continue;
            if(t0.indexOf(String(kw).toLowerCase())>=0){ sc += 1; parts.push('sp('+list[l].title+')'); break; }
          }
        }
        res.push({k:pk, sc:sc, parts:parts});
      }
      res.sort(function(a,b){ return b.sc - a.sc; });
      console.log('[v4.11.7 诊断] 段文本头 80 字:', t0.slice(0,80));
      res.forEach(function(r){ console.log('  ' + r.k + ' = ' + r.sc + ' 分 ' + (r.parts.length ? '← ' + r.parts.join(', ') : '(无命中)')); });
      return res;
    };
    console.log('[v4.11.7] 主品自动识别接管已生效（段归属 + name/aliases 强信号 + 跨品共词去权）');
  }catch(e){ console.log('[v4.11.7] 主品判定接管跳过:', (e && e.message) || e); }
})();

// ---------- v4.11.26：线上模式由「无条件拦截」改为「先真试，通了就放行；真不通才引导」 ----------
// 为什么改（每条都有 commit / 实测证据）：
//   · 2026-09-08 13:43 提交 8259772（v4.11.9）本意是治「一键完整日报点完报 Failed to fetch」，
//     但写成了死代码 —— IIFE 里立刻读 window.V4Jobs，而 V4Jobs 定义在随后才加载的 workflow.js，
//     执行时恒为 undefined ⇒ 这段拦截在 09-08~09-17 **从未生效**，线上其实一直是放行的。
//   · 2026-09-17 13:46 提交 480b0d6（"v4.11.14 补丁：清理死代码"）把它改成「等 V4Jobs 就绪再接管」
//     ⇒ 拦截**第一次真正生效**，而且是无条件拦：浏览器允许了也没用。
//     老大 2026-09-23 报的「#/daily 之前能视频转写、现在不行」就是这一笔造成的。
//   · 2026-09-23 实测 Chrome profile 的 content_settings.exceptions.loopback_network：
//       https://mightymojoy.github.io:443,*      setting=1(允许)  last_modified=2026-08-27 10:09:33
//       https://ito-ai-grading.vercel.app:443,*  setting=1(允许)  last_modified=2026-09-07 09:01:25
//     ⇒ 浏览器侧本来就授权了本地网络访问。对照实测：关掉 LNA 检查后公网页面直连 3712 立刻 HTTP 200，
//       CORS / 混合内容都不是问题 —— LNA 是唯一门槛，而这门槛用户能在弹窗里点"允许"过掉。
// 新策略：点击时先探一次 /api/health（2.5s 超时）
//   · 通   → 原函数原样执行（线上页面同样能真转写）
//   · 不通 → 弹引导：点名哪个服务连不上，并可一键跳转到本地工作台
//            （顶层导航不受 LNA 限制：2026-09-23 实测线上页面 location.href 跳 8791 成功落地）
// 另外：不再在加载时置灰按钮 —— 那是"宁可错杀"，会把已授权的用户也一起挡在门外。
// 回退：localStorage.v4_cloud_probe = 'off'  → 恢复 v4.11.9 的无条件拦截（策略开关）
//       localStorage.v4_cloud_sim   = '1'    → 强制按线上处理（自检开关，与策略解耦；
//                                              v4_cloud_probe='force' 保留为同义别名）
// 自检：控制台 V4CloudGuard.status() 看判定 / V4CloudGuard.probe() 看两个服务的可达性
(function(){
  try{
    if(typeof window === 'undefined' || typeof location === 'undefined') return;

    var MODE = 'auto';        // 策略：auto(默认) / off(恢复 v4.11.9 无条件拦截)
    var SIM  = false;         // 开关：强制按"线上"处理（本机自检用，与策略解耦）
    try{ MODE = localStorage.getItem('v4_cloud_probe') || 'auto'; }catch(e){}
    try{ SIM  = (localStorage.getItem('v4_cloud_sim') === '1'); }catch(e){}
    var HARD = (MODE === 'off');

    var isCloud = !(location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)/i.test(location.hostname));
    if(location.protocol === 'file:') isCloud = true;   // 本地文件打开没有同源后端，按线上处理
    if(MODE === 'force' || SIM) isCloud = true;
    if(!isCloud){
      console.log('[v4.11.26] 本地模式（' + location.hostname + '）：转写/完整日报直连本地引擎，不做任何拦截');
      return;
    }

    function ls(k, d){ try{ return localStorage.getItem(k) || d; }catch(e){ return d; } }
    function strip(u){ return String(u || '').replace(/\/+$/, ''); }
    var ASR = strip(ls('asr_url',    'http://127.0.0.1:3712'));
    var VIS = strip(ls('vision_url', 'http://127.0.0.1:3713'));

    // needOk=false 时"只要有响应"即算服务在（视觉服务的健康路由不保证存在，404 也说明端口活着）
    function ping(u, ms, needOk){
      return new Promise(function(res){
        var ctrl = ('AbortController' in window) ? new AbortController() : null;
        var done = false;
        var timer = setTimeout(function(){
          if(done) return; done = true;
          try{ if(ctrl) ctrl.abort(); }catch(e){}
          res(false);
        }, ms || 2500);
        fetch(u + '/api/health', { method:'GET', cache:'no-store', signal: ctrl ? ctrl.signal : undefined })
          .then(function(r){ if(done) return; done = true; clearTimeout(timer); res(needOk === false ? true : !!(r && r.ok)); })
          .catch(function(){ if(done) return; done = true; clearTimeout(timer); res(false); });
      });
    }

    function jumpLocal(page){
      var h = (location.hash && location.hash.length > 1) ? location.hash : ('#/' + (page || 'daily'));
      try{ location.href = 'http://127.0.0.1:8791/v4/' + h; }
      catch(e){ try{ window.open('http://127.0.0.1:8791/v4/' + h, '_blank'); }catch(e2){} }
    }

    function guideText(which, asrOk, visOk){
      var L = [];
      L.push(which === 'full' ? '「一键完整日报」需要本机两个服务，现在没连上：' : '视频自动转写需要本机转写引擎，现在没连上：');
      L.push('');
      L.push((asrOk ? '✔' : '✘') + ' 转写引擎 3712　' + ASR);
      if(which === 'full') L.push((visOk ? '✔' : '✘') + ' 画面识别 3713　' + VIS);
      L.push('');
      L.push('处理方式（任选一种）：');
      L.push('① 点"确定"直接跳到本机工作台 http://127.0.0.1:8791/v4/ —— 同款功能在本地不受此限制；');
      L.push('② 若本机服务没起：先双击离线引擎包里的「一键启动.bat」(Windows) /「启动.command」(Mac)，再回来点这个按钮；');
      if(which === 'full') L.push('③ 只要文字评分：改用「每日评分」页的"上传视频·自动转写评分"（只依赖 3712，不需要画面识别）；');
      else                 L.push('③ 或上传飞书妙记等工具导出的 .srt，到「每日评分」页粘贴逐字稿直接评分。');
      return L.join('\n');
    }

    function guard(orig, which){
      var needVis = (which === 'full');
      return function(){
        var self = this, args = arguments;
        if(HARD){
          var t0 = '线上模式不支持自动转写（已按 v4_cloud_probe=off 强制拦截）。\n\n点"确定"跳转到本地工作台，同款功能在那里可用。';
          try{ if(typeof toastErr === 'function') toastErr(t0); }catch(e){}
          var g0 = false;
          try{ g0 = confirm(t0); }catch(e){}
          if(g0) jumpLocal(which === 'full' ? 'vision' : 'daily');
          return Promise.reject(new Error('cloud-blocked-' + which));
        }
        return Promise.all([
          ping(ASR, 2500, true),
          needVis ? ping(VIS, 1500, false) : Promise.resolve(true)
        ]).then(function(rs){
          var asrOk = rs[0], visOk = rs[1];
          if(asrOk && (!needVis || visOk)) return orig.apply(self, args);
          var miss = [];
          if(!asrOk) miss.push('3712');
          if(needVis && !visOk) miss.push('3713');
          try{ if(typeof toastErr === 'function') toastErr('本机服务未连接：' + miss.join(' / ') + '（不影响其他功能）'); }catch(e){}
          var go = false;
          try{ go = confirm(guideText(which, asrOk, visOk) + '\n\n点"确定"立即跳转到本机工作台，点"取消"留在本页。'); }catch(e){}
          if(go) jumpLocal(which === 'full' ? 'vision' : 'daily');
          return Promise.reject(new Error('engine-unreachable-' + which));
        });
      };
    }

    var applied = false;
    function apply(){
      if(applied) return true;
      var j = window.V4Jobs;
      if(!j || typeof j.fullReport !== 'function' || typeof j.transcribe !== 'function') return false;
      if(!j.__v41126){
        j.transcribe = guard(j.transcribe, 'daily');
        j.fullReport = guard(j.fullReport, 'full');
        j.__v41126 = true;
      }
      applied = true;
      try{
        console.log('[v4.11.26] 线上模式已启用「先真试、通了放行」ASR=' + ASR + ' VISION=' + VIS +
                    (HARD ? '（v4_cloud_probe=off → 强制拦截）' : ''));
      }catch(e){}
      return true;
    }
    if(!apply()){
      var tries = 0;
      var iv = setInterval(function(){ tries++; if(apply() || tries >= 50) clearInterval(iv); }, 100);
    }
    window.addEventListener('load', function(){ try{ apply(); }catch(e){} });

    // 自检 / 排障入口（控制台）：V4CloudGuard.status() / V4CloudGuard.probe()
    window.V4CloudGuard = {
      isCloud: isCloud, mode: MODE, asr: ASR, vision: VIS,
      probe: function(){
        return Promise.all([ping(ASR, 2500, true), ping(VIS, 1500, false)])
          .then(function(r){ return { asr3712: r[0], vision3713: r[1] }; });
      },
      status: function(){
        try{
          return {
            version: (window.V4_VERSION || ''), isCloud: isCloud, mode: MODE,
            asr: ASR, vision: VIS,
            wrapped: !!(window.V4Jobs && window.V4Jobs.__v41126),
            href: String(location.href)
          };
        }catch(e){ return { err: String(e) }; }
      }
    };
  }catch(e){ console.log('[v4.11.26] 接管跳过:', (e && e.message) || e); }
})();

// ---------- v4.11.11：工作台读飞书实时数据（接上 api/feishu-read，看到全员评分） ----------
// 背景：工作台写飞书是实时的（云端函数），但读数据全是本机的——localStorage（首页/历史归档）
//       + data/*.js 静态快照（飞书数据表 tab，停在 2026-08-31）。api/feishu-read.js 早在 v4.4
//       就写好了，注释原文「把飞书多维表格的数据读进 v4 工作台」，但全仓无任何调用方，线没接上。
// 本块纯加法，不动 app-core.js：
//   ① 接管 v4FsEnsure(key) → 优先走云端实时接口，失败自动回退原静态快照（行为不会比现在更差）
//   ② _index 结构适配（接口 tables → {key,name,table_id,count}，供表选择器使用）
//   ③ 修正 mergeDaily 优先级（原实现遇到飞书记录无 _updatedAt 时会倒挂成本地覆盖远端）
//   ④ 首页统计合并飞书历史评分（全员口径），本机 5 分钟内新评的仍以本机为准
(function(){
  try{
    if(typeof window === 'undefined' || typeof location === 'undefined') return;

    var V4CLOUD = {
      cache: {},          // key -> {data, ts}；data=null 表示上次失败
      TTL: 60000,         // 成功缓存 60s（飞书接口限流约 100 次/分/应用）
      FAIL_TTL: 30000,    // 失败缓存 30s，避免反复重试拖慢界面
      grace: 300000,      // 本机 5 分钟内新评的记录优先于远端（飞书回写可能有延迟）
      limit: 800          // v4.11.52：500 → 800。接口上限 1200；历史评分表已 556 条，
                          //   原来 500 会把最新 56 条（10-26 后半 + 10-27/28/29）直接丢掉，
                          //   工作台归档索引因此停在 10-26。gzip 后仅 1.82MB，远低于 Vercel 4.5MB 限制。
    };
    window.V4CLOUD = V4CLOUD;

    var ABS_READ = 'https://ito-ai-grading.vercel.app/api/feishu-read';

    function isLocalHost(){
      var h = '';
      try{ h = location.hostname; }catch(e){}
      return (location.protocol === 'file:' || h === '127.0.0.1' || h === 'localhost');
    }
    // 端点候选：localStorage.feishu_read_url 最优先；本地 8791 无该路由 → 直连线上；线上优先同源
    function readUrls(){
      var custom = null;
      try{ custom = localStorage.getItem('feishu_read_url'); }catch(e){}
      if(custom) return [String(custom).replace(/\/+$/, '')];
      if(isLocalHost()) return [ABS_READ];
      return ['/api/feishu-read', ABS_READ];
    }

    function postJson(url, body, timeoutMs){
      return new Promise(function(resolve, reject){
        var ctrl = ('AbortController' in window) ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, timeoutMs || 20000) : null;
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function(r){
          if(timer) clearTimeout(timer);
          if(!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(j){
          if(!j) throw new Error('空响应');
          if(j.skipped) throw new Error(j.reason || '服务端未配置飞书凭证');
          if(!j.ok) throw new Error(j.error || j.reason || '接口 ok=false');
          resolve(j);
        })['catch'](function(e){
          if(timer) clearTimeout(timer);
          reject(e);
        });
      });
    }
    function fetchCloud(payload){
      var urls = readUrls(), i = 0;
      function next(){
        if(i >= urls.length) return Promise.reject(new Error('全部云端端点不可用'));
        return postJson(urls[i++], payload)['catch'](function(){ return next(); });
      }
      return next();
    }

    // ---- 表名 → 逻辑键（与 api/feishu-read.js 的 NAME_KEYS 同口径，先精确后模糊）----
    // 顺序即优先级：「周总结-明星主播」必须先于「周总结」，「历史评分汇总」必须先于「历史评分」
    var KEY_RULES = [
      [/明星/,          'weekstar'],
      [/周总结/,        'week'],
      [/历史评分汇总/,  'historySum'],
      [/历史评分/,      'history'],
      [/主播日报/,      'daily'],
      [/TOP1|多主播/i,  'top1'],
      [/月总结/,        'month'],
      [/激励/,          'reward'],
      [/惩罚/,          'punish'],
      [/黄金话术/,      'golden'],
      [/问题话术/,      'problem'],
      [/优秀案例/,      'case'],
      [/主播名单/,      'roster'],
      [/日评分汇总/,    'dailySum']
    ];
    function keyOfName(name){
      var n = String(name || '');
      for(var i = 0; i < KEY_RULES.length; i++){
        if(KEY_RULES[i][0].test(n)) return KEY_RULES[i][1];
      }
      return '';
    }
    function stamp(){ return '飞书实时 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }); }

    // 表选择器下拉的条数：已加载过的表显示真实条数，未加载显示「—」（原 v4FsFillSel 用 t.count||0）
    function cachedCount(key){
      try{
        var mem = window.V4FS && window.V4FS[key];
        if(mem && mem.rows && mem.rows.length) return mem.rows.length;
      }catch(e){}
      return '—';
    }

    function buildIndex(){
      return fetchCloud({ action: 'tables' }).then(function(j){
        var used = {};
        var tables = (j.tables || []).map(function(t){
          var k = keyOfName(t.name);
          if(!k || used[k]) k = 'tbl_' + t.table_id;
          used[k] = 1;
          return { key: k, name: t.name, table_id: t.table_id, count: cachedCount(k) };
        });
        var d = { ok: true, syncedAt: stamp(), tables: tables };
        window.V4FS = window.V4FS || {};
        window.V4FS['_index'] = d;
        return d;
      });
    }

    // ---- ① 主接管：v4FsEnsure(key) ----
    var _origEnsure = window.v4FsEnsure;
    if(typeof _origEnsure !== 'function'){
      console.log('[v4.11.11] v4FsEnsure 未就绪，跳过云端接管（工作台仍按静态快照运行）');
      return;
    }

    function cloudEnsure(key){
      var now = Date.now();
      var c = V4CLOUD.cache[key];
      if(c && (now - c.ts) < (c.data ? V4CLOUD.TTL : V4CLOUD.FAIL_TTL)) return Promise.resolve(c.data);

      var task;
      if(key === '_index'){
        task = buildIndex();
      } else {
        var payload = /^tbl_/.test(key)
          ? { action: 'records', table_id: key.slice(4), limit: V4CLOUD.limit }
          : { action: 'records', key: key, limit: V4CLOUD.limit };
        task = fetchCloud(payload).then(function(j){
          j.syncedAt = stamp();
          window.V4FS = window.V4FS || {};
          window.V4FS[key] = j;
          return j;
        });
      }
      return task.then(function(d){
        V4CLOUD.cache[key] = { data: d, ts: Date.now() };
        return d;
      })['catch'](function(e){
        V4CLOUD.cache[key] = { data: null, ts: Date.now() };
        console.log('[v4.11.11] 云端读取失败 → 回退静态快照 | ' + key + ' | ' + ((e && e.message) || e));
        return _origEnsure(key);
      });
    }

    window.v4FsEnsure = function(key){
      try{ return cloudEnsure(key); }
      catch(e){
        console.log('[v4.11.11] 接管异常 → 回退静态快照:', (e && e.message) || e);
        return _origEnsure(key);
      }
    };

    // 重新载入：一并清掉云端缓存，保证拿到最新
    var _origReload = window.v4FsReload;
    if(typeof _origReload === 'function'){
      window.v4FsReload = function(){
        V4CLOUD.cache = {};
        console.log('[v4.11.11] 云端缓存已清空，强制重取');
        return _origReload.apply(this, arguments);
      };
    }

    // ---- ③ 合并修正：飞书（共享真相）优先；本机 5 分钟内新评的保留 ----
    // 原实现：remoteTime = Date.parse(old._updatedAt)，飞书记录无该字段 → NaN → !remoteTime 为真
    //         → 结果变成「本地无条件覆盖远端」，同主播同日期时本机旧分会盖掉飞书新分。
    if(typeof window.mergeDaily === 'function'){
      window.mergeDaily = function(local, synced){
        var map = Object.create(null), order = [];
        function keyOf(r){
          var nd = v4NormDate(r['日期'] || r['标准日期'] || '');
          return String(r['主播'] || r['主机'] || '') + '|' + (nd.d || String(r['日期'] || r['标准日期'] || ''));
        }
        (synced || []).forEach(function(r){ var k = keyOf(r); if(!map[k]) order.push(k); map[k] = r; });
        (local || []).forEach(function(r){
          var k = keyOf(r);
          if(!map[k]){ order.push(k); map[k] = r; return; }
          var rt = Date.parse(r._updatedAt || '');
          if(!isNaN(rt) && (Date.now() - rt) < V4CLOUD.grace) map[k] = r;   // 刚评的 → 本机优先
        });
        return order.map(function(k){ return map[k]; }).sort(dateDesc);
      };
    }

    // ---- ④ 首页统计：本机 + 飞书历史评分（全员口径） ----
    function cloudHistRows(rows){
      var out = [];
      (rows || []).forEach(function(r){
        var host = String(r['主播'] || '').trim();
        if(!host) return;
        var nd = v4NormDate(r['标准日期'] || r['日期'] || '');
        out.push({
          host: host,
          date: nd.d || String(r['标准日期'] || r['日期'] || ''),
          total: r['总分'] || r['历史总分(数值)'] || '—',
          c1Score: r['c1产品理解'] || r['产品理解(数值)'] || '',
          product: r['产品'] || '',
          _src: 'cloud'
        });
      });
      return out;
    }
    function dashMerge(cloudRows){
      var histRaw = v4ReadLS('grading_history_v1', '[]');
      var map = Object.create(null), order = [];
      function keyOf(x){
        var nd = v4NormDate(x.date || '');
        return String(x.host || '') + '|' + (nd.d || String(x.date || ''));
      }
      cloudRows.forEach(function(x){ var k = keyOf(x); if(!map[k]) order.push(k); map[k] = x; });
      histRaw.forEach(function(x){
        var k = keyOf(x);
        if(!map[k]){ order.push(k); map[k] = x; return; }
        var rt = (typeof x.ts === 'number') ? x.ts : Date.parse(x._updatedAt || '');
        if(!isNaN(rt) && rt && (Date.now() - rt) < V4CLOUD.grace) map[k] = x;   // 刚评的 → 本机优先
      });
      var merged = order.map(function(k){ return map[k]; });
      merged.sort(function(a, b){
        var da = String(a.date || ''), db = String(b.date || '');
        if(da !== db) return da > db ? -1 : 1;
        return ((b.ts || 0) - (a.ts || 0));
      });
      return merged;
    }
    function dashRenderMerged(hist){
      var today = v4TodayStr(), todayN = 0;
      for(var i = 0; i < hist.length; i++){ if(hist[i].date === today) todayN++; }
      var el;
      el = document.getElementById('dash-stat-today');   if(el) el.textContent = todayN;
      el = document.getElementById('dash-stat-history'); if(el) el.textContent = hist.length;
      var box = document.getElementById('dash-recent');
      if(!box) return;
      if(!hist.length){
        box.innerHTML = '暂无记录——去「每日评分」完成第一次评分（历史数据与 v3 共库，之前评过的直接可见）';
        return;
      }
      var h = '<table><tr><th style="width:14%">主播</th><th style="width:12%">日期</th><th style="width:9%">总分</th><th style="width:11%">c1 产品理解</th><th>考核产品</th></tr>';
      var recent = hist.slice(0, 8);
      for(var j = 0; j < recent.length; j++){
        var r = recent[j];
        var c1 = (r.c1Score !== null && r.c1Score !== undefined && r.c1Score !== '') ? r.c1Score : '—';
        h += '<tr><td><b>' + esc(r.host) + '</b></td><td>' + esc(r.date || '—') + '</td>' +
             '<td><b style="color:var(--gold)">' + esc(String(r.total === undefined || r.total === null ? '—' : r.total)) + '</b></td>' +
             '<td>' + esc(String(c1)) + '</td>' +
             '<td style="font-size:11.5px;color:var(--text2)">' + v4ExpandCell(r.product || '—', 44) + '</td></tr>';
      }
      var cloudN = 0;
      for(var m = 0; m < hist.length; m++){ if(hist[m]._src === 'cloud') cloudN++; }
      box.innerHTML = h + '</table>' +
        '<div style="margin-top:6px"><a href="#/history" style="font-size:11.5px;color:var(--gold)">查看全部历史 →</a>' +
        '<span style="font-size:11.5px;color:var(--text3);margin-left:10px">含飞书全员数据 ' + cloudN + ' 条（' + stamp() + '）</span></div>';
    }

    var _origDash = window.v4RenderDashboard;
    if(typeof _origDash === 'function'){
      window.v4RenderDashboard = function(){
        var ret;
        try{ ret = _origDash.apply(this, arguments); }catch(e){ console.log('[v4.11.11] 原首页渲染异常:', (e && e.message) || e); }
        try{
          window.v4FsEnsure('history').then(function(d){
            if(!d || !d.rows || !d.rows.length) return;
            dashRenderMerged(dashMerge(cloudHistRows(d.rows)));
          })['catch'](function(e){ console.log('[v4.11.11] 首页飞书合并跳过:', (e && e.message) || e); });
        }catch(e){}
        return ret;
      };
    }

    console.log('[v4.11.11] 工作台读飞书已接通 → 端点 ' + readUrls().join(' / ') +
      ' ｜ 缓存 ' + (V4CLOUD.TTL / 1000) + 's ｜ 失败自动回退静态快照');
  }catch(e){ console.log('[v4.11.11] 接管跳过:', (e && e.message) || e); }
})();

// ---------- v4.11.12：讲品考核窗口 10 分钟 → 20 分钟（口径变更） ----------
// 背景（老大 2026-09-11 确认）：10 分钟窗口内主播无法把产品完整介绍完，
//   窗口截断导致卖点永远查不全（实测同一份真实逐字稿：600s 覆盖 71% → 1200s 覆盖 86%）。
// 改动范围（纯口径参数，不动评分模型/分档/权重）：
//   ① app-core.js：新增 SELL_WINDOW_SEC = 1200 单一常量，替换两处硬编码 600
//   ② app-core.js + index.html：9 处「10 分钟」文案 → 「20 分钟」
//   ③ 60 秒去抖阈值 与 80 字顺带提及阈值 保持不变（只动时长一个变量，便于回退）
// 历史数据策略（③A）：旧记录仍为 10 分钟口径，不回溯重算；本次起新评分为 20 分钟口径。
// 回退方式：把 app-core.js 的 SELL_WINDOW_SEC 改回 600 即完整还原旧行为（已验证无损）。
(function(){
  try{
    var w = (typeof SELL_WINDOW_SEC !== 'undefined') ? SELL_WINDOW_SEC : null;
    if(w === null){
      console.log('[v4.11.12] 未读到 SELL_WINDOW_SEC（可能加载顺序差异），跳过自检');
      return;
    }
    var ok = (w === 1200);
    console.log('[v4.11.12] 讲品考核窗口 = ' + w + ' 秒（' + (w / 60) + ' 分钟）' +
      (ok ? ' ✓ 口径生效' : ' ⚠ 与预期 1200 不符，请检查 app-core.js'));
  }catch(e){ console.log('[v4.11.12] 自检跳过:', (e && e.message) || e); }
})();

// ---------- v4.11.20：逐字稿（SRT）界面可查看 + 手动导出（纯加法，不动 app-core.js） ----------
// 背景（老大 2026-09-21 确认「C：界面可查看 + 手动导出」）：
//   长视频（4 小时级）转写后，SRT 全文只在下面三处之一留痕，且界面没有任何查看/导出入口，
//   拿不到素材做实际案例分析：
//     ① 引擎 tmp/out_<jobId>.srt —— 落盘但不自动清理（在跑转写的那台机器上）
//     ② localStorage.last_srt —— 仅「单主播评分·视频」通道写；完整日报 / txt / 批量都不写
//     ③ job.cache.transcription.srt —— 只在内存，会话结束即丢
// 本块做三件事（全部只读既有数据，不改变评分链路）：
//   ① 界面可查看：结果页出现「逐字稿（SRT）」卡片 → 右侧抽屉内按时间戳逐段浏览 + 关键词检索
//   ② 手动导出：一键下载 .srt（默认文件名沿用桌面既有规范「日期-直播间-主播-产品.srt」）
//   ③ 跨会话留存：自动归档最近 3 场到 localStorage（新键 v4_srt_archive_v1，与 v3 的 last_srt 不冲突），
//      并在「每日评分」页常驻「历史逐字稿」条 —— 刷新后仍可查看/导出（否则刷新即失，等于没留）
// 数据来源优先级：job.cache.transcription.srt（本次会话，最准，含完整时间轴）
//                → localStorage v4_srt_archive_v1（历次归档）
//                → localStorage last_srt（老键兜底，可能不含时间轴）
// 归档上限（按字符数计；localStorage 内部按 UTF-16 存储 ⇒ 1 字符 ≈ 2 字节）：
//   单份 ≤ 90 万字符（≈1.8MB）、总量 ≤ 180 万字符（≈3.6MB）；超额淘汰最旧。
//   实测参考：4 小时逐字稿 SRT 约 20 万字符 ⇒ 可存满 3 场且留有大量余量。
// z-index 层级（本块新增，按「全站层级集中定义」铁律登记）：
//   既有：面板(默认) < 表格 sticky(1–3) < … < 本块抽屉遮罩(989) < 本块抽屉(990) < JS 错误条(999)
//   说明：错误条 999 必须永远可见，故抽屉压在它之下；抽屉全屏但顶部留 0，错误条出现在最上层。
// 回退/降级：任何异常都不阻断评分（全块 try 包裹）；localStorage 写失败只提示不抛错。
// 关闭方式：V4SrtOff() 关整块（遮罩固定层不再创建）；V4SrtOn() 恢复。
(function(){
  try{
    var LS_KEY = 'v4_srt_archive_v1';
    var OFF_KEY = 'v4_srt_off';
    var MAX_ONE = 900000, MAX_ALL = 1800000, MAX_ITEMS = 3;
    var STEP = 300, MAX_HITS = 500;                 // 抽屉分段渲染步长 / 检索最多渲染条数
    var Z_MASK = 989, Z_DRAWER = 990;

    var CURRENT = null, DRAWER_OPEN = false;
    var VIEW = [], SHOWN = 0, HITS = 0, KW = '', ONLY_HIT = false;

    /* ================= 小工具 ================= */
    function $(id){ return document.getElementById(id); }
    function esc(s){
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function hhmmss(sec){
      sec = Math.max(0, Math.floor(sec || 0));
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function durText(sec){
      sec = Math.max(0, Math.floor(sec || 0));
      var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
      if(h) return h + ' 小时' + (m < 10 ? '0' : '') + m + ' 分';
      if(sec >= 60) return m + ' 分';
      return sec + ' 秒';
    }
    function charsText(n){
      n = n || 0;
      return n >= 10000 ? (n / 10000).toFixed(1) + ' 万字' : n + ' 字';
    }
    function tip(msg){
      var e = $('v4SrtTip');
      if(e){ e.textContent = msg || ''; if(msg) setTimeout(function(){ if(e.textContent === msg) e.textContent = ''; }, 4000); }
      else if(msg && typeof toastErr === 'function'){ try{ toastErr(msg); }catch(x){} }
    }

    /* ================= SRT 解析（自实现，不依赖 app-core.js 的 parseTranscript） ================= */
    // 支持标准 SRT（HH:MM:SS,mmm --> HH:MM:SS,mmm）以及用「.» 作小数点的变体（部分工具产出）。
    // 无时间轴时降级为「按行」列表（仍可查看/导出，只是没有跳转锚点）。
    // ⚠️ 块边界（2026-09-21 实测踩坑）：SRT 的序号行紧跟在「上一块正文之后、本块时间轴之前」，
    //   若只按「时间戳行结束前块」判断，「2」这个序号会被拼进第 1 段正文（实测第 1 段多 1 个字符）。
    //   故三条边界都要认：① 空行 ② 时间戳行 ③ 序号行（其后紧跟时间戳行）。
    function parseSrt(text){
      var raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
      var lines = raw.split('\n');
      var re = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
      var out = [], cur = null, durSec = 0, chars = 0;
      function push(){ if(cur && cur.text) out.push(cur); cur = null; }
      function nextNonEmptyIsTs(from){
        for(var n = from; n < lines.length; n++){
          var s = lines[n].trim();
          if(!s) continue;
          return re.test(s);
        }
        return false;
      }
      for(var i = 0; i < lines.length; i++){
        var ln = lines[i], m = ln.match(re);
        if(m){
          push();
          cur = {
            from: (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]),
            to: (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]),
            text: ''
          };
          if(cur.to > durSec) durSec = cur.to;
        }else if(cur){
          var t = ln.trim();
          if(!t){ push(); continue; }                                    // ① 空行 = 块结束
          if(/^\d+$/.test(t) && nextNonEmptyIsTs(i + 1)){ push(); continue; }  // ③ 序号行 = 块结束
          cur.text += (cur.text ? ' ' : '') + t;
        }
      }
      push();
      if(!out.length){
        for(var j = 0; j < lines.length; j++){
          var s = lines[j].trim();
          if(s && !/^\d+$/.test(s)) out.push({ from: null, to: null, text: s });
        }
      }
      for(var k = 0; k < out.length; k++){
        out[k].i = k + 1;
        out[k].clean = out[k].text.replace(/\s/g, '');
        chars += out[k].clean.length;
      }
      return { segs: out.length, chars: chars, durSec: durSec, blocks: out, hasTs: !!(out.length && out[0].from != null) };
    }

    /* ================= 归档（跨会话留存） ================= */
    function loadArchive(){
      try{
        var raw = localStorage.getItem(LS_KEY);
        if(!raw) return [];
        var d = JSON.parse(raw);
        var items = (d && d.items) || [];
        return items.filter(function(x){ return x && x.srt; });
      }catch(e){ return []; }
    }
    function saveArchive(items){
      try{
        localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), items: items }));
        return true;
      }catch(e){
        tip('本机存储写入失败（可能已满），本次逐字稿仅当前会话可查看/导出');
        return false;
      }
    }
    function clearArchive(){
      try{ localStorage.removeItem(LS_KEY); }catch(e){}
      renderArchiveBar();
    }
    function archivePut(rec){
      if(!rec || !rec.srt) return false;
      if(rec.srt.length > MAX_ONE){
        tip('逐字稿超过单份上限（' + charsText(MAX_ONE) + '），仅当前会话可查看/导出，未写入本机归档');
        return false;
      }
      var items = loadArchive().filter(function(x){ return x.id !== rec.id; });
      items.unshift({ id: rec.id, host: rec.host, date: rec.date, studio: rec.studio, product: rec.product,
        fileName: rec.fileName, segs: rec.segs, chars: rec.chars, durSec: rec.durSec,
        savedAt: new Date().toISOString(), srt: rec.srt });
      if(items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);
      var total = items.reduce(function(a, x){ return a + (x.srt ? x.srt.length : 0); }, 0);
      while(items.length > 1 && total > MAX_ALL){
        var drop = items.pop();
        total -= (drop.srt ? drop.srt.length : 0);
      }
      return saveArchive(items);
    }
    function archiveById(id){
      var items = loadArchive();
      for(var i = 0; i < items.length; i++){ if(items[i].id === id) return items[i]; }
      return null;
    }

    /* ================= 从当前任务抓 SRT ================= */
    // job.cache.transcription 的两种形态都要兼容：
    //   异步通道（v4.11.13）：{ srt: text, info: '' }
    //   同步通道（cachedRequest，完整日报用）：服务端返回的整个 data 对象（含 srt）
    function grabFromJob(lane){
      var J = window.V4Jobs;
      if(!J || typeof J.getJob !== 'function') return null;
      var job = J.getJob(lane);
      if(!job || !job.cache) return null;
      var t = job.cache.transcription;
      var srt = t && (t.srt || t.text);
      if(!srt || !String(srt).trim()) return null;
      var m = job.meta || {};
      return {
        srt: String(srt),
        host: m.host || '', date: m.date || '', studio: m.studio || '', product: '',
        fileName: (job.file && job.file.name) || '', _src: 'job'
      };
    }
    function grabFromLegacy(){
      try{
        var s = localStorage.getItem('last_srt');
        if(!s || !String(s).trim()) return null;
        return { srt: String(s), host: '', date: '', studio: '', product: '', fileName: '', _src: 'last_srt' };
      }catch(e){ return null; }
    }

    /* ================= 记录规整 ================= */
    function normalize(rec, r){
      if(!rec || !rec.srt) return null;
      var p = parseSrt(rec.srt);
      var out = {
        srt: rec.srt,
        host: rec.host || (r && r.host) || '',
        date: rec.date || (r && r.date) || '',
        studio: rec.studio || (r && r.studio) || '',
        product: rec.product || (r && (r.product || (r.sellpoints && r.sellpoints.product))) || '',
        fileName: rec.fileName || '',
        segs: p.segs, chars: p.chars, durSec: p.durSec, hasTs: p.hasTs,
        _src: rec._src || 'arch'
      };
      out.id = [out.host, out.date, out.fileName].join('|');
      return out;
    }
    function metaLine(rec){
      var parts = [];
      if(rec.host) parts.push(rec.host);
      if(rec.date) parts.push(rec.date);
      if(rec.studio) parts.push(rec.studio);
      if(rec.product) parts.push(rec.product);
      var bits = [];
      if(rec.segs) bits.push(rec.segs + ' 段');
      if(rec.chars) bits.push(charsText(rec.chars));
      if(rec.durSec) bits.push(hhmmss(rec.durSec));
      return (parts.length ? parts.join(' · ') : '未标注场次') + (bits.length ? ' · ' + bits.join(' / ') : '');
    }

    /* ================= 文件名与导出 ================= */
    function safeName(s){
      return String(s == null ? '' : s).replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, '').trim();
    }
    function srtName(rec){
      var parts = [rec.date, rec.studio, rec.host, rec.product].map(safeName).filter(Boolean);
      return (parts.length ? parts.join('-') : '逐字稿') + '.srt';
    }
    // 不加 BOM：保持与引擎产出字节一致（可直接再喂回「每日评分」的 txt 通道，readAsText(utf-8) 正常）
    function downloadText(name, text, mime){
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} }, 3000);
    }
    function exportCurrent(){
      if(!CURRENT){ tip('当前没有可导出的逐字稿'); return; }
      downloadText(srtName(CURRENT), CURRENT.srt);
      tip('已导出 ' + srtName(CURRENT));
    }
    function copyAll(){
      if(!CURRENT){ tip('当前没有可复制的逐字稿'); return; }
      var text = CURRENT.srt;
      function done(ok){ tip(ok ? '全文已复制到剪贴板' : '复制失败，请改用「导出 SRT」'); }
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(text).then(function(){ done(true); })['catch'](function(){ done(fallbackCopy(text)); });
          return;
        }
      }catch(e){}
      done(fallbackCopy(text));
    }
    function fallbackCopy(text){
      try{
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        ta.remove(); return ok;
      }catch(e){ return false; }
    }

    /* ================= 结果页卡片 ================= */
    function cardHost(lane){
      if(lane === 'vision'){
        var v = $('visionReportBlock');
        return v ? v.parentNode : null;
      }
      return $('result') || null;
    }
    function renderCard(){
      var host = CARD_HOST;
      if(!host) return;
      var box = $('v4SrtCard');
      if(!CURRENT){ if(box) box.style.display = 'none'; return; }
      if(!box){
        box = document.createElement('div');
        box.id = 'v4SrtCard';
        box.className = 'panel';
        box.style.cssText = 'border:1px solid var(--line);margin:0 0 14px';
        if(host.firstChild) host.insertBefore(box, host.firstChild); else host.appendChild(box);
      }else if(box.parentNode !== host){
        if(host.firstChild) host.insertBefore(box, host.firstChild); else host.appendChild(box);
      }
      box.style.display = 'block';
      var rec = CURRENT;
      var srcNote = rec._src === 'last_srt' ? '（来源：旧缓存 last_srt，可能不含完整时间轴）' : '（转写原文，可直接用于案例分析）';
      box.innerHTML =
        '<h3 style="color:var(--gold)">逐字稿 · 转写原文（SRT）</h3>' +
        '<div style="font-size:12px;color:var(--text3);margin:-4px 0 10px">' +
          esc(metaLine(rec)) + ' <span style="color:var(--text3)">' + esc(srcNote) + '</span></div>' +
        '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
          '<button class="btn btn-ghost" id="v4SrtView">查看全文（可检索）</button>' +
          '<button class="btn btn-ghost" id="v4SrtExp">导出 SRT</button>' +
          '<button class="btn btn-ghost" id="v4SrtCopy">复制全文</button>' +
          '<span id="v4SrtTip" style="font-size:11.5px;color:var(--gold)"></span>' +
        '</div>';
      var bView = $('v4SrtView'), bExp = $('v4SrtExp'), bCopy = $('v4SrtCopy');
      if(bView) bView.onclick = openDrawer;
      if(bExp) bExp.onclick = exportCurrent;
      if(bCopy) bCopy.onclick = copyAll;
    }

    /* ================= 历史归档条（刷新后仍能取到上次的 SRT） ================= */
    function renderArchiveBar(){
      var page = $('page-daily');
      if(!page) return;
      var bar = $('v4SrtArchiveBar');
      var items = loadArchive();
      if(!items.length){ if(bar) bar.style.display = 'none'; return; }
      if(!bar){
        bar = document.createElement('div');
        bar.id = 'v4SrtArchiveBar';
        bar.className = 'panel';
        bar.style.cssText = 'border:1px solid var(--line);margin-top:14px';
        var anchor = $('result');
        if(anchor && anchor.parentNode === page) page.insertBefore(bar, anchor.nextSibling);
        else page.appendChild(bar);
      }
      bar.style.display = 'block';
      bar.innerHTML =
        '<h3 style="color:var(--gold)">历史逐字稿（本机归档 · 最近 ' + items.length + ' 场）</h3>' +
        '<div style="font-size:12px;color:var(--text3);margin:-4px 0 10px">' +
          '每次视频转写后自动留存一份，刷新/重开页面仍可查看与导出。仅存本机，不上传、不进仓库。</div>' +
        '<div id="v4SrtArchList"></div>';
      var list = $('v4SrtArchList');
      items.forEach(function(it){
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line)';
        var label = document.createElement('span');
        label.style.cssText = 'font-size:12px;color:var(--text2)';
        label.textContent = metaLine(it);
        row.appendChild(label);
        var b1 = document.createElement('button');
        b1.className = 'btn btn-ghost'; b1.textContent = '查看';
        b1.onclick = function(){ if(adopt(it)) openDrawer(); };
        var b2 = document.createElement('button');
        b2.className = 'btn btn-ghost'; b2.textContent = '导出 SRT';
        b2.onclick = function(){ downloadText(srtName(it), it.srt); };
        row.appendChild(b1); row.appendChild(b2);
        list.appendChild(row);
      });
    }
    function adopt(item){
      var rec = normalize({ srt: item.srt, host: item.host, date: item.date, studio: item.studio,
        product: item.product, fileName: item.fileName, _src: 'arch' }, null);
      if(!rec){ tip('该条归档无法解析'); return false; }
      CURRENT = rec;
      renderCard();
      return true;
    }

    /* ================= 抽屉（界面查看全文 + 检索） ================= */
    function ensureDrawer(){
      if($('v4SrtDrawer')) return;
      var mask = document.createElement('div');
      mask.id = 'v4SrtMask';
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(30,26,18,.42);z-index:' + Z_MASK + ';display:none';
      mask.onclick = closeDrawer;
      var dw = document.createElement('div');
      dw.id = 'v4SrtDrawer';
      dw.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(880px,95vw);background:var(--card,#fff);' +
        'z-index:' + Z_DRAWER + ';display:none;flex-direction:column;box-shadow:-8px 0 32px rgba(0,0,0,.16)';
      dw.innerHTML =
        '<div style="padding:14px 18px 10px;border-bottom:1px solid var(--line)">' +
          '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">' +
            '<div style="font-size:14px;font-weight:600;color:var(--gold)">逐字稿全文（SRT）</div>' +
            '<div id="v4SrtDTitle" style="font-size:11.5px;color:var(--text3)"></div>' +
            '<div style="margin-left:auto;display:flex;gap:8px">' +
              '<button class="btn btn-ghost" id="v4SrtDExp">导出 SRT</button>' +
              '<button class="btn btn-ghost" id="v4SrtDCopy">复制全文</button>' +
              '<button class="btn btn-ghost" id="v4SrtDClose">关闭</button>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">' +
            '<input id="v4SrtDInput" type="search" placeholder="检索关键词（如 最好、第一、赠送）—— 定位到具体时间点" ' +
              'style="flex:1;min-width:220px;font-size:13px">' +
            '<label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:4px">' +
              '<input type="checkbox" id="v4SrtDOnly"> 仅看命中</label>' +
            '<span id="v4SrtDCount" style="font-size:12px;color:var(--text3)"></span>' +
          '</div>' +
        '</div>' +
        '<div id="v4SrtDList" style="flex:1;overflow:auto;padding:10px 18px 24px"></div>' +
        '<div style="padding:8px 18px;border-top:1px solid var(--line);display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span style="font-size:11.5px;color:var(--text3)">时间戳可点击复制，便于回看视频对应位置</span>' +
          '<a href="javascript:void(0)" id="v4SrtDClear" style="margin-left:auto;font-size:11.5px;color:var(--text3)">清空本机归档</a>' +
        '</div>';
      document.body.appendChild(mask);
      document.body.appendChild(dw);
      $('v4SrtDClose').onclick = closeDrawer;
      $('v4SrtDExp').onclick = exportCurrent;
      $('v4SrtDCopy').onclick = copyAll;
      $('v4SrtDInput').oninput = function(){
        KW = this.value.trim();
        clearTimeout(DRAWER_T);
        DRAWER_T = setTimeout(function(){ renderList(true); }, 200);
      };
      $('v4SrtDOnly').onchange = function(){ ONLY_HIT = this.checked; renderList(true); };
      $('v4SrtDClear').onclick = function(){
        if(confirm('清空本机归档的全部逐字稿？此操作只删本机缓存，不影响已导出的文件。')){
          clearArchive(); tip('本机归档已清空');
        }
      };
      $('v4SrtDList').onscroll = function(){
        var el = this;
        if(el.scrollTop + el.clientHeight >= el.scrollHeight - 240){
          if(SHOWN < VIEW.length){ SHOWN = Math.min(VIEW.length, SHOWN + STEP); appendRows(); }
        }
      };
      document.addEventListener('keydown', function(e){
        if(e.key === 'Escape' && DRAWER_OPEN) closeDrawer();
      });
    }
    var CARD_HOST = null, DRAWER_T = null;

    function hl(text, kw){
      var safe = esc(text);
      if(!kw) return safe;
      var out = '', low = safe.toLowerCase();
      var keys = kw.split(/\s+/).filter(Boolean).map(function(k){ return k.toLowerCase(); });
      if(!keys.length) return safe;
      var i = 0;
      while(i < safe.length){
        var hitLen = 0;
        for(var k = 0; k < keys.length; k++){
          if(low.substr(i, keys[k].length) === keys[k]){ hitLen = keys[k].length; break; }
        }
        if(hitLen){
          out += '<mark style="background:#f7ecc9;color:#7a5f1c;padding:0 1px;border-radius:2px">' +
            safe.substr(i, hitLen) + '</mark>';
          i += hitLen;
        }else{ out += safe.charAt(i); i++; }
      }
      return out;
    }
    function match(text, kw){
      if(!kw) return true;
      var low = String(text).toLowerCase();
      return kw.split(/\s+/).filter(Boolean).every(function(k){ return low.indexOf(k.toLowerCase()) >= 0; });
    }
    function rowHtml(seg, kw){
      var ts = seg.from != null
        ? '<span class="v4srt-ts" data-ts="' + hhmmss(seg.from) + '" style="flex:0 0 64px;font-size:11.5px;color:var(--gold);cursor:pointer" title="点击复制时间戳">' + hhmmss(seg.from) + '</span>'
        : '<span style="flex:0 0 64px;font-size:11.5px;color:var(--text3)">#' + seg.i + '</span>';
      return '<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid #f1efe9;line-height:1.65">' +
        ts + '<span style="flex:1;font-size:13px;color:var(--text)">' + hl(seg.text, kw) + '</span></div>';
    }
    function renderList(reset){
      if(!CURRENT) return;
      var all = parseSrt(CURRENT.srt).blocks;
      if(reset){
        VIEW = (KW || ONLY_HIT) ? all.filter(function(s){ return match(s.text, KW); }) : all;
        HITS = KW ? VIEW.length : 0;
        // 检索态一次渲染到 MAX_HITS（用户要看全命中）；浏览态只渲染 STEP（避免 7000 段一次性进 DOM）
        SHOWN = KW ? Math.min(VIEW.length, MAX_HITS) : Math.min(VIEW.length, STEP);
      }
      var box = $('v4SrtDList');
      if(!box) return;
      box.innerHTML = '';
      if(!VIEW.length){
        box.innerHTML = '<div style="padding:24px 0;font-size:13px;color:var(--text3);text-align:center">' +
          (KW ? '没有段落命中「' + esc(KW) + '」' : '本次逐字稿没有可显示的段落') + '</div>';
      }else{
        appendRows();
      }
      var cnt = $('v4SrtDCount');
      if(cnt){
        cnt.textContent = KW
          ? ('命中 ' + HITS + ' / ' + all.length + ' 段' + (HITS > MAX_HITS ? '（仅显示前 ' + MAX_HITS + ' 条）' : ''))
          : (all.length + ' 段 · 已显示 ' + SHOWN);
      }
      var t = $('v4SrtDTitle');
      if(t) t.textContent = metaLine(CURRENT) + (CURRENT.hasTs ? '' : ' · 无时间轴');
    }
    function appendRows(){
      var box = $('v4SrtDList');
      if(!box) return;
      var end = Math.min(VIEW.length, KW ? Math.min(SHOWN, MAX_HITS) : SHOWN);
      var start = box.querySelectorAll('[data-v4srt-row]').length;
      var html = '';
      for(var i = start; i < end; i++){
        html += '<div data-v4srt-row="1">' + rowHtml(VIEW[i], KW) + '</div>';
      }
      if(html) box.insertAdjacentHTML('beforeend', html);
      var more = VIEW.length > end
        ? '<div style="padding:12px 0;text-align:center;font-size:12px;color:var(--text3)">' +
          (KW && end >= MAX_HITS ? '命中过多，仅显示前 ' + MAX_HITS + ' 条 —— 请细化关键词' : '还有 ' + (VIEW.length - end) + ' 段，向下滚动自动加载') + '</div>'
        : '';
      var old = box.querySelector('[data-v4srt-more]');
      if(old) old.remove();
      if(more) box.insertAdjacentHTML('beforeend', '<div data-v4srt-more="1">' + more + '</div>');
      var cnt = $('v4SrtDCount');
      if(cnt && !KW) cnt.textContent = VIEW.length + ' 段 · 已显示 ' + end;
      bindTs();
    }
    // 时间戳点击 → 复制（方便回到视频对应位置）；用事件委托避免逐行绑定
    function bindTs(){
      var box = $('v4SrtDList');
      if(!box || box.__tsBound) return;
      box.__tsBound = true;
      box.addEventListener('click', function(e){
        var t = e.target;
        if(t && t.className === 'v4srt-ts'){
          var v = t.getAttribute('data-ts');
          try{
            if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v);
            else fallbackCopy(v);
            tip('时间戳 ' + v + ' 已复制');
          }catch(x){ tip('时间戳：' + v); }
        }
      });
    }
    function openDrawer(){
      if(!CURRENT){ tip('当前没有可查看的逐字稿'); return; }
      ensureDrawer();
      $('v4SrtMask').style.display = 'block';
      $('v4SrtDrawer').style.display = 'flex';
      document.body.style.overflow = 'hidden';
      DRAWER_OPEN = true;
      renderList(true);
    }
    function closeDrawer(){
      var m = $('v4SrtMask'), d = $('v4SrtDrawer');
      if(m) m.style.display = 'none';
      if(d) d.style.display = 'none';
      if(document.body) document.body.style.overflow = '';
      DRAWER_OPEN = false;
    }

    /* ================= 挂钩：结果渲染完成后采集 ================= */
    function onResult(lane, r){
      if(isOff()) return;
      var rec = normalize(grabFromJob(lane), r);
      if(!rec){
        // 非视频通道（粘贴逐字稿 / 批量）本就没有 SRT：不动 CURRENT，避免误删上一份
        return;
      }
      CURRENT = rec;
      CARD_HOST = cardHost(lane);
      // ⚠️ 顺序：先 renderCard（会重建 #v4SrtTip），再 archivePut
      //   —— 反过来的话 archivePut 的「超单份上限/写入失败」提示会落到即将被丢弃的旧元素上，
      //   用户什么也看不到（2026-09-21 自检 J/G4 实测抓到的真实缺陷）。
      renderCard();
      archivePut(rec);
      renderArchiveBar();
      if(DRAWER_OPEN) renderList(true);
      try{ console.log('[v4.11.20] 逐字稿已就绪：' + metaLine(rec) + '（来源 ' + rec._src + '）'); }catch(e){}
    }
    function isOff(){ try{ return localStorage.getItem(OFF_KEY) === '1'; }catch(e){ return false; } }

    var patched = false;
    function patch(){
      if(patched) return true;
      var need = ['renderResult', 'renderGptDaily'];
      for(var i = 0; i < need.length; i++){ if(typeof window[need[i]] !== 'function') return false; }
      var _rr = window.renderResult;
      window.renderResult = function(r){
        var ret = _rr.apply(this, arguments);
        try{ onResult('daily', r); }catch(e){ console.log('[v4.11.20] 采集跳过:', (e && e.message) || e); }
        return ret;
      };
      var _gd = window.renderGptDaily;
      window.renderGptDaily = function(rd){
        var ret = _gd.apply(this, arguments);
        try{ onResult('vision', rd); }catch(e){ console.log('[v4.11.20] 采集跳过:', (e && e.message) || e); }
        return ret;
      };
      patched = true;
      return true;
    }
    // 刷新后：恢复本机归档的最后一场（让「历史逐字稿」条立刻可用）
    function restoreArchive(){
      var items = loadArchive();
      if(!items.length) return;
      if(!CURRENT && items[0]) adopt(items[0]);
      renderArchiveBar();
    }
    function boot(){
      if(isOff()){ console.log('[v4.11.20] 逐字稿模块已关闭（V4SrtOff）'); return; }
      patch();
      restoreArchive();
      var tries = 0;
      var t = setInterval(function(){
        tries++;
        if(patch() && tries >= 2) clearInterval(t);
        if(tries >= 50) clearInterval(t);
      }, 100);
      window.addEventListener('load', function(){ try{ patch(); }catch(e){} });
    }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

    /* ================= 对外接口（调试 / 自检 / 回退） ================= */
    window.V4Srt = {
      version: '4.11.22',
      parse: parseSrt,
      archive: loadArchive,
      clearArchive: clearArchive,
      adopt: adopt,
      current: function(){ return CURRENT; },
      exportText: function(){ return CURRENT ? CURRENT.srt : ''; },
      fileName: function(){ return CURRENT ? srtName(CURRENT) : ''; },
      meta: function(){ return CURRENT ? metaLine(CURRENT) : ''; },
      open: openDrawer,
      close: closeDrawer,
      export: exportCurrent,
      state: function(){ return { open: DRAWER_OPEN, kw: KW, onlyHit: ONLY_HIT, hits: HITS, shown: SHOWN, total: VIEW.length, off: isOff() }; },
      search: function(kw){ KW = String(kw || '').trim(); var i = $('v4SrtDInput'); if(i) i.value = KW; renderList(true); return HITS; },
      // 自检用：直接注入一份 SRT 走完整渲染链路（不依赖本地引擎）
      inject: function(srt, meta){
        var rec = normalize({ srt: srt, host: (meta && meta.host) || '自检主播', date: (meta && meta.date) || '',
          studio: (meta && meta.studio) || '', product: (meta && meta.product) || '',
          fileName: (meta && meta.fileName) || 'selftest.srt', _src: 'selftest' }, meta || null);
        if(!rec) return false;
        CURRENT = rec; CARD_HOST = cardHost('daily');
        renderCard(); archivePut(rec); renderArchiveBar();
        return true;
      },
      list: function(){ return VIEW.map(function(s){ return { from: s.from, to: s.to, text: s.text }; }); },
      off: function(){
        try{ localStorage.setItem(OFF_KEY, '1'); }catch(e){}
        try{ console.log('[v4.11.20] 逐字稿模块已关闭，刷新页面后生效（V4SrtOn() 可恢复）'); }catch(e){}
        return 'off';
      },
      on: function(){
        try{ localStorage.removeItem(OFF_KEY); }catch(e){}
        try{ console.log('[v4.11.20] 逐字稿模块已恢复，刷新页面后生效'); }catch(e){}
        return 'on';
      }
    };
    // 兼容注释里承诺过的写法：window.V4SrtOff() / window.V4SrtOn()
    window.V4SrtOff = window.V4Srt.off;
    window.V4SrtOn = window.V4Srt.on;
  }catch(e){
    try{ console.log('[v4.11.20] 逐字稿模块跳过:', (e && e.message) || e); }catch(x){}
  }
})();

// ---------- v4.11.21：长视频「一键完整日报」转写超时修复（纯加法，不动 app-core.js / workflow.js） ----------
// 背景（2026-09-21 排查结论，非推测）：
//   v4.11.13 把「单主播评分 · 视频」通道改成了「提交任务 → 轮询进度」，超时不再由视频长度决定；
//   但「一键完整日报」走的是 app-core.js 的 buildFullReport()，它用
//       V4Jobs.cachedRequest(job,'transcription', ASR_URL + '/api/transcribe', upload)
//   而 cachedRequest 的默认总闸是 600 秒（workflow.js:80 → request(...,timeout||600000)）。
//   ⇒ 4 小时视频若走「一键完整日报」，必撞 600 秒墙，报「请求超时，请重试」。
// 修法（遵守「绝不修改 app-core.js，只在壳层加」的铁律）：
//   V4Jobs 是 workflow.js 用 global.V4Jobs = {...} 挂出来的**对象**，cachedRequest 是它的属性，
//   因此壳层可以直接接管这个属性：当调用方请求的是「转写」、且本地引擎支持异步时，
//   改走 /api/transcribe-async + /api/progress 轮询；其余请求（抽帧、逐帧视觉等）原样透传。
//   零侵入：不新增全局副作用、不改 app-core/workflow、不影响任何评分口径。
// 兼容性：返回结构与同步通道一致（{ok:true, srt, info}），同时写入 job.cache[key]，
//   因此 v4.11.20 的逐字稿模块（读 job.cache.transcription.srt）无需改动即可拿到全文。
// 一键回退：V4Async.off()（等价 localStorage.v4_async_full='0'）→ 回到原同步行为。
// 自检：window.V4Async.debug() 看接管计数；详细断言见工作目录 _async_full_* 自检脚本。
(function(){
  try{
    var LS_OFF = 'v4_async_full';
    var LOG = function(m){ try{ console.log('[v4.11.21] ' + m); }catch(e){} };
    var STATS = { hits: 0, async: 0, fallback: 0, lastJobId: '', lastElapsed: 0, lastSegs: 0 };
    function isOff(){ try{ return localStorage.getItem(LS_OFF) === '0'; }catch(e){ return false; } }

    /* ---------- 工具：可取消 + 可超时的 JSON 请求（不依赖 workflow 内部函数） ---------- */
    function fetchJson(url, init, job, timeout){
      var ctrl = new AbortController(), expired = false;
      var sig = job && job.controller && job.controller.signal;
      var onAbort = function(){ ctrl.abort(); };
      if(sig) sig.addEventListener('abort', onAbort, {once:true});
      var t = setTimeout(function(){ expired = true; ctrl.abort(); }, timeout || 60000);
      function done(){ clearTimeout(t); if(sig) sig.removeEventListener('abort', onAbort); }
      return fetch(url, Object.assign({}, init, {signal: ctrl.signal}))
        .then(function(res){
          if(!res.ok){
            var e = new Error('服务返回 HTTP ' + res.status);
            e.httpStatus = res.status;
            throw e;
          }
          return res.json();
        })
        .then(function(d){
          if(!d || d.ok !== true) throw new Error((d && (d.error || d.reason)) || '服务返回无效结果');
          return d;
        })
        .catch(function(e){
          if(job && job.state === 'cancelled') throw new Error('任务已取消');
          if(expired) throw new Error('请求超时，请重试');
          throw e;
        })
        .then(function(v){ done(); return v; }, function(e){ done(); throw e; });
    }

    /* ---------- 引擎能力探测：health.async（30 秒缓存，避免每次转写多打一次） ----------
       ⚠️ 缓存必须**按引擎地址分键**：ASR 地址可在运行时切换（localStorage.asr_url），
          共用一份缓存会把 A 引擎的能力误判给 B 引擎 —— 2026-09-21 自检 D 组实测抓到的真实缺陷
          （切到「旧引擎」后仍走异步接口，回退分支形同虚设）。 */
    var HEALTH_CACHE = {};
    function probe(base, job){
      var now = Date.now(), hit = HEALTH_CACHE[base];
      if(hit && (now - hit.at) < 30000) return Promise.resolve(hit.h);
      return fetchJson(base + '/api/health', {method:'GET'}, job, 8000)
        .then(function(h){ HEALTH_CACHE[base] = { h: h, at: Date.now() }; return h; })
        .catch(function(){ delete HEALTH_CACHE[base]; return null; });
    }

    /* ---------- 异步转写主流程（对应 v4.11.13 在 transcribeVideo 里的同一套协议） ---------- */
    function transcribeAsync(orig, job, key, url, options){
      var J = window.V4Jobs;
      var base = url.replace(/\/api\/transcribe$/, '');
      var t0 = Date.now();
      var fname = (options && options.body && options.body.name) || '视频';
      return probe(base, job).then(function(h){
        if(!h || !h.async){
          STATS.fallback++;
          LOG('引擎不支持异步转写（health.async 缺失）→ 回退同步通道，仍受 600 秒总闸限制');
          return orig.call(J, job, key, url, options);
        }
        LOG('走异步通道提交转写任务：' + fname);
        J.progress(job, '上传视频中…（长视频请勿关闭页面；上传完成后转入后台转写，可取消）');
        return fetchJson(base + '/api/transcribe-async', options, job, 1800000).catch(function(e){
          // 只在「接口不存在」这类确定性失败上回退；其它错误（含网络中断）如实抛出
          if(e && (e.httpStatus === 404 || e.httpStatus === 405 || e.httpStatus === 501)){
            STATS.fallback++;
            LOG('引擎无 /api/transcribe-async（' + e.message + '）→ 回退同步通道');
            return orig.call(J, job, key, url, options);
          }
          throw e;
        }).then(function(start){
          if(start && start.srt !== undefined) return start;   // 已被上面的回退分支接管
          if(!start || !start.jobId) throw new Error('转写服务未返回任务号，请重试或重启本地引擎');
          STATS.lastJobId = start.jobId;
          LOG('任务号 ' + start.jobId + '，开始轮询进度');
          var last = '';
          return (function poll(){
            J.assertActive(job);
            return new Promise(function(r){ setTimeout(r, 1500); }).then(function(){
              J.assertActive(job);
              return fetchJson(base + '/api/progress?jobId=' + encodeURIComponent(start.jobId), {method:'GET'}, job, 20000);
            }).then(function(p){
              if(p.state === 'done'){
                var text = p.srt || '';
                var rec = { ok:true, srt:text, info:'', async:true, jobId:start.jobId,
                            segs:p.segs, chars:p.chars, elapsed:Math.round((Date.now()-t0)/1000) };
                if(job && job.cache) job.cache[key] = rec;     // 与同步 cachedRequest 的缓存语义保持一致
                STATS.async++; STATS.lastElapsed = rec.elapsed; STATS.lastSegs = p.segs || 0;
                LOG('异步转写完成：' + (p.segs || '?') + ' 段 / ' + (p.chars || '?') + ' 字，用时 ' + rec.elapsed + ' 秒');
                J.progress(job, '转写完成：' + (p.segs || 0) + ' 段，用时 ' + rec.elapsed + ' 秒');
                return rec;
              }
              if(p.state === 'error') throw new Error(p.error || '转写失败');
              if(p.state === 'cancelled') throw new Error('转写任务已取消');
              var secs = p.elapsed || Math.round((Date.now()-t0)/1000);
              var msg = (p.phase || '转写中') + (p.percent ? (' ' + p.percent + '%') : '')
                      + (p.segs ? (' · 已完成 ' + p.segs + ' 段') : '') + '（已用时 ' + secs + ' 秒）';
              if(msg !== last){ last = msg; J.progress(job, '后台转写中：' + msg + '，可取消'); }
              return poll();
            });
          })();
        });
      });
    }

    /* ---------- 接管 ---------- */
    var applied = false;
    function apply(){
      if(applied) return true;
      var J = window.V4Jobs;
      if(!J || typeof J.cachedRequest !== 'function' || typeof J.progress !== 'function') return false;
      var orig = J.cachedRequest;
      J.cachedRequest = function(job, key, url, options, timeout){
        try{
          if(!isOff() && key === 'transcription' && typeof url === 'string' &&
             /\/api\/transcribe$/.test(url) && !(job && job.cache && job.cache[key])){
            STATS.hits++;
            return transcribeAsync(orig, job, key, url, options);
          }
        }catch(e){ LOG('接管判断异常，回退原实现：' + ((e && e.message) || e)); }
        return orig.apply(this, arguments);
      };
      applied = true;
      LOG('已接管 V4Jobs.cachedRequest —— 「一键完整日报」的转写不再受 600 秒总闸限制');
      return true;
    }

    // 调试 / 一键回退入口
    window.V4Async = {
      swap: apply,
      on: function(){ try{ localStorage.removeItem(LS_OFF); }catch(e){} return 'on'; },
      off: function(){ try{ localStorage.setItem(LS_OFF, '0'); }catch(e){} return 'off'; },
      offQ: isOff,
      debug: function(){ return JSON.parse(JSON.stringify(STATS)); }
    };

    if(!apply()){
      var tries = 0;
      var t = setInterval(function(){
        tries++;
        if(apply() || tries >= 60) clearInterval(t);
      }, 250);
      window.addEventListener('load', function(){ try{ apply(); }catch(e){} });
    }
  }catch(e){
    try{ console.log('[v4.11.21] 异步转写接管跳过:', (e && e.message) || e); }catch(x){}
  }
})();

// ---------- v4.11.22：历史评分补全「当场报告 6 块」明细（纯加法，app-core.js / workflow.js 一字不动） ----------
// 背景（2026-09-22 排查，全部为实测证据而非推测）：
//   当场报告（单主播评分页 #singleReport，index.html L320-343）有 6 个折叠块：
//     ① 7 大核心卖点覆盖表   ② 信息准确性 · 基准库对照（1.6）  ③ 优秀案例 TOP3 / 不足案例 TOP3
//     ④ 产品识别与讲品分析（多品 · 20 分钟窗口卖点覆盖）  ⑤ 今日金句话术提炼  ⑥ 改进建议（按低分能力）
//   而历史评分存档 grading_detail_v1 只存了 mods（模块分卡 + 逐子点证据）与派生概要，
//   这 6 块的数据从未进过历史链 ⇒ 事后回看某场评分时，这 6 块整体缺失。
//   实测（Chrome Local Storage leveldb，origin http://127.0.0.1:8791，王菲 2026-09-22 那条）：
//     det 字段只有 [bestKey,bestStdId,c1Score,date,fullDaily,grade,host,mods,problem,product,
//                   scoreType,semUsed,strength,studio,tagline,total,ts,worstKey,worstStdId]
//     → sellpoints / baseline / cases / products / golden / training 一个都没有。
// 修法（v4DetailSnapshot 增补 extra + v4DetailHTML 追加 6 块，均为壳层包装）：
//   压缩要点（实测得出）：products.rounds[].grade 是 gradeWindow() 的完整产物，单轮就有 7344 字符，
//   而历史渲染只用到 grade.total / grade.grade ⇒ 压成 {gt,gg}；sellpoints.keywords 只用到长度 ⇒ 压成计数。
//   实测该场 6 块原始 JSON 合计 20013 字符 → 压缩后约 5~6K，单条 detail 由 ~11.5K 升到 ~17K 字符。
// 容量（**不删任何记录**，可逆、非破坏）：
//   localStorage 是单一额度，300 条 × 17K ≈ 5.1M 字符已贴近上限 ⇒ 采用「剥离」而非「删除」：
//   只保留最近 HOLD 条带 6 块明细，更老的记录仅剥离 extra 字段（模块分卡与逐子点证据全部原样保留）。
// 回退：window.V4Extra.off() / .on()；localStorage 键 v4_his_extra_off='1' 即关闭整块。
(function(){
  var LS_OFF = 'v4_his_extra_off';
  var HOLD = 120;            // 保留完整 6 块明细的最近条数
  var BUDGET = 2500000;      // detail 库总字符预算（≈5MB UTF-16），超出即继续剥离最旧的 extra
  var LOG = function(m){ try{ console.log('[v4.11.22] ' + m); }catch(e){} };
  var STATS = { snap: 0, extraBytes: 0, html: 0, trimmed: 0, legacy: 0, empty: 0, lastErr: '' };

  function isOff(){ try{ return localStorage.getItem(LS_OFF) === '1'; }catch(e){ return false; } }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function cut(s, n){ s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function dash(v){ return (v == null || v === '') ? '—' : v; }
  function mapsStr(a, n){ var o = [], i; for(i=0;i<(a||[]).length && i<n;i++) o.push(cut(a[i], 40)); return o; }

  /* ---------- ① 抽取 6 块（紧凑化 + 截断，字段名刻意取短以省体积） ---------- */
  function v4ExtraPick(r){
    var ex = { v: '4.11.22' };
    var i, j, arr;
    if(!r) return ex;
    try{
      var sp = r.sellpoints;
      // ⚠️ v4.11.22 自检修正：一律「字段存在即产出」——
      //    当场报告即使该块为空也有表头/空态文案，历史若整块消失就与当场报告不一致
      //    （2026-09-22 C 组实测抓到：本场 cases 全空时历史里连块都没了，而当场报告显示"未发现…"）
      if(sp && sp.items){
        var spi = [];
        for(i=0;i<sp.items.length;i++){
          var it = sp.items[i] || {}, ev2 = [];
          arr = it.ev || [];
          for(j=0;j<arr.length && j<2;j++) ev2.push({ ts: String((arr[j]||{}).ts||''), ctx: cut((arr[j]||{}).ctx, 120) });
          spi.push({ n: String(it.name||''), c: it.covered?1:0, q: (it.quality == null ? null : it.quality),
                     h: (it.kwHits||0), k: ((it.keywords||[]).length), e: ev2 });
        }
        ex.sp = { p: String(sp.product||''), cov: (sp.covered||0), tot: (sp.total||0), it: spi };
      }
    }catch(e1){ STATS.lastErr = 'sp:' + ((e1 && e1.message) || e1); }
    try{
      var bl = r.baseline;
      if(bl && bl.items){
        var bli = [];
        for(i=0;i<bl.items.length;i++){
          var b = bl.items[i] || {}, bev = b.ev || null;
          bli.push({ f: String(b.field||''), s: String(b.standard||''), w: mapsStr(b.wrong, 4),
                     err: b.error?1:0, num: b.numErr?1:0,
                     ts: String((bev && bev.ts)||''), ctx: cut(bev && bev.ctx, 140) });
        }
        // ⚠️ 实测确认：r.baseline 产物本身只有 {errors, items}，没有 raw 字段 —— 不需要额外排除
        ex.bl = { errs: (bl.errors||0), it: bli };
      }
    }catch(e2){ STATS.lastErr = 'bl:' + ((e2 && e2.message) || e2); }
    try{
      var cs = r.cases;
      if(cs){
        var cg = [], cb = [];
        arr = cs.good || [];
        for(i=0;i<arr.length;i++) cg.push({ m: String(arr[i].mod||''), s: String(arr[i].std||''), ts: String(arr[i].ts||''), ev: cut(arr[i].ev, 300) });
        arr = cs.bad || [];
        for(i=0;i<arr.length;i++) cb.push({ m: String(arr[i].mod||''), s: String(arr[i].std||''), ts: String(arr[i].ts||''), ev: cut(arr[i].ev, 300), miss: cut(arr[i].miss, 80) });
        ex.cs = { g: cg, b: cb };
      }
    }catch(e3){ STATS.lastErr = 'cs:' + ((e3 && e3.message) || e3); }
    try{
      var pd = r.products;
      if(pd && pd.products){
        var pds = [];
        for(i=0;i<pd.products.length;i++){
          var p = pd.products[i] || {}, rds = [];
          arr = p.rounds || [];
          for(j=0;j<arr.length;j++){
            var rd = arr[j] || {}, gr = rd.grade || null;
            rds.push({ t0: String(rd.t0||''), we: String(rd.windowEnd||''),
                       pct: (rd.pct == null ? null : rd.pct), cn: ((rd.covered||[]).length),
                       ms: mapsStr(rd.missed, 12), to: rd.touchOnly?1:0, wc: (rd.winChars||0),
                       gt: (gr && gr.total != null ? gr.total : null), gg: String((gr && gr.grade) || '') });
          }
          pds.push({ n: String(p.name||''), tr: (p.totalRounds||0), tc: (p.touchCount||0),
                     os: (p.overallScore == null ? null : p.overallScore), og: String(p.overallGrade||''),
                     st: (p.sellTotal||0), up: (p.unionPct == null ? 0 : p.unionPct),
                     uc: ((p.unionCovered||[]).length), um: mapsStr(p.unionMissed, 12), rd: rds });
        }
        ex.pd = { tr: (pd.totalRounds||0), ps: pds };
      }
    }catch(e4){ STATS.lastErr = 'pd:' + ((e4 && e4.message) || e4); }
    try{
      var gd = r.golden;
      if(gd && gd.items){
        var gdi = [];
        for(i=0;i<gd.items.length && i<20;i++){
          var g = gd.items[i] || {};
          gdi.push({ t: String(g.type||''), s: (g.star||0), ts: String(g.ts||''), x: cut(g.text, 200), g: (g.tags||[]) });
        }
        ex.gd = { tot: (gd.total||0), s5: (gd.star5||0), it: gdi };
      }
    }catch(e5){ STATS.lastErr = 'gd:' + ((e5 && e5.message) || e5); }
    try{
      arr = r.training || [];
      {
        var tri = [];
        for(i=0;i<arr.length;i++){
          var t2 = arr[i] || {};
          tri.push({ m: String(t2.mod||''), s: (t2.score == null ? null : t2.score),
                     gap: cut(t2.gap, 160), a: cut(t2.action, 220), v: cut(t2.verify, 60) });
        }
        ex.tr = tri;
      }
    }catch(e6){ STATS.lastErr = 'tr:' + ((e6 && e6.message) || e6); }
    return ex;
  }
  function hasExtra(ex){
    return !!(ex && (ex.sp || ex.bl || ex.cs || ex.pd || ex.gd || (ex.tr && ex.tr.length)));
  }

  /* ---------- ② 渲染 6 块（与当场报告同款表格 / 同款 class） ---------- */
  function fold(title, body){
    return '<details style="margin-top:8px;border:1px solid #efe6d2;border-radius:6px;background:#fff">'
      + '<summary style="cursor:pointer;font-size:12px;font-weight:700;color:#5a4632;padding:6px 10px">' + esc(title) + '</summary>'
      + '<div style="padding:8px 10px;border-top:1px dashed #efe6d2">' + body + '</div></details>';
  }
  function v4ExtraHTML(det){
    var ex = (det && det.extra) || {};
    var h = '', i, j;
    // ① 7 大核心卖点覆盖表
    if(ex.sp){
      var sp = ex.sp, b1 = '';
      // ⚠️ 此处刻意不加「考核产品」行：当场报告的 #sellpointTable 只有表格本身，
      //    且 v4DetailHTML 顶部已显示「考核产品：xxx」，重复会与当场报告不一致（自检 C 组实测抓到）
      b1 += '<table><tr><th style="width:26%">核心卖点</th><th style="width:11%">覆盖</th><th style="width:9%">质量</th><th style="width:9%">命中</th><th>证据</th></tr>';
      for(i=0;i<(sp.it||[]).length;i++){
        var it = sp.it[i], evTxt = '';
        for(j=0;j<(it.e||[]).length;j++) evTxt += (j ? '；' : '') + (it.e[j].ts ? it.e[j].ts + ' ' : '') + it.e[j].ctx;
        var qCl = it.q >= 4 ? 'color:var(--ok);font-weight:700' : (it.q === 3 ? 'color:var(--warn);font-weight:700' : 'color:var(--text3)');
        b1 += '<tr><td>' + esc(it.n) + '</td>'
            + '<td>' + (it.c ? '<span class="sp-y">✅ 覆盖</span>' : '<span class="sp-n">❌ 缺失</span>') + '</td>'
            + '<td style="' + qCl + '">' + dash(it.q) + '/5</td><td>' + it.h + '/' + it.k + '</td>'
            + '<td>' + esc(evTxt) + '</td></tr>';
      }
      b1 += '<tr style="background:#faf8f3"><td><b>覆盖合计</b></td><td><b>' + sp.cov + '/' + sp.tot + '</b></td><td colspan="3">'
          + (sp.cov === sp.tot ? '全部覆盖，无漏讲问题' : '存在漏讲卖点，需补讲') + '</td></tr></table>';
      h += fold('7 大核心卖点覆盖表', b1);
    }
    // ② 信息准确性 · 基准库对照（1.6）
    if(ex.bl){
      var bl = ex.bl, b2 = '<table><tr><th>基准项</th><th>标准口径</th><th style="width:18%">判定</th><th>主播表述证据</th></tr>';
      for(i=0;i<(bl.it||[]).length;i++){
        var bi = bl.it[i];
        b2 += '<tr><td>' + esc(bi.f) + '</td><td>' + esc(bi.s) + '</td>'
            + '<td>' + (bi.err ? '<span class="b-bad">❌ 错误</span>' : '<span class="b-ok">✅ 无误</span>') + '</td>'
            + '<td>' + (bi.ctx ? esc(bi.ctx) : '<span style="color:var(--text3)">未出现错误表述</span>') + '</td></tr>';
      }
      b2 += '<tr style="background:#faf8f3"><td colspan="2"><b>信息准确性结论</b></td><td colspan="2"><b class="'
          + (bl.errs === 0 ? 'b-ok' : 'b-bad') + '">' + (bl.errs === 0 ? '基准库 0 错误' : '发现 ' + bl.errs + ' 处错误口径')
          + '</b></td></tr></table>';
      h += fold('信息准确性 · 基准库对照（1.6）', b2);
    }
    // ③ 优秀案例 TOP3 / 不足案例 TOP3
    if(ex.cs){
      var cs = ex.cs, b3 = '<div class="case"><div class="ct">优秀案例 TOP' + (cs.g||[]).length + '</div>';
      if(!(cs.g||[]).length) b3 += '<p>未发现 ≥90 分的高质量证据段落</p>';
      for(i=0;i<(cs.g||[]).length;i++){
        var g1 = cs.g[i];
        b3 += '<p>【' + esc(g1.m) + ' · ' + esc(g1.s) + '】' + (g1.ts ? '<span class="evt">' + esc(g1.ts) + '</span>' : '') + esc(g1.ev) + '</p>';
      }
      b3 += '</div><div class="case"><div class="ct">不足案例 TOP' + (cs.b||[]).length + '</div>';
      if(!(cs.b||[]).length) b3 += '<p>未发现 ≤20 分的明显不足</p>';
      for(i=0;i<(cs.b||[]).length;i++){
        var bd = cs.b[i];
        b3 += '<p>【' + esc(bd.m) + ' · ' + esc(bd.s) + '】' + (bd.ts ? '<span class="evt">' + esc(bd.ts) + '</span>' : '') + esc(bd.ev || ('缺失：' + bd.miss)) + '</p>';
      }
      b3 += '</div>';
      h += fold('优秀案例 TOP3 / 不足案例 TOP3', b3);
    }
    // ④ 产品识别与讲品分析（多品 · 20 分钟窗口）
    if(ex.pd){
      var pd = ex.pd, b4 = '';
      if(!(pd.ps||[]).length){
        b4 = '<div class="evctx" style="color:var(--text3)">未识别到产品讲解片段（逐字稿需含产品名/别名）</div>';
      } else {
      b4 += '<div style="font-size:11.5px;color:var(--text2);margin-bottom:8px">整场识别到 <b>' + (pd.ps||[]).length
          + '</b> 个产品、共 <b>' + (pd.tr||0) + '</b> 次讲品｜考核规则：<b>提到品名即计时，20 分钟窗口内须讲完全部规则卖点；'
          + '窗口内未讲完的卖点单独整理（不因后续补讲免责）</b></div>';
      for(i=0;i<(pd.ps||[]).length;i++){
        var p = pd.ps[i], hasMiss = (p.um||[]).length > 0;
        b4 += '<div style="border:1px solid ' + (hasMiss ? '#f5c6bd' : 'var(--border)') + ';border-radius:8px;background:var(--card);margin-bottom:10px;overflow:hidden">';
        b4 += '<div style="padding:8px 12px;background:#faf8f3;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--border)">'
            + '<b style="font-size:12.5px">' + esc(p.n) + '</b>'
            + '<span style="font-size:11px;color:var(--text2)">正式讲品 <b>' + p.tr + '</b> 次'
            + (p.tc ? '（另有顺带提及 ' + p.tc + ' 次，不计考核）' : '') + '</span>'
            + (p.os !== null ? '<span style="font-size:11.5px;font-weight:700;color:' + (p.os >= 75 ? 'var(--ok)' : (p.os < 45 ? 'var(--danger)' : 'var(--warn)')) + '">单品整体 ' + p.os + ' 分（' + esc(p.og) + '级）</span>' : '')
            + '<span style="margin-left:auto;font-size:11.5px;font-weight:600;color:' + (p.up >= 90 ? 'var(--ok)' : (p.up < 70 ? 'var(--danger)' : 'var(--warn)')) + '">整体覆盖 ' + p.up + '%</span></div>';
        b4 += '<div style="padding:8px 12px">';
        b4 += '<table><tr><th style="width:13%">讲品轮次</th><th style="width:17%">起始</th><th style="width:12%">20分钟覆盖</th><th style="width:13%">单轮评分</th><th>20 分钟内未讲到的卖点（待改进）</th></tr>';
        for(j=0;j<(p.rd||[]).length;j++){
          var rd = p.rd[j];
          if(rd.to){
            b4 += '<tr style="opacity:.55"><td>顺带提及</td><td>' + (rd.t0 || '—') + '</td><td colspan="3" style="font-size:11px;color:var(--text3)">窗口内话术仅 ' + rd.wc + ' 字（&lt;80 字阈值），不计入考核</td></tr>';
            continue;
          }
          var rc = rd.pct >= 90 ? 'var(--ok)' : (rd.pct < 70 ? 'var(--danger)' : 'var(--warn)');
          var rgTxt = (rd.gt != null) ? '<b style="color:' + (rd.gt >= 75 ? 'var(--ok)' : (rd.gt < 45 ? 'var(--danger)' : 'var(--warn)')) + '">' + rd.gt + '分</b><span style="font-size:10px;color:var(--text3)">(' + esc(rd.gg) + '级)</span>' : '—';
          b4 += '<tr><td>第 ' + (j+1) + ' 轮</td><td>' + (rd.t0 || '—') + (rd.we ? ' ~ ' + rd.we : '') + '</td>'
              + '<td><b style="color:' + rc + '">' + rd.pct + '%</b>（' + rd.cn + '/' + p.st + '）</td>'
              + '<td>' + rgTxt + '</td>'
              + '<td>' + ((rd.ms||[]).length ? '<span class="miss">' + esc(rd.ms.join('、')) + '</span>' : '<span class="b-ok">全部覆盖 ✓</span>') + '</td></tr>';
        }
        if(p.tr > 1){
          b4 += '<tr style="background:#faf8f3"><td><b>合并汇总</b></td><td>所有轮次</td><td><b>' + p.up + '%</b>（' + p.uc + '/' + p.st + '）</td>'
              + '<td>' + ((p.um||[]).length ? '<span class="miss">' + esc(p.um.join('、')) + '</span>' : '<span class="b-ok">全部覆盖 ✓</span>') + '</td></tr>';
        }
        b4 += '</table>';
        if(hasMiss){
          b4 += '<div style="margin-top:8px;font-size:11.5px;color:var(--danger);background:#fdecea;border-radius:6px;padding:6px 10px">⚠ 该品存在 20 分钟窗口内未讲完的卖点：'
              + esc(p.um.join('、')) + '——整理为讲品改进项，后续优化讲品顺序与完整性</div>';
        }
        b4 += '</div></div>';
      }
      }
      h += fold('产品识别与讲品分析（多品 · 20 分钟窗口卖点覆盖）', b4);
    }
    // ⑤ 今日金句
    if(ex.gd){
      var gd = ex.gd, b5 = '';
      if(!(gd.it||[]).length){
        b5 = '<div class="evctx" style="color:var(--text3)">本场未发现 3 星及以上金句话术（话术均为普通表达）</div>';
      } else {
      b5 += '<div style="font-size:11.5px;color:var(--text2);margin-bottom:8px">今日提炼 <b>' + gd.tot + '</b> 句（3 星以上 <b>'
          + (gd.it||[]).length + '</b> 句展示，5 星 <b>' + gd.s5 + '</b> 句）——已自动入库话术库</div>';
      b5 += '<table><tr><th style="width:16%">话术分类</th><th style="width:9%">评分</th><th>金句（时间戳）</th><th style="width:18%">标签</th></tr>';
      for(i=0;i<(gd.it||[]).length;i++){
        var g2 = gd.it[i], star = '';
        for(j=0;j<g2.s;j++) star += '★';
        var sCl = g2.s >= 5 ? 'color:var(--danger);font-weight:700' : 'color:var(--gold);font-weight:700';
        b5 += '<tr><td>' + esc(g2.t) + '</td><td><span style="' + sCl + '">' + star + '</span></td>'
            + '<td>' + (g2.ts ? '<span class="evt">' + esc(g2.ts) + '</span>' : '') + esc(g2.x) + '</td>'
            + '<td>' + esc((g2.g||[]).join('·')) + '</td></tr>';
      }
      b5 += '</table>';
      }
      h += fold('今日金句话术提炼（黄金话术库）', b5);
    }
    // ⑥ 改进建议（按低分能力）
    if(ex.tr && ex.tr.length){
      var b6 = '<table><tr><th style="width:16%">低分能力</th><th style="width:9%">能力分</th><th style="width:28%">能力缺口（问题证据）</th><th>训练动作（可执行）</th><th style="width:15%">下周验证</th></tr>';
      for(i=0;i<ex.tr.length;i++){
        var t3 = ex.tr[i];
        b6 += '<tr><td><b>' + esc(t3.m) + '</b></td><td><b class="' + (t3.s < 45 ? 'lo' : 'mid') + '">' + dash(t3.s) + '</b></td>'
            + '<td style="font-size:11.5px;color:var(--warn)">' + esc(t3.gap) + '</td>'
            + '<td style="font-size:11.5px">' + esc(t3.a) + '</td>'
            + '<td style="font-size:11.5px;color:var(--ok)">' + esc(t3.v) + '</td></tr>';
      }
      b6 += '</table>';
      h += fold('改进建议（按低分能力）', b6);
    }
    return h;
  }

  /* ---------- ③ 容量护栏：只「剥离」不「删除」（可逆、非破坏） ---------- */
  function v4ExtraTrim(){
    try{
      var ds = v4ReadLS('grading_detail_v1', '[]');
      if(!ds || !ds.length) return;
      var changed = false, i;
      for(i=0;i<ds.length;i++){
        if(ds[i] && ds[i].extra && (ds.length - i) > HOLD){ delete ds[i].extra; ds[i].extraTrimmed = 1; changed = true; STATS.trimmed++; }
      }
      var total = JSON.stringify(ds).length, guard = 0;
      for(i=0;i<ds.length && total > BUDGET && guard < 400;i++, guard++){
        if(ds[i] && ds[i].extra){ total -= JSON.stringify(ds[i].extra).length; delete ds[i].extra; ds[i].extraTrimmed = 1; changed = true; STATS.trimmed++; }
      }
      if(changed) localStorage.setItem('grading_detail_v1', JSON.stringify(ds));
    }catch(e){ LOG('容量护栏异常：' + ((e && e.message) || e)); }
  }

  /* ---------- ④ 接管（包装三个顶层函数，均为运行时查找，patch 生效） ---------- */
  function apply(){
    var ok = 0;
    if(typeof v4DetailSnapshot === 'function'){
      var _snap = v4DetailSnapshot;
      v4DetailSnapshot = function(r, ts){
        var det = _snap.apply(this, arguments);
        try{
          if(!isOff() && det && r){
            var ex = v4ExtraPick(r);
            if(hasExtra(ex)){
              det.extra = ex; det.extraV = '4.11.22';
              STATS.snap++; STATS.extraBytes = JSON.stringify(ex).length;
            }
          }
        }catch(e1){ STATS.lastErr = 'snap:' + ((e1 && e1.message) || e1); LOG('extra 抽取异常：' + STATS.lastErr); }
        return det;
      };
      ok++;
    }
    if(typeof v4DetailHTML === 'function'){
      var _html = v4DetailHTML;
      v4DetailHTML = function(det){
        var h = _html.apply(this, arguments);
        try{
          if(!isOff() && det){
            if(det.extra && hasExtra(det.extra)){ h += v4ExtraHTML(det); STATS.html++; }
            else if(det.extraTrimmed){
              h += '<div class="v4his-none" style="margin-top:8px">该记录已超出 6 块明细保留窗口（最近 ' + HOLD + ' 条保留完整明细），模块分卡与逐子点判定证据仍在下方完整保留</div>';
            }
            else if(!det.extraV){
              STATS.legacy++;
              h += '<div class="v4his-none" style="margin-top:8px">该记录产生于 v4.11.22 之前，未沉淀「7 大核心卖点覆盖表 / 基准库对照 / TOP3 案例 / 产品识别与讲品分析 / 今日金句 / 改进建议」这 6 块明细；重新评分后即会完整沉淀</div>';
            } else { STATS.empty++; }
          }
        }catch(e2){ LOG('extra 渲染异常：' + ((e2 && e2.message) || e2)); }
        return h;
      };
      ok++;
    }
    if(typeof v4DetailSave === 'function'){
      var _save = v4DetailSave;
      v4DetailSave = function(r){
        var out = _save.apply(this, arguments);
        try{ if(!isOff()) v4ExtraTrim(); }catch(e3){ LOG('护栏调用异常：' + ((e3 && e3.message) || e3)); }
        return out;
      };
      ok++;
    }
    return ok;
  }

  window.V4Extra = {
    swap: apply,
    on: function(){ try{ localStorage.removeItem(LS_OFF); }catch(e){} return 'on'; },
    off: function(){ try{ localStorage.setItem(LS_OFF, '1'); }catch(e){} return 'off'; },
    offQ: isOff,
    hold: function(){ return HOLD; },
    budget: function(){ return BUDGET; },
    pick: v4ExtraPick,
    render: v4ExtraHTML,
    trim: v4ExtraTrim,
    debug: function(){ return JSON.parse(JSON.stringify(STATS)); }
  };

  var n = apply();
  LOG('历史评分 6 块明细补全已装载：接管 ' + n + '/3 个函数（HOLD=' + HOLD + ' 条，预算 ' + BUDGET + ' 字符）');
})();

// ---------- v4.11.23：主播名识别「白名单优先」 ----------
// 背景（2026-09-23 实测）：文件名「2026-09-22-摩登-全程-PISTACHIO2.mkv」
//   （命名约定 = 日期-直播间简称-主播-产品）→ 主播被识别成「摩登」（直播间简称），实际应为「全程」。
// 根因：app-core.js:1505 的「直播修饰词」剥离正则里含「全程」，把主播名「全程」当"全程直播"剥离；
//   剥完只剩「摩登」，而 v4.11.5 的清洗带 `cleaned !== sh` 守卫（恰好等于直播间简称时不剥离）→ 留在主播栏。
// 同类缺陷（同一次实测发现）：
//   「2026-09-20-轻熟-（杨光来）-TRUFFLE PRO BACKPACK+TRUFFLE TWO.mkv」→ host 空
//   「2026-09-10-轻熟-曲姝锜-TRUFFLE PRO BACKPACK.mkv」→ host 空
//   原因：产品名剥不干净残留「+」/英文，末尾 /^[一-龥]+$/ 校验失败 ⇒ host 不赋值。
//   ⇒ 结论：「剥离法」本身脆弱（主播名撞词、符号残留），改为「白名单命中」优先。
//
// 白名单真源 = OUTFIT_STANDARD.hosts（设置页「主播 / 直播间」表的数据源，当前 21 位）
//   ⇒ 新增/调整主播只改那份数据，本块无需改动。
// 纯加法 monkey-patch：不改 app-core.js，只在 v4.11.5 之后再接管 window.autoDetectMeta。
// 回退：设 window.__v4HostPatchOff = true 即整体失效（删掉本块亦可）。
(function(){
  try{
    if(typeof window === 'undefined' || typeof window.autoDetectMeta !== 'function') return;

    var prev = window.autoDetectMeta;
    var DICT = null;

    function buildDict(){
      var d = [];
      try{
        var h = (typeof OUTFIT_STANDARD !== 'undefined' && OUTFIT_STANDARD && OUTFIT_STANDARD.hosts) || {};
        for(var n in h){ if(n && n.length >= 2 && d.indexOf(n) < 0) d.push(n); }
      }catch(e){}
      try{
        if(typeof V4_STAR_HOSTS !== 'undefined' && V4_STAR_HOSTS){
          for(var i=0;i<V4_STAR_HOSTS.length;i++){
            if(V4_STAR_HOSTS[i] && d.indexOf(V4_STAR_HOSTS[i]) < 0) d.push(V4_STAR_HOSTS[i]);
          }
        }
      }catch(e){}
      // 长名优先：避免「张天翊」被更短的名单项抢先命中
      d.sort(function(a,b){ return b.length - a.length; });
      return d;
    }

    // 独立段判据：词的前后都不是中文（命名约定里主播独占一段，如 `-全程-`、`（杨光来）`）
    function segHit(base, w){
      var esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(?:^|[^\\u4e00-\\u9fa5])' + esc + '(?:[^\\u4e00-\\u9fa5]|$)').test(base);
    }

    window.autoDetectMeta = function(filename){
      var meta = prev.call(this, filename) || {studio:'', host:'', date:''};
      try{
        if(window.__v4HostPatchOff) return meta;
        if(!DICT || !DICT.length) DICT = buildDict();
        var base = String(filename || '').replace(/\.[^.]*$/, '');
        if(!base || !DICT.length) return meta;
        // 只认「独立段」命中：主播名前后必须是非中文（命名约定里主播独占一段，如 -全程- / （杨光来））。
        // 刻意不做「包含」兜底 —— 2026-09-23 实测：「2026-09-22-全程直播录屏.mkv」的"全程"会被
        // 宽松包含误判成主播名（"全程直播"是修饰语，不是人名）。独立段判据天然排除该误伤。
        var i, hit = '';
        for(i=0;i<DICT.length;i++){ if(segHit(base, DICT[i])){ hit = DICT[i]; break; } }
        if(hit && meta.host !== hit){
          if(typeof console !== 'undefined'){
            console.log('[v4.11.23] 主播白名单命中「' + hit + '」→ 覆盖原识别「' + (meta.host || '空') + '」｜' + filename);
          }
          meta.host = hit;
        }
      }catch(e){}
      return meta;
    };

    if(typeof console !== 'undefined') console.log('[v4.11.23] autoDetectMeta 已再接管：已知主播名白名单优先');
  }catch(e){ if(typeof console !== 'undefined') console.log('[v4.11.23] 识别接管跳过:', (e && e.message) || e); }
})();

// ---------- v4.11.24：完整主播报告云端共享（历史评分全员可见 + 详情云端回退） ----------
// 背景（老大 2026-09-23 报障）：「我或其他人上传评分转译，拿到工作台链接的人都应能看到完整记录」。
// 实测根因（见技能 grading-semantic-endpoint-troubleshoot 第 9 节）：
//   完整记录只存本机 localStorage.grading_detail_v1（按 origin 隔离），飞书链路只回摘要
//   ⇒ 换人 / 换机器 / 换入口后必然「只有摘要、展开为空」。
// 方案（纯壳层加法，不改 app-core.js；飞书「完整主播报告」多行文本列由老大已加好）：
//   ① 评分时把 v4DetailSnapshot() 产出的完整快照 JSON 注入 payload（r.v4Report）
//      → 随既有 sync 链路写到飞书两张表的「完整主播报告」列
//      ⚠️ 2026-09-23 实测发现并规避：飞书「多行文本」在字节边界会切断多字节中文 → U+FFFD 乱码
//         （原始 JSON 14,717 字符写入后读回 +2 字符含 3 个 U+FFFD；22,026 字符版 +3 含 5 个）
//         ⇒ 写入前统一转成纯 ASCII（中文 → \uXXXX 字面转义），纯 ASCII 无多字节边界可切
//         实测 14.7K / 22K / 65K / 81.8K 四种规模：往返差 0、U+FFFD 0、JSON.parse 后中文完好
//         读取侧无需改动（JSON.parse 自动还原）；官方单格上限 100,000 ⇒ 转义后余量约 2.9 倍
//   ② 历史 tab 合并飞书「历史评分」表 → 全员评分记录可见（不再只有自己那几条）
//   ③ 展开详情时本机无档 → 回退云端「完整主播报告」→ 完整报告可见
// 回退：localStorage.setItem('v4rpt_enabled','0') + 刷新
// 诊断：V4RPT.debug()（总览）｜ V4RPT.probe(ts, host)（单条为何展不开）｜ V4RPT.refresh(1)（强制刷新）
//
// ★ 2026-09-23 二次修复（老大：「先把我的需求完善好」）—— 上一版有三个会让报告「明明有却看不到」的硬缺陷：
//   A. 键口径不一致：DET_MAP 键用归一化日期（2026-08-18），IDX_MAP 却存原始日期（2026-8-18）
//      ⇒ 本机摘要日期为非标格式时两键对不上，云端有报告也查不出来（必然空态）
//   B. 刷新只做一次（refreshDone 一次性）⇒ 同事刚上传的记录，不整页刷新就永远看不到
//      —— 这与「拿到链接的人都能看到」的需求直接冲突
//   C. 展开完全依赖「ts→日期→报告」反查，格式一乱就断链
//   修法：① 全链路统一 ddate()/dkey() 单一口径；② 合并时用 TS_DET 按「ts|host」把报告直接挂到行上，
//        展开时优先命中该直挂结果，不再依赖日期反查；③ 刷新改 8s 防抖 + 可重复触发 + 失败可重试，
//        真实请求频率由底层 V4CLOUD.TTL(60s) 控制，不会打爆飞书限流；④ 底部与空态文案改为准确表述。
(function(){
  try{
    if(typeof window === 'undefined' || typeof document === 'undefined') return;
    if(window.V4RPT && window.V4RPT.__installed) return;
    try{ if(localStorage.getItem('v4rpt_enabled') === '0'){ console.log('[v4.11.24] 已被 v4rpt_enabled=0 关闭'); return; } }catch(e){}

    var RPT_FIELD = '完整主播报告';
    var RPT_MAX = 95000;                 // 飞书官方单格上限 100,000 留余量；v4.11.27 起按**中文原文字符数**计（不再有转义膨胀）
    var DET_MAP = Object.create(null);   // 'host|YYYY-MM-DD' → det 对象（云端完整报告；键一律归一化）
    var TS_DET = Object.create(null);    // 'ts|host' → det（渲染时按行精确挂好，免日期反查）
    var IDX_MAP = Object.create(null);   // 'ts|host' → 'YYYY-MM-DD'（供 v4DetailByTs 反查云端）
    var CLOUD_ROWS = null;               // 云端摘要行（date 已归一化）
    var LOADING = false, LOADED = false, FAILS = 0;
    var LAST_OK_TS = 0;                  // 上次成功拉取时刻（只用于 UI 判断数据新鲜度，不做短路）
    var LAST_UI_TS = 0;                  // 上次触发刷新时刻（8s 防抖，兼作递归保护）
    var IN_RENDER = false;               // 重渲染中标志（防 _ar 内部再触发本函数）
    var PENDING = null;                  // ensureCloud 进行中的 Promise（防并发重取）
    var _ar = null;                      // 见 ⑥ 段末尾赋值（原 v4ArchRender）
    var TIP_ID = 'v4rpt-tip';

    function log(m){ try{ console.log('[v4.11.24] ' + m); }catch(e){} }
    function normDate(s){ try{ return (typeof v4NormDate === 'function') ? v4NormDate(s) : {m:'',d:''}; }catch(e){ return {m:'',d:''}; } }
    // ★ 统一「主播+日期」键（2026-09-23 二次修复）
    //   上一版缺陷：DET_MAP 写的是归一化日期（2026-08-18），IDX_MAP 存的却是原始日期（2026-8-18）
    //   本机摘要有 '2026-8-18' 这类非标格式时两键对不上 ⇒ 云端明明有报告也查不出来（必然空态）
    //   现在写/读两侧一律走 ddate() / dkey()，单一口径；ddate 幂等（'2026-8-18' 与 '2026-08-18' 归一相同）
    function ddate(s){ var nd = normDate(s); return nd.d || String(s || ''); }
    function dkey(host, date){ return String(host) + '|' + ddate(date); }
    function boxOf(){ return document.getElementById('v4arch-history'); }
    function esc2(v){ try{ return (typeof esc === 'function') ? esc(v) : String(v == null ? '' : v); }catch(e){ return String(v == null ? '' : v); } }

    // ---------- 写入格式：直接写中文原文（v4.11.27 起） ----------
    // v4.11.24 曾判定「飞书多行文本在字节边界切断中文 → U+FFFD」，于是把写入内容整体转成
    // \uXXXX 纯 ASCII 规避乱码。副作用：飞书表格里显示成一长串代码，人不可读（老大 2026-09-23 反馈）。
    // v4.11.27 实测推翻该判定 —— 根因不在飞书存储，而在**读取端逐 chunk 解码**：
    //   · 直连飞书写入 23,266 字符原始中文 → 读回 23,266 字符，逐字节一致、U+FFFD = 0
    //     ⇒ 飞书「多行文本」存中文完全无损，与长度 / 字节边界无关
    //   · 同一响应（11 分块 / 137,467 字节）内双解码对照：
    //       `d += c`（隐式逐 chunk utf8）→ 3 处 U+FFFD ；Buffer.concat 后解码 → 0 处
    //   · 本地可复现（按 512~2048 字节人为切块）：512B → 50 处乱码、1000B → 23 处，Buffer.concat 恒 0
    //     ⇒ api/*.js 已同步补 res.setEncoding('utf8')，从根上消除乱码
    // 因此不再转义：飞书格子里直接是可读中文，体积同时缩小约 2.8 倍（同上限可容纳更完整报告）。
    // toAscii 仅保留导出作排障工具，不再参与写入。
    function toAscii(s){
      return String(s).replace(/[\u0080-\uFFFF]/g, function(c){
        return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
      });
    }
    // 超限降级：只压「字符串长度」，绝不动结构（保证 JSON 始终可解析）
    // ⚠️ 不能直接 s.slice(0, RPT_MAX)：会切出非法 JSON ⇒ 读取侧 JSON.parse 失败 ⇒ 整条明细白丢
    function deepCap(o, cap){
      var n = 0;
      function walk(v){
        if(!v || typeof v !== 'object') return;
        if(Object.prototype.toString.call(v) === '[object Array]'){
          for(var i=0;i<v.length;i++){
            var x = v[i];
            if(typeof x === 'string'){ if(x.length > cap){ v[i] = x.slice(0, cap); n++; } }
            else walk(x);
          }
          return;
        }
        for(var k in v){
          if(!Object.prototype.hasOwnProperty.call(v, k)) continue;
          var y = v[k];
          if(typeof y === 'string'){ if(y.length > cap){ v[k] = y.slice(0, cap); n++; } }
          else walk(y);
        }
      }
      walk(o);
      return n;
    }
    function fit(det){
      var s = JSON.stringify(det);
      if(s.length <= RPT_MAX) return s;
      var d2;
      try{ d2 = JSON.parse(JSON.stringify(det)); }catch(e){ return ''; }
      var caps = [300, 200, 120, 80, 40, 20, 8, 0];
      for(var i=0;i<caps.length;i++){
        deepCap(d2, caps[i]);
        s = JSON.stringify(d2);
        if(s.length <= RPT_MAX){ log('快照超限 → 文本降级至 ' + caps[i] + ' 字（结构完整，仍可展开）'); return s; }
      }
      log('快照超限且降级无效（' + s.length + ' > ' + RPT_MAX + '）→ 本条不写云端报告，仅本机留档');
      return '';
    }

    // ================= ① 评分时生成完整快照 =================
    function buildReport(r){
      try{
        if(!r || typeof r !== 'object') return '';
        if(typeof r.total !== 'number' || !r.host || r.host === '未识别') return '';
        if(typeof v4DetailSnapshot !== 'function') return '';
        var det = v4DetailSnapshot(r, Date.now());
        if(!det || !det.mods || !det.mods.length) return '';
        return fit(det);
      }catch(e){ log('快照生成异常: ' + ((e && e.message) || e)); return ''; }
    }
    function inject(r){
      try{
        if(!r || typeof r !== 'object' || r.v4Report) return;
        var s = buildReport(r);
        if(s){ r.v4Report = s; log('已为 ' + r.host + ' ' + r.date + ' 准备好完整报告 ' + s.length + ' 字符'); }
      }catch(e){}
    }

    // ================= ② 挂到写飞书的两条既有链路上 =================
    // 通路 A：autoFillFeishu(r) → V4Jobs.sync(r) → post(feishu-fill, {result:publicResult(r)})
    //         publicResult 的 replacer 只剔除「__」前缀键 ⇒ v4Report 会保留 ⇒ 服务端可读到
    // 通路 B：syncFeishuLibs(r) → V4Jobs.syncLibs(r) → buildFeishuLibPayload(r) → feishu-sync
    //         该函数读原始 r（不经 publicResult）⇒ 直接可用
    try{
      if(typeof window.addHistoryRecord === 'function'){
        var _ah = window.addHistoryRecord;
        window.addHistoryRecord = function(r){ inject(r); return _ah.apply(this, arguments); };
      }
    }catch(e){}
    try{
      if(typeof window.autoFillFeishu === 'function'){
        var _af = window.autoFillFeishu;
        window.autoFillFeishu = function(r){ inject(r); return _af.apply(this, arguments); };
      }
    }catch(e){}
    try{
      if(window.V4Jobs && typeof window.V4Jobs.sync === 'function'){
        var _js = window.V4Jobs.sync;
        window.V4Jobs.sync = function(r){ inject(r); return _js.apply(this, arguments); };
      }
    }catch(e){}
    try{
      if(typeof window.buildFeishuLibPayload === 'function'){
        var _bl = window.buildFeishuLibPayload;
        window.buildFeishuLibPayload = function(r){
          var p = _bl.apply(this, arguments);
          try{ if(p && p.history && p.history.length && r && r.v4Report) p.history[0].report = r.v4Report; }catch(e){}
          return p;
        };
      }
    }catch(e){}

    // ================= ③ 云端拉取（历史评分表） =================
    // ⚠️ 本层不做自身 TTL 短路（2026-09-23 二次修复）：
    //    上一版「LOADED 后直接返回缓存」= 页面生命周期内只拉一次 ⇒ 同事刚评完、我这边
    //    切到历史 tab 也永远看不到（要整页刷新）。现在每次都走底层，由底层 V4CLOUD.TTL(60s)
    //    控制真实请求频率；force=true 时连底层缓存一并清掉，用于「立即刷新」逃生阀。
    function ensureCloud(force){
      if(LOADING) return PENDING || Promise.resolve(CLOUD_ROWS);
      if(typeof window.v4FsEnsure !== 'function') return Promise.resolve(null);
      if(force){
        try{ if(window.V4CLOUD && window.V4CLOUD.cache) delete window.V4CLOUD.cache['history']; }catch(e){}
      }
      LOADING = true;
      var badReport = 0;
      var p = window.v4FsEnsure('history').then(function(d){
        var rows = (d && d.rows) || [];
        var out = [];
        for(var i=0;i<rows.length;i++){
          var x = rows[i] || {};
          var host = String(x['主播'] || '').trim();
          if(!host) continue;
          var date = ddate(x['标准日期'] || x['日期'] || '');
          if(!date) continue;
          var rep = x[RPT_FIELD];
          if(typeof rep === 'string' && rep.length > 20){
            try{
              var det = JSON.parse(rep);
              if(det && det.mods && det.mods.length) DET_MAP[dkey(host, date)] = det;
              else { badReport++; log('报告结构异常（无 mods）: ' + host + ' ' + date); }
            }catch(e){
              badReport++;
              log('报告解析失败（' + host + ' ' + date + '，' + rep.length + ' 字符）: ' + ((e && e.message) || e));
            }
          }
          out.push({ host: host, date: date,
            total: x['总分'] || x['历史总分(数值)'] || '—',
            c1Score: x['c1产品理解'] || x['产品理解(数值)'] || '',
            product: x['产品'] || '', grade: x['等级'] || '', _src: 'cloud' });
        }
        CLOUD_ROWS = out; LOADED = true; LOADING = false; FAILS = 0; LAST_OK_TS = Date.now();
        log('云端历史评分 ' + out.length + ' 条，其中含完整报告 ' + Object.keys(DET_MAP).length + ' 条' +
            (badReport ? '（解析失败 ' + badReport + ' 条）' : ''));
        return out;
      })['catch'](function(e){
        LOADING = false; FAILS++;
        log('云端拉取失败（第 ' + FAILS + ' 次）: ' + ((e && e.message) || e));
        return null;
      });
      PENDING = p;
      return p;
    }
    // ================= ④ 历史列表合并（本机优先，云端补齐） =================
    function mergeHistory(local){
      var map = Object.create(null), order = [];
      function keyOf(x){ return (x && x.host) ? dkey(x.host, x.date) : ''; }
      (local || []).forEach(function(x){ var k = keyOf(x); if(!k) return; if(!map[k]) order.push(k); map[k] = x; });
      (CLOUD_ROWS || []).forEach(function(x){ var k = keyOf(x); if(!k) return; if(!map[k]){ order.push(k); map[k] = x; } });
      var out = order.map(function(k){ return map[k]; });
      out.forEach(function(x){
        try{
          // 展示口径统一：'2026-8-18' → '2026-08-18'（分组本就靠 v4NormDate，显示统一更整齐）
          var dd = ddate(x.date);
          if(dd) x.date = dd;
          // 补「确定性 ts」：云端行没有 ts；本机老摘要也可能缺 ts。
          // ts 既用于排序，也供 v4DetailByTs(ts, host) 反查该行日期 ⇒ 缺它这一行就永远展不开。
          if(x.ts == null && x.date){
            var t = Date.parse(String(x.date).replace(/-/g, '/') + ' 12:00:00');
            if(!isNaN(t)) x.ts = t;
          }
          // ⚠️ 必须存「归一化日期」，与 DET_MAP 的键口径一致
          //    上一版这里存的是原始日期 ⇒ 本机 '2026-8-18' 去查 DET_MAP 的 '2026-08-18' 必然落空
          if(x.ts != null && x.host){
            var kk = String(x.ts) + '|' + x.host;
            IDX_MAP[kk] = ddate(x.date);
            // ★ 关键一步：合并时就把该行应有的报告按行挂好。
            //   无论本机行遮住云端行、还是日期格式再乱，展开时只需 ts+host 就能命中，不依赖任何反查。
            var hit = DET_MAP[dkey(x.host, x.date)];
            if(hit) TS_DET[kk] = hit;
            /* 🔴 v4.11.43 修「云端行的撤销按钮必失效」—— 同一份报告要挂**两条键**。
               事实（2026-10-14 线上真机实测）：这条 x.ts 是**按日期推导**出来的
                 （见上方 x.ts == null 分支：Date.parse(日期 + ' 12:00:00')），
                 而报告 det 内部另有一个 ts = 当年存报告那台机器的真实时刻，两者**不相等**；
                 同一天的所有云端行，推导 ts 还完全相同。
               而历史详情渲染时，按钮带的是 **det.ts**（historyBlock 传 { ts: det.ts, host: det.host }），
                 点下去又用 det.ts 去查 ⇒ 只挂行 ts 的话必然查不到自己
                 ⇒ 弹「找不到该条历史记录（可能已被清理），未做任何改动。」
               ⇒ 这里把 det 自身 ts 也挂一份（IDX_MAP 同挂，供"按 ts 反查日期"的兜底路径用）。
               ⚠️ 只挂第一份、不覆盖：同 ts 不同 host 各行互不干扰（键含 host）。 */
            var dts = (hit && hit.ts != null) ? hit.ts : null;
            if(dts != null && String(dts) !== String(x.ts)){
              var kk2 = String(dts) + '|' + x.host;
              if(!TS_DET[kk2]) TS_DET[kk2] = hit;
              if(!IDX_MAP[kk2]) IDX_MAP[kk2] = ddate(x.date);
            }
          }
        }catch(e){}
      });
      return out;
    }

    // ================= ⑤ 接管三个读取入口 =================
    var _ad = window.v4ArchData;
    if(typeof _ad === 'function'){
      window.v4ArchData = function(type){
        var out = _ad.apply(this, arguments);
        if(type !== 'history') return out;
        try{ return mergeHistory(out); }catch(e){ return out; }
      };
    }

    var _db = window.v4DetailByTs;
    if(typeof _db === 'function'){
      window.v4DetailByTs = function(ts, host){
        var d = null;
        try{ d = _db.apply(this, arguments); }catch(e){}
        if(d) return d;                                  // 本机有明细 → 优先（本机版最完整）
        try{
          var kk = String(ts) + '|' + String(host);
          if(TS_DET[kk]) return TS_DET[kk];              // ① 合并时按行挂好的云端报告（首选，不依赖日期）
          var date = IDX_MAP[kk];
          if(!date){                                     // ② 云端尚未拉回时，从本机摘要反查日期
            var lib = v4ReadLS('grading_history_v1', '[]');
            for(var i=0;i<lib.length;i++){
              if(String(lib[i].ts) === String(ts) && lib[i].host === host){ date = ddate(lib[i].date); break; }
            }
          }
          if(date){
            var hit = DET_MAP[dkey(host, date)];         // ③ 日期键兜底（口径已统一）
            if(hit) return hit;
          }
        }catch(e){}
        return null;
      };
    }

    // ================= ⑥ 历史 tab 渲染：先本机、再异步补云端 =================
    function setTip(html, color){
      try{
        var box = boxOf(); if(!box) return;
        var el = document.getElementById(TIP_ID);
        if(!el){
          el = document.createElement('div');
          el.id = TIP_ID;
          el.style.cssText = 'font-size:11.5px;margin:2px 0 6px;line-height:1.6';
          box.insertBefore(el, box.firstChild);
        }
        el.style.color = color || 'var(--text3)';
        el.innerHTML = html;
      }catch(e){}
    }
    function captureExpanded(){
      var ids = [];
      try{
        var box = boxOf(); if(!box) return ids;
        var ns = box.querySelectorAll('.v4his-tg');
        for(var i=0;i<ns.length;i++){ if(ns[i].checked && ns[i].id) ids.push(ns[i].id); }
      }catch(e){}
      return ids;
    }
    function restoreExpanded(ids){
      if(!ids || !ids.length) return;
      try{ ids.forEach(function(id){ var el = document.getElementById(id); if(el) el.checked = true; }); }catch(e){}
    }
    // 2026-09-23 二次修复：原先「页面生命周期只刷一次」（refreshDone 一次性）⇒ 同事刚上传的记录
    // 必须整页刷新才能看到，与「全员可见」的需求相悖。现在改为：8s 防抖 + 可重复触发 + 失败可重试，
    // 真实请求频率由底层 V4CLOUD.TTL(60s) 控制，不会打爆飞书限流。
    var UI_DEBOUNCE = 8000;
    function tipHtml(n){
      var t = '已合并飞书全员记录 <b>' + n + '</b> 条 ｜ 含完整报告 <b>' + Object.keys(DET_MAP).length +
              '</b> 条 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      // 逃生阀：刚上传完想立刻看到（绕过底层 60s 缓存）时点这里
      return t + ' ｜ <a href="javascript:void 0" onclick="V4RPT.refresh(1);return false" style="color:var(--gold)">立即刷新</a>';
    }
    function scheduleCloudRefresh(args, force){
      if(IN_RENDER) return;                                    // 防 _ar 内部再触发本函数（递归保护）
      var now = Date.now();
      if(!force && now - LAST_UI_TS < UI_DEBOUNCE) return;      // 8s 防抖：切月/切日高频重渲染不重复触发
      LAST_UI_TS = now;
      var fresh = LOADED && CLOUD_ROWS && (now - LAST_OK_TS) < 45000;
      if(!fresh) setTip('正在从飞书加载全员评分记录…');
      var keep = captureExpanded();
      ensureCloud(force).then(function(rows){
        if(!rows || !rows.length){ setTip('飞书暂无全员记录，仅显示本机存档'); return; }
        IN_RENDER = true;
        try{ _ar.apply(window, args || ['history']); }         // 重渲染会清空 tip，故 tip 在渲染之后重建
        catch(e){ log('重渲染异常: ' + ((e && e.message) || e)); }
        IN_RENDER = false;
        restoreExpanded(keep);
        setTip(tipHtml(rows.length));
      })['catch'](function(e){
        setTip('飞书全员记录加载失败：' + esc2((e && e.message) || e), 'var(--danger)');
      });
    }
    var _ar = window.v4ArchRender;        // 原 v4ArchRender（异步补云端后重渲染用；必须在 scheduleCloudRefresh 之前赋值）
    if(typeof _ar === 'function'){
      window.v4ArchRender = function(type){
        var args = arguments;
        var ret = _ar.apply(this, args);
        try{ if(type === 'history') scheduleCloudRefresh(args); }catch(e){}
        return ret;
      };
    }

    // ================= ⑦ 诊断 / 回退 =================
    window.V4RPT = {
      __installed: true,
      build: buildReport,
      toAscii: toAscii,
      fit: fit,
      RPT_MAX: RPT_MAX,
      ensureCloud: ensureCloud,
      refresh: function(force){
        var f = (force === true || force === 1);
        if(boxOf()){ LAST_UI_TS = 0; scheduleCloudRefresh(['history'], f); }
        return '已触发刷新' + (f ? '（强制，已绕过底层 60s 缓存）' : '');
      },
      debug: function(){
        var o = { enabled: true, loaded: LOADED, fails: FAILS,
                  cloudRows: (CLOUD_ROWS || []).length,
                  cloudReports: Object.keys(DET_MAP).length,
                  rowBound: Object.keys(TS_DET).length,
                  lastOkAgo: LAST_OK_TS ? Math.round((Date.now() - LAST_OK_TS) / 1000) + 's' : 'never',
                  sampleKeys: Object.keys(DET_MAP).slice(0, 8) };
        try{ console.log('[v4.11.24] debug', o); }catch(e){}
        return o;
      },
      // 排查「有记录但展不开」：分别报告本机明细 / 按行挂载 / 按日期键三条通路各是否命中
      probe: function(ts, host){
        var r = { ts: ts, host: host, date: null, local: null, cloudByRow: null, cloudByDate: null };
        try{ r.date = IDX_MAP[String(ts) + '|' + host] || null; }catch(e){}
        try{ r.local = _db ? !!_db(ts, host) : null; }catch(e){}
        try{ r.cloudByRow = !!TS_DET[String(ts) + '|' + host]; }catch(e){}
        try{ r.cloudByDate = r.date ? !!DET_MAP[dkey(host, r.date)] : null; }catch(e){}
        return r;
      },
      off: function(){ try{ localStorage.setItem('v4rpt_enabled', '0'); }catch(e){} return 'v4rpt_enabled=0 已写入，刷新页面即回退'; }
    };
    log('完整主播报告云端共享已装载 → 写入字段「' + RPT_FIELD + '」｜历史 tab 合并飞书全员 + 详情云端回退');
  }catch(e){ if(typeof console !== 'undefined') console.log('[v4.11.24] 装载跳过:', (e && e.message) || e); }
})();

// ---------- v4.11.30：历史评分补「平台红线判罚」（与每日报告同形态） ----------
// v4.11.31（2026-09-30）：同形态保留，新增**规则编号**列 —— 存档 `redline.reasons[].code` 与横幅行首 `[S1-04]`。
//   ① 规则库 v3.0.0 起每条规则带编号，判定结果可回表核对（业务侧「有依可寻」）。
//   ② `redlineV` 升为 '4.11.31'；**v4.11.30 期间的存档仍可正常渲染**（无 code ⇒ 不显示编号，不是丢失）。
//   ③ 全表取消分级后本块恒为**一级（红色）**形态，琥珀色二级分支保留但不会命中。
// 背景（2026-09-24 老大报障）：每日评分能看到红线横幅，**历史评分展开后看不到**。
// 根因（已实测）：v4DetailSnapshot() 返回的是**白名单字段**对象，r.__redline 在存档那一步被丢掉
//                ⇒ grading_detail_v1 / 飞书「完整主播报告」里从来没有红线数据（自检：含 __redline = false）。
// 时序已排除嫌疑：workflow.js evaluate() 内 `await v4Evaluate(...)`（**内部已 redlineApply**）
//                → 之后才 commit() → addHistoryRecord() → v4DetailSave() → v4DetailSnapshot()
//                ⇒ 存档时刻 r.__redline **已存在**，只需把字段挑出来，**不必二次写入**。
// 修法（照抄 v4.11.22「6 块明细」成熟范式，全在壳层，app-core.js 一个字不动）：
//   ① 包装 v4DetailSnapshot → det.redline（压缩版）+ det.redlineV（版本标记）
//   ② 包装 v4DetailHTML     → 在返回 HTML **最前面** prepend 红线块（与每日横幅同配色、同样置顶）
//   ③ 云端自动跟随：飞书「完整主播报告」的 JSON 就是 v4DetailSnapshot 的产物（:3998），
//      fit() 只压字符串长度、不动结构；读取侧 JSON.parse 原样还原 ⇒ 服务端无需改动。
//   ④ 字段名必须是 redline，**不能叫 __redline** —— publicResult 的 replacer 会剔除以 __ 开头的键
//      （workflow.js:97），叫 __redline 会写不进飞书。
// 限制（如实登记，不粉饰）：
//   · **存量记录无法回填**（从没存过该字段）⇒ 只对**新评分**生效，与 v4.11.24「完整报告」同性质；
//   · `#/vision`「一键完整日报」通道内部裸调 runGrading、不走 redlineApply ⇒ 该通道的评分历史里同样没有红线。
// 回退：localStorage 置 v4rl_hist_enabled='0'（或调 V4RLH.off()）后刷新页面即恢复原状。
(function(){
  var LOG = function(m){ try{ console.log('[v4.11.32] ' + m); }catch(e){} };
  var LS_OFF = 'v4rl_hist_enabled';
  var QMAX = 120;      // 存档里原句截断长度（防膨胀）
  var RMAX = 20;       // 存档里命中组数上限
  var SHOWQ = 90;      // 渲染时原句截断（与每日横幅一致）
  var STATS = { snap: 0, html: 0, clean: 0, legacy: 0, err: '' };

  function isOff(){ try{ return localStorage.getItem(LS_OFF) === '0'; }catch(e){ return false; } }
  function E(v){ try{ return (typeof esc === 'function') ? esc(v) : String(v == null ? '' : v); }catch(e){ return String(v == null ? '' : v); } }

  // ① 压缩 r.__redline → 存档用（只留展示必需字段；不命中则返回 null）
  function pick(r){
    var rel = r && r.__redline;
    if(!rel) return null;
    var sess = !!rel.sessionZero, modz = !!rel.moduleZero;
    if(!sess && !modz) return null;
    var rs = rel.reasons || [], out = [];
    for(var i=0; i<rs.length && i<RMAX; i++){
      var x = rs[i] || {};
      out.push({
        cat:    String(x.cat    || ''),
        code:   String(x.code   || ''),          // v4.11.31：规则编号（老存档无此字段 ⇒ 空串，渲染时不显示）
        term:   String(x.term   || ''),
        src:    String(x.src    || ''),
        action: String(x.action || ''),
        ts:     String(x.ts     || ''),
        quote:  String(x.quote  || '').slice(0, QMAX)
      });
    }
    return { sessionZero: sess, moduleZero: modz, n: rs.length, reasons: out };
  }

  // ② 渲染块 —— 行内样式/配色/措辞与 v4-shell.js:1569 redlineBanner 逐项对齐
  //    注意：**不用 id**（历史列表可能同时展开多条，用 id 会重复）⇒ 统一走 class .v4rl-his
  function html(rel){
    if(!rel || (!rel.sessionZero && !rel.moduleZero)) return '';
    var sess = !!rel.sessionZero;
    var acc  = sess ? '#b0524c' : '#c9a962';
    var h = '<div class="v4rl-his" style="border:1px solid ' + acc + ';border-left:4px solid ' + acc
      + ';background:' + (sess ? '#fbf3f2' : '#fbf8ef')
      + ';border-radius:8px;padding:12px 14px;margin:0 0 10px;font-size:13px;line-height:1.7">'
      + '<div style="font-weight:600;color:' + acc + ';margin-bottom:6px">'
      + (sess ? '⚠️ 命中平台红线 —— 本场总分按 0 计' : '⚠️ 命中平台红线 —— 对应能力模块按 0 计') + '</div>'
      + '<div style="color:#5c564e">';
    var rs = rel.reasons || [];
    for(var i=0;i<rs.length;i++){
      var x = rs[i] || {};
      h += '<div>· ' + (x.code ? '<span style="color:' + acc + ';font-weight:600">[' + E(x.code) + ']</span> ' : '')
        + '<b>' + E(x.cat) + '</b>'
        + (x.term ? '　触发词「<b>' + E(x.term) + '</b>」' : '')
        + '　<span style="color:#8b857c">[' + E(x.src) + '（'
        + (x.action === 'MODULE_ZERO' ? '模块归0' : '整场归0') + '）]</span>'
        + (x.ts ? ' <span style="color:#8b857c">' + E(x.ts) + '</span>' : '')
        + (x.quote ? '<div style="color:#8b857c;font-size:12px;margin-left:12px">「' + E(String(x.quote).slice(0, SHOWQ)) + '」</div>' : '')
        + '</div>';
    }
    if((rel.n || 0) > rs.length) h += '<div>· …另有 ' + ((rel.n || 0) - rs.length) + ' 组命中</div>';
    h += '</div>';
    if(sess) h += '<div style="color:#8b857c;font-size:12px;margin-top:6px">模块明细仅供参考复盘，不计入总分。依据《抖音直播客观违规规则》。</div>';
    h += '</div>';
    return h;
  }

  // 早于 REDLINE_DATA_SINCE 的记录：存档里没有 redlineV 标记 ⇒ 给一行灰字说明，免得以为又坏了
  // 🔴 v4.11.46 更正：此处原文与注释都写死「v4.11.30」，但真正的能力标记是 redlineV = '4.11.31'
  //    ⇒ 文案差一个版本（v4.11.30 产生的记录**同样**没有 redlineV）。改为与下方 apply() 共用同一常量，
  //    防止以后再次写歪（自检：verify_hist_field.js 从源码提取本常量做断言，不硬编码）。
  var REDLINE_DATA_SINCE = '4.11.31';   // ⚠️ 必须与下方 `det.redlineV = REDLINE_DATA_SINCE` 同值
  function legacyHint(){
    return '<div class="v4his-none" style="margin:0 0 8px">该记录产生于 v' + REDLINE_DATA_SINCE + ' 之前，未沉淀红线判罚数据；重新评分一次即可看到（与每日报告同款横幅）</div>';
  }

  /* ---------- ③ 接管两个顶层函数（壳层包装；调用点是运行时查找 ⇒ patch 生效） ---------- */
  function apply(){
    var ok = 0;
    if(typeof v4DetailSnapshot === 'function'){
      var _snap = v4DetailSnapshot;
      v4DetailSnapshot = function(r, ts){
        var det = _snap.apply(this, arguments);
        try{
          if(!isOff() && det && r){
            var rl = pick(r);
            if(rl){ det.redline = rl; STATS.snap++; }
            else   { STATS.clean++; }
            det.redlineV = REDLINE_DATA_SINCE;     // 标记「这一版能沉淀红线数据（含规则编号）」——用于区分新旧记录
          }
        }catch(e1){ STATS.err = 'snap:' + ((e1 && e1.message) || e1); LOG('红线快照异常：' + STATS.err); }
        return det;
      };
      ok++;
    }
    if(typeof v4DetailHTML === 'function'){
      var _html = v4DetailHTML;
      v4DetailHTML = function(det){
        var h = _html.apply(this, arguments);
        try{
          if(!isOff() && det){
            // v4.11.22 的 wrapper 把 6 块明细**追加在尾**；本块包在它外层 ⇒ prepend 才能真正置顶
            if(det.redline){ h = html(det.redline) + h; STATS.html++; }
            else if(!det.redlineV){ STATS.legacy++; h = legacyHint() + h; }
          }
        }catch(e2){ STATS.err = 'html:' + ((e2 && e2.message) || e2); LOG('红线渲染异常：' + STATS.err); }
        return h;
      };
      ok++;
    }
    return ok;
  }

  window.V4RLH = {
    swap: apply,
    on:     function(){ try{ localStorage.removeItem(LS_OFF); }catch(e){} return 'on'; },
    off:    function(){ try{ localStorage.setItem(LS_OFF, '0'); }catch(e){} return 'off'; },
    offQ:   isOff,
    pick:   pick,
    render: html,
    debug:  function(){ return JSON.parse(JSON.stringify(STATS)); }
  };

  var n = apply();
  LOG('历史评分红线判罚已装载：接管 ' + n + '/2 个函数（存档原句截 ' + QMAX + ' 字 · 命中组上限 ' + RMAX + '）');
})();

// ---------- v4.11.32：产品判定「三路打架」修复（A 文件名兜底 + B ④ 模块对齐） ----------
// 背景（2026-10-08 老大报障 · 10-07 轻熟 甘晋铭场）：
//   报告顶部「考核产品」= TRUFFLE PRO BACKPACK（**双肩包**，正确，且分数就是按它算的 c1=80 / 总分 70.5），
//   但报告 ④「产品识别与讲品分析」显示 **PISTACHIO Plus**，并列出「大尺寸顶开盖/深仓、4层全新PC、
//   静音越负重越省力」等**行李箱卖点**当未覆盖项 —— 同一份报告两个产品名打架。
// 根因（已实测复现；脚本 _census_product_paths.js / _diag_analyze_1007.js / _read_pd_1007.py）：
//   三条**独立**判定路径各跑各的：
//     K1  detectProductFromName(file.name, text)  ← 只有 #/daily 与批量走（workflow.js:107）  → 正确
//     K2  analyzeProducts(segs)                   ← ④ 模块唯一数据源（经 r.products）        → 错
//     K3  runGrading(segs, 'auto')                ← #/vision 一键完整日报（app-core:1827）    → 错
//   本场真实语料 604 段里：TRUFFLE / 双肩包 / 上下 / 刘知礼 / 设计师 / 爱马仕 **命中 0 次**
//   （只有「背包」×60、「扩容」×5）；而**「双肩包」三字不在任何产品的别名表里**
//   ⇒ 别名零命中 ⇒ 落「专属词兜底」投票：
//       pistachio_plus        3×1000 + 4 = 3004   ← 命中 快速取物 / 隐私 / 低调（通用商务话术，非行李箱专属）
//       truffle_pro_backpack  1×1000 + 5 = 1005   ← 只有「扩容」是纯中文专属词
//   48 份语料普查（25 场文件名含产品名可比对）：K2≠K1 = 5/25 (20.0%)；**K3≠K1 = 14/25 (56.0%)**，
//   且错判方向高度单一（K3 有 12/14 全落到 PISTACHIO Plus）。
// 修法（全在壳层；v4/app-core.js 一个字不动；**不动任何评分口径 / 不改权重 / 不改词表**）：
//   A  patch window.runGrading —— productKey==='auto' 且「当前正在跑的任务」有文件名时，
//      先用 detectProductFromName 推断（业务口径：主播整场不念品名时，**以文件名为准**）。
//      只补没定过 key 的入口；key 已明确的通道（如 #/daily 已经在 workflow.js:105-109 推断过）不受影响。
//   B  patch window.analyzeProducts —— 本场考核品已明确、④ 模块却没识别出它、**且整场无任何产品别名命中**
//      （说明 ④ 的结果全部来自「专属词兜底」= 纯猜测）时，用「注入一行产品名」的方式**复用原生窗口/评分逻辑**
//      重算一次，让 ④ 模块对齐考核品。**场内有别名命中的场次一律不动**（那时多品识别本身是对的）。
//   C 不做（另立项）—— 挪专属词（快速取物/隐私/低调）/ 给背包补中文别名 / 权重按词表规模归一。
//      ⚠️ 实测教训：只补别名治不了根 —— 补上「双肩包」也只有 2 个词(2000)，
//      只要主播讲了那 3 个通用词，行李箱照样先拿 3000 分，**还是输**。属于修错层。
// 为什么只改一处数据源就够：
//   当场报告（app-core.js:1350 / 1966）与历史详情（v4ExtraPick → ex.pd）**都读 r.products**
//   = analyzeProducts 的返回值 ⇒ 数据源修好，两处渲染**自动一致**，无需碰任何渲染代码。
// 限制（如实登记，不粉饰）：
//   · 存量记录（升级前评的）④ 模块的错品名**无法回填** ⇒ 只有**新评分**才正确；
//   · 仅对「考核品能确定」的场次生效；考核品本身未定的场次保持原状（无从对齐）。
// 逃生阀：localStorage 置 v4pfix_enabled='0' 后刷新即恢复原状。
// 自检：V4PFX.debug() / V4PFX.off() / V4PFX.on()
(function(){
  if(window.V4PFX && window.V4PFX.__installed) return;

  var LOG = function(m){ try{ console.log('[v4.11.32] ' + m); }catch(e){} };
  var LS_OFF = 'v4pfix_enabled';
  var WEAK = ['p','plus','一代','二代','一','二'];   // 弱别名白名单，与 app-core analyzeProducts 保持一致
  var SCANMAX = 50;
  var STATS = { run: 0, autoFixed: 0, align: 0, skip: 0, err: '', scan: [] };
  var forcedKey = null;      // 本次 runGrading 的考核品（仅供 ④ 模块对齐读取）

  function isOff(){ try{ return localStorage.getItem(LS_OFF) === '0'; }catch(e){ return false; } }
  function STD(){
    try{ if(typeof GRADING_STANDARD !== 'undefined' && GRADING_STANDARD) return GRADING_STANDARD; }catch(e){}
    return window.GRADING_STANDARD || null;
  }
  function S(v){ return String(v == null ? '' : v); }
  function txt(segs){ var o = [], i; for(i=0;i<(segs||[]).length;i++) o.push(S((segs[i]||{}).text)); return o.join('\n'); }
  function nameOf(k){
    var st = STD(), p = st && st.products && st.products[k];
    return p ? S(p.name) : '';
  }

  // A 的文件名来源：只认「正在跑的任务」，**不读 DOM** —— 避免在 #/daily 跑批时误取 #/vision 已选中的文件
  function runningFile(){
    try{
      var J = window.V4Jobs;
      if(!J || !J.getJob) return '';
      var order = ['vision','daily','batch'], i;
      for(i=0;i<order.length;i++){
        var jb = J.getJob(order[i]);
        if(jb && jb.state === 'running' && jb.file && jb.file.name) return jb.file.name;
      }
    }catch(e){}
    return '';
  }
  function laneOf(){
    try{
      var J = window.V4Jobs;
      if(!J || !J.getJob) return '';
      var order = ['vision','daily','batch'], i;
      for(i=0;i<order.length;i++){
        var jb = J.getJob(order[i]);
        if(jb && jb.state === 'running') return order[i];
      }
    }catch(e){}
    return '';
  }

  // B 的判据：整场是否出现任何产品别名（弱别名按 app-core 规则跳过，长度 <2 也跳过）
  function anyAlias(segs){
    var st = STD();
    if(!st || !st.products) return false;
    var low = txt(segs).toLowerCase(), k, i;
    for(k in st.products){
      var p = st.products[k] || {};
      var ns = [p.name].concat(p.aliases || []);
      for(i=0;i<ns.length;i++){
        var a = S(ns[i]).toLowerCase();
        if(a.length < 2 || WEAK.indexOf(a) >= 0) continue;
        if(low.indexOf(a) >= 0) return true;
      }
    }
    return false;
  }

  function apply(){
    var ok = 0;

    // ---------- A：auto → 文件名兜底（只补入口，不改已定好的 key） ----------
    if(typeof window.runGrading === 'function'){
      var _rg = window.runGrading;
      window.runGrading = function(segs, productKey, opts){
        STATS.run++;
        var key = productKey, from = '', fn = '', lane = '';
        if(!isOff() && key === 'auto'){
          try{
            fn = runningFile();
            lane = laneOf();
            if(fn){
              var inf = (typeof window.detectProductFromName === 'function')
                ? window.detectProductFromName(fn, txt(segs)) : null;
              var st = STD();
              if(inf && st && st.sellpoints && st.sellpoints[inf]){
                key = inf; from = 'filename'; STATS.autoFixed++;
                if(STATS.scan.length < SCANMAX) STATS.scan.push({ t:'A', lane: lane, file: fn, key: key });
                LOG('A 生效：auto → ' + key + '（来自文件名「' + fn + '」，通道 ' + lane + '）');
              }
            }
          }catch(e1){ STATS.err = 'infer:' + ((e1 && e1.message) || e1); LOG('A 推断异常：' + STATS.err); }
        }
        // 记录本场考核品，供 B 读取（一次 runGrading 的有效期内）
        forcedKey = (!isOff() && key && key !== 'auto') ? key : null;
        var r;
        try{ r = _rg.call(this, segs, key, opts); }
        finally{ forcedKey = null; }     // analyzeProducts 在 _rg 内同步调用，此处清理不影响 B
        if(from && r && !r.noProduct){
          // __ 开头 ⇒ publicResult 的 replacer 会剔除（workflow.js:97）⇒ 只用于本机诊断，不进存档/飞书
          try{ r.__pfix = { from: from, key: key, file: fn, lane: lane }; }catch(e2){}
        }
        return r;
      };
      ok++;
    }

    // ---------- B：④ 模块对齐考核品（只在「结果全是专属词猜测」时介入） ----------
    if(typeof window.analyzeProducts === 'function'){
      var _ap = window.analyzeProducts;
      window.analyzeProducts = function(segs){
        var r = _ap.apply(this, arguments);
        try{
          var fk = forcedKey;
          if(isOff() || !fk || !segs || !segs.length) return r;
          var i, list = (r && r.products) || [];
          for(i=0;i<list.length;i++){ if(list[i] && list[i].key === fk){ STATS.skip++; return r; } }  // 已识别出考核品 → 原样
          if(anyAlias(segs)){ STATS.skip++; return r; }   // 场内有别名命中却被漏 ⇒ 另有原因，不擅自改
          var nm = nameOf(fk);
          if(!nm) return r;
          // 注入一行「考核产品 <name>」→ 别名必命中 ⇒ 原生逻辑走正常路径（20 分钟窗口 / 评分全部复用）
          var marked = [{ ts: (segs[0] && segs[0].ts) || '', text: '考核产品 ' + nm }].concat(segs);
          var r2 = _ap.call(this, marked);
          var got = null, list2 = (r2 && r2.products) || [];
          for(i=0;i<list2.length;i++){ if(list2[i] && list2[i].key === fk) got = list2[i]; }
          if(!got) return r;
          var was = [];
          for(i=0;i<list.length;i++) was.push(S(list[i] && list[i].name));
          STATS.align++;
          if(STATS.scan.length < SCANMAX) STATS.scan.push({ t:'B', key: fk, name: nm, replaced: was, rounds: got.totalRounds || 0 });
          LOG('B 生效：④ 模块 ' + (was.join('/') || '(空)') + ' → ' + nm + '（' + (got.totalRounds||0) + ' 轮）');
          return { products: [got], totalRounds: got.totalRounds || 0, aligned: 1, replaced: was };
        }catch(e3){
          STATS.err = 'align:' + ((e3 && e3.message) || e3);
          LOG('B 对齐异常（已回退原结果）：' + STATS.err);
          return r;
        }
      };
      ok++;
    }

    return ok;
  }

  var n = apply();
  window.V4PFX = {
    __installed: true,
    apply: apply,
    on:  function(){ try{ localStorage.removeItem(LS_OFF); }catch(e){} return 'on'; },
    off: function(){ try{ localStorage.setItem(LS_OFF, '0'); }catch(e){} return 'off'; },
    offQ: isOff,
    debug: function(){ return JSON.parse(JSON.stringify(STATS)); },
    reset: function(){ STATS.run = STATS.autoFixed = STATS.align = STATS.skip = 0; STATS.err = ''; STATS.scan = []; return 'reset'; }
  };
  LOG('产品判定修复已装载：接管 ' + n + '/2 个函数（A 文件名兜底 + B ④ 模块对齐；口径未动）');
})();

// ---------- v4.11.33（2026-10-09）：红线「标注不判 0」区 ----------
// 业务侧口径（老大 2026-10-09 拍板）：「C 列中如有出现了，放宽不判 0，但在细分报告中需要标注出来，
//   了解主播的话术情况」。
// 数据来源（只读，判定逻辑一行未动）：`r.__redline.scan.annotateHits`
//   —— 由 violation-scan v1.3.0 的 summarize() 放进 stat；redlineApply 把整个 stat 挂到 `rel.scan`
//   （见本文件 :1517 `rel.scan = (sc && sc.stat) ? sc.stat : null;`）⇒ 本块只读，不碰 redlineApply。
// 挂点（关键，别改错）：
//   ① 当场报告 —— 包装**公开函数** `window.v4AttachSemanticEvidence`（本文件 :1649 导出；
//      workflow.js :138 / :279 均以**全局裸名**调用 ⇒ 运行时解析 ⇒ patch 生效）。
//      ⚠️ 不能去包闭包内的 `redlineBanner` —— attachSemEvidence 直接调闭包引用，patch 不透（项目铁律）。
//   ② 历史详情 —— 再包一层 `v4DetailSnapshot`（把标注塞进 `det.redline.notes`）
//      + `v4DetailHTML`（prepend 标注区）。字段名用 `notes`，**不能以 __ 开头**
//      （publicResult 的 replacer 会剔除以 __ 开头的键 ⇒ 写不进飞书）。
// 限制（如实登记）：存量记录无法回填 —— 只有**新评分**才会沉淀 notes（与 v4.11.24「完整报告」同性质）；
//   `#/vision`「一键完整日报」通道内部裸调 runGrading、不走 redlineApply ⇒ 该通道也没有标注数据。
// 回退：localStorage `v4note_enabled='0'`（或 `V4NOTE.off()`）后刷新页面即恢复原状。
(function(){
  var LOG = function(m){ try{ console.log('[v4.11.33] ' + m); }catch(e){} };
  var LS_OFF = 'v4note_enabled';
  var ACC = '#c9a962';   // ITO 金 —— 与"判罚"红 #b0524c 刻意区分：这是"记录"，不是"判罚"
  var BG  = '#f7f5f0';   // ITO 暖白底
  var TXT = '#5c564e';
  var SUB = '#8b857c';
  var SHOWQ = 90;        // 当场报告引文截断
  var SHOWN = 8;         // 单主播当场报告最多渲染条数
  var SNAP_Q = 120;      // 存档引文截断
  var SNAP_N = 20;       // 存档条数上限
  var STATS = { attach:0, snap:0, html:0, err:'' };

  function isOff(){ try{ return localStorage.getItem(LS_OFF) === '0'; }catch(e){ return false; } }
  function E(v){ try{ return (typeof esc === 'function') ? esc(v) : String(v == null ? '' : v); }catch(e){ return String(v == null ? '' : v); } }

  /* 只读取标注（数据在 rel.scan.annotateHits） */
  function pick(r){
    var rel = r && r.__redline;
    if(!rel || !rel.scan) return null;
    var list = rel.scan.annotateHits || [];
    if(!list.length) return null;
    return { n: rel.scan.annotateGroups || list.length, list: list };
  }

  /* 渲染 —— 当场报告与历史详情共用（class 不用 id：历史列表可能同时展开多条） */
  function render(parts, withHost){
    var total = 0, i, j;
    for(i=0;i<parts.length;i++) total += parts[i].p.n;
    var h = '<div class="v4note-box" style="border:1px solid ' + ACC + ';border-left:4px solid ' + ACC
      + ';background:' + BG + ';border-radius:8px;padding:12px 14px;margin:10px 0;font-size:13px;line-height:1.7">'
      + '<div style="font-weight:600;color:#8a6d3b;margin-bottom:6px">📌 已标注（不判 0 分）'
      + (withHost && parts.length > 1 ? '　—— ' + parts.length + ' 位主播共 ' + total + ' 组' : '')
      + '</div><div style="color:' + TXT + '">';
    for(i=0;i<parts.length;i++){
      var it = parts[i];
      if(withHost && parts.length > 1) h += '<div style="margin-top:6px"><b>' + E(it.host || '未识别') + '</b></div>';
      var shown = (it.p.list || []).slice(0, SHOWN);
      for(j=0;j<shown.length;j++){
        var x = shown[j] || {};
        h += '<div>· ' + (x.code ? '<span style="color:#8a6d3b;font-weight:600">[' + E(x.code) + ']</span> ' : '')
          + '<b>' + E(x.cat) + '</b>'
          + (x.term ? '　触发词「<b>' + E(x.term) + '</b>」' : '')
          + ((x.count || 1) > 1 ? ' ×' + x.count : '')
          + '　<span style="color:' + SUB + '">[' + E(x.src || '字面') + ']</span>'
          + (x.ts ? ' <span style="color:' + SUB + '">' + E(x.ts) + '</span>' : '')
          + (x.quote ? '<div style="color:' + SUB + ';font-size:12px;margin-left:12px">「' + E(String(x.quote).slice(0, SHOWQ)) + '」</div>' : '')
          + '</div>';
      }
      if((it.p.n || 0) > shown.length) h += '<div>· …另有 ' + ((it.p.n || 0) - shown.length) + ' 组标注</div>';
    }
    h += '</div><div style="color:' + SUB + ';font-size:12px;margin-top:6px">依据《抖音直播客观违规规则V5》'
      + 'Sheet1「系统特殊违规项调整」C 列：以上表达需标注出来，但不作为判处 0 分的规则，不影响总分与等级。</div></div>';
    return h;
  }

  /* ① 当场报告（单主播 / 批量都走 v4AttachSemanticEvidence） */
  function attach(x){
    if(isOff() || !x) return 0;
    var arr = Array.isArray(x) ? x : [x];
    var parts = [], i;
    for(i=0;i<arr.length;i++){
      var r = arr[i];
      if(!r || !r.modules) continue;
      var p = pick(r);
      if(p) parts.push({ host: r.host || '', p: p });
    }
    if(!parts.length) return 0;
    var host = document.getElementById('singleReport') || document.getElementById('result') || document.body;
    if(!host) return 0;
    if(host.querySelector && host.querySelector('.v4note-anchor')) return 0;   // 防重复
    var box = document.createElement('div');
    box.className = 'v4note-anchor';
    box.innerHTML = render(parts, Array.isArray(x));
    try{ host.insertBefore(box, host.firstChild); }catch(e){ return 0; }
    STATS.attach++;
    return 1;
  }

  /* ② 历史详情：存档压缩 + 渲染 */
  function pickForSnap(r){
    var p = pick(r);
    if(!p) return null;
    var out = [], i;
    for(i=0;i<p.list.length && i<SNAP_N;i++){
      var x = p.list[i] || {};
      out.push({ code: String(x.code || ''), cat: String(x.cat || ''), term: String(x.term || ''),
                 src: String(x.src || ''), ts: String(x.ts || ''), count: x.count || 1,
                 quote: String(x.quote || '').slice(0, SNAP_Q) });
    }
    return { n: p.n, notes: out };
  }

  function apply(){
    var ok = 0;
    var _att = (typeof window !== 'undefined') && window.v4AttachSemanticEvidence;
    if(typeof _att === 'function'){
      window.v4AttachSemanticEvidence = function(x){
        var ret = _att.apply(this, arguments);
        try{ attach(x); }catch(e){ STATS.err = 'attach:' + ((e && e.message) || e); LOG(STATS.err); }
        return ret;
      };
      ok++;
    }
    if(typeof v4DetailSnapshot === 'function'){
      var _snap = v4DetailSnapshot;
      v4DetailSnapshot = function(r, ts){
        var det = _snap.apply(this, arguments);
        try{
          if(!isOff() && det && r){
            var np = pickForSnap(r);
            if(np){
              det.redline = det.redline || {};
              det.redline.notes  = np.notes;
              det.redline.notesN = np.n;
              det.redline.noteV  = '4.11.33';   // 标记"这一版能沉淀标注明细"，用于区分新旧记录
              STATS.snap++;
            }
          }
        }catch(e1){ STATS.err = 'snap:' + ((e1 && e1.message) || e1); LOG(STATS.err); }
        return det;
      };
      ok++;
    }
    if(typeof v4DetailHTML === 'function'){
      var _html = v4DetailHTML;
      v4DetailHTML = function(det){
        var h = _html.apply(this, arguments);
        try{
          if(!isOff() && det && det.redline && det.redline.notes && det.redline.notes.length){
            // v4.11.22 / v4.11.31 的 wrapper 都在里层 ⇒ prepend 才能真正置顶
            h = render([{ host:'', p:{ n: det.redline.notesN || det.redline.notes.length, list: det.redline.notes } }], false) + h;
            STATS.html++;
          }
        }catch(e2){ STATS.err = 'html:' + ((e2 && e2.message) || e2); LOG(STATS.err); }
        return h;
      };
      ok++;
    }
    return ok;
  }

  window.V4NOTE = {
    __installed: true,
    swap: apply,
    on:   function(){ try{ localStorage.removeItem(LS_OFF); }catch(e){} return 'on'; },
    off:  function(){ try{ localStorage.setItem(LS_OFF, '0'); }catch(e){} return 'off'; },
    offQ: isOff,
    pick: pick,
    pickForSnap: pickForSnap,
    attach: attach,
    render: render,
    probe: function(r){ var p = pick(r); return p ? { groups: p.n, list: p.list } : { groups: 0, list: [] }; },
    debug: function(){ return { attach: STATS.attach, snap: STATS.snap, html: STATS.html, err: STATS.err,
                                rulesV: (window.V4ViolationRules && window.V4ViolationRules._v) || '',
                                scanV: (window.V4ViolationScan && window.V4ViolationScan._v) || '' }; }
  };

  var n = apply();
  LOG('红线「标注不判 0」区已装载：接管 ' + n + '/1 个公开函数 + 2 个详情函数（数据源 rel.scan.annotateHits；判定逻辑未动）');
})();

// =====================================================
// v4.11.35「不计违规项综合评分结果」诊断入口（与 V4NOTE 并列，便于端到端回归脚本直接调用）
// 口径全程只读：不改 r.total / r.grade，不进摘要库与飞书评分字段。
// =====================================================
(function(){
  var LOG = function(m){ try{ console.log('[v4.11.35] ' + m); }catch(e){} };
  window.V4RAW = {
    __installed: true,
    version: V4_VERSION.replace(/^v/, ''),
    on:   function(){ try{ localStorage.removeItem('v4raw_enabled'); }catch(e){} return 'on'; },
    off:  function(){ try{ localStorage.setItem('v4raw_enabled','0'); }catch(e){} return 'off'; },
    onQ:  v4RawOn,
    score: v4RawScore,
    grade: v4RawGrade,
    block: v4RawResultHTML,          // v4.11.35：整块渲染（历史详情/当场报告/完整日报共用同一份）
    probe: function(x){ return v4RawScore(x); },
    debug: function(){ return { enabled: v4RawOn(), shellV: V4_VERSION }; }
  };
  LOG('已装载：口径 = 红线处置【之前】的 r.total；形态 = 一整份结果卡（判定逻辑未动）');
})();

// =====================================================
// v4.11.37：「不计违规项综合评分」正式写入飞书**独立列**
// 老大 10-14 拍板：该值不再只是工作台内部展示，而是回写飞书独立列
//   「未记录 违规-综合评分」，便于在飞书侧直接看到「被判 0 分场次」的真实讲解水平。
// ⚠️ 这是**口径扩展，不是改判定**：该列不参与任何评分 / 等级 / 归零逻辑，
//   「综合评分」列仍为 0、「本场 0 分判定」一字未变。
//   ⇒ 因此 v4.11.35 卡上原句「不写回任何评分字段、不进飞书」已同步改成准确表述。
// 值与标记（老大选：带口径标记，便于日后分辨真假）：
//   判 0 + 精确路径 → `78.5（精确）`；判 0 + 反推路径 → `55.5（上限值）`
//   ⚠️ v4.11.38 起：反推路径已升级为「精确复算」（见 v4RawBlk），
//      ⇒ `（上限值）` 只在「既无 rawTotal、又取不到红旗处数」时才会出现。
//   ⚠️ 非判 0 场次**不写该字段**（留空）—— 那些场次该值恒等于「综合评分」，写了是噪音。
// 挂载时机：必须早于 `publicResult(r)`（它只剔「__」前缀键 ⇒ 本字段能上飞书）。
//   实测链路：autoFillFeishu(r) → V4Jobs.sync(r) → post(feishu-fill, {result: publicResult(r)})。
// 回退：localStorage `v4rawcol_enabled='0'` 后刷新页面 ⇒ 不再挂字段（飞书已有值不受影响）。
// =====================================================
(function(){
  var LOG = function(m){ try{ console.log('[' + V4_VERSION + '] ' + m); }catch(e){} };
  var LS_OFF = 'v4rawcol_enabled';
  var FMT_EXACT = '（精确）', FMT_DERIVED = '（上限值）';

  function on(){ try{ return localStorage.getItem(LS_OFF) !== '0'; }catch(e){ return true; } }

  // 与 v4DetailSnapshot 的沉淀口径严格一致：只看 sessionZero / moduleZero
  function isZeroed(r){
    var rl = (r && r.__redline) || null;
    return !!(rl && (rl.sessionZero || rl.moduleZero));
  }

  // 计算要写入飞书单元格的文本；不适用则返回 ''
  function cellText(r){
    try{
      if(!on() || !r || typeof r !== 'object') return '';
      // v4.11.40（老大 10-14 定稿）：**所有场次都要有值**。
      //   原 v4.11.37 的「非判 0 就返回空串」那句短路判定已删除（见沿革）——
      //   两列是并列对照关系，非判 0 留空会被看表的人误判成"漏填"。
      //   ⚠️ 本注释刻意**不复写**那行被删掉的代码：复写会让"已删除"的静态断言自匹配（铁律 13）。
      //   取值统一走顶层 v4RawCellText（与本地行 v4ScoreRow 同源，避免两处字面量漂移）。
      return v4RawCellText(r);
    }catch(e){ return ''; }
  }

  // 幂等；**空值不挂键** —— 服务端 PUT 是部分更新，缺键不会清空既有值
  function attach(r){
    try{
      if(!r || typeof r !== 'object') return r;
      if(Object.prototype.hasOwnProperty.call(r, 'rawScoreText')) return r;
      var t = cellText(r);
      if(t) r.rawScoreText = t;
    }catch(e){}
    return r;
  }

  var STATS = { attached: 0, blank: 0, err: 0 };
  function wrap(obj, name){
    try{
      if(!obj || typeof obj[name] !== 'function') return false;
      var orig = obj[name];
      if(orig.__v41137) return false;      // 已经包过 ⇒ 本次不算新增（供下面 lateWrap 复用）
      var patched = function(r){
        try{
          var had = !!(r && r.rawScoreText);
          attach(r);
          if(r && r.rawScoreText){ if(!had) STATS.attached++; }
          else STATS.blank++;
        }catch(e){ STATS.err++; }
        return orig.apply(this, arguments);
      };
      patched.__v41137 = true;
      obj[name] = patched;
      return true;
    }catch(e){ return false; }
  }

  var n = 0;
  if(wrap(window, 'autoFillFeishu')) n++;
  if(wrap(window, 'addHistoryRecord')) n++;
  try{ if(wrap(window.V4Jobs, 'sync')) n++; }catch(e){}
  try{ if(wrap(window.V4Jobs, 'syncLibs')) n++; }catch(e){}

  // ⚠️ 时序实况：workflow.js 排在 v4-shell.js **之后**加载（index.html 第 8 个），
  //   所以上面那两行 V4Jobs.* 在本脚本装载时恒为 no-op ⇒ 实测「接管 2/4」。
  //   功能上够用（飞书写回通路 A 的入口就是 app-core 的 autoFillFeishu，已包到），
  //   但为防将来出现"直连 V4Jobs.sync"的新入口，加载完成后再补包一次（幂等：包过的不重复计）。
  function lateWrap(){
    try{ if(wrap(window.V4Jobs, 'sync')) n++; }catch(e){}
    try{ if(wrap(window.V4Jobs, 'syncLibs')) n++; }catch(e){}
    try{ console.log('[' + V4_VERSION + '] 延迟补包完成：累计接管 ' + n + '/4 个写入口'); }catch(e){}
  }
  try{
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lateWrap);
    else setTimeout(lateWrap, 0);
  }catch(e){}

  window.V4RAWCOL = {
    __installed: true,
    version: V4_VERSION.replace(/^v/, ''),
    on:  function(){ try{ localStorage.removeItem(LS_OFF); }catch(e){} return 'on'; },
    off: function(){ try{ localStorage.setItem(LS_OFF, '0'); }catch(e){} return 'off'; },
    onQ: on,
    field: '未记录 违规-综合评分',
    zeroed: isZeroed,
    cell: cellText,
    attach: attach,
    probe: function(r){ attach(r); return { zeroed: isZeroed(r), text: cellText(r),
                                           attached: (r && r.rawScoreText) || '' }; },
    debug: function(){ return { on: on(), wrapped: n, stats: STATS, shellV: V4_VERSION }; }
  };
  LOG('已装载：判 0 场次回写飞书独立列（带口径标记）；接管 ' + n + '/4 个写入口，判定逻辑未动');
})();

// =====================================================
// v4.11.41：红线判罚「是否误判」人工撤销（老大 2026-10-14 拍板：方案 A + 留痕不真删）
// -----------------------------------------------------
// 需求原文：「加入一个功能按钮，是否误判；如果是误判，红线匹配违规标准的这个评分结果
//   是需要删除这个违规，然后返回一个应有的评分结果。另外不计违规项综合评分结果 这个不需要改变。」
//   ＋ 追加指令「不要真删除」⇒ 采用**留痕式撤销**：删除线 + 已撤销时间 + 理由 + 可随时恢复。
//
// 口径（本版定稿）：
//   · 撤销的是**处置**，不是**判定**。命中仍留在 rel.reasons 里，只是不再参与「整场归零」。
//   · 剩余未撤销的整场归零命中数 == 0 ⇒ 总分回到原分（红线处置【之前】的 r.total）。
//   · 「未记录 违规-综合评分」列**保持不变** —— 它取的就是同一个原分（v4.11.40 口径），
//     撤销前后是同一个数；本块**一个字都不写该列**（飞书 PUT 是部分更新，缺键不清空）。
//   · 模块分 / 子标准分 / 信息准确性红旗 −4 处 全部不动。
//   · ⚠️ 边界（如实登记）：命中若来自**语义通道** neg0，语义层当时已扣过子标准分，
//     撤「整场归零」不会把那笔扣分退回来（撤销是处置层动作，不重跑判定）。要连判定一起撤属另一范畴。
//
// 为什么不必重算：原分在 redlineApply 入口就已存进 rel.rawTotal（v4.11.34），归零只是 r.total=0 一步。
//   ⇒ 撤销 = 按「未撤销命中数」决定要不要那一步，纯确定性变换，零 token、零延迟。
//   ⚠️ 老记录没有 rawTotal 时，退用 v4.11.38 的**精确复算**（模块加权 − 红旗扣分）；两者都取不到 ⇒ 拒绝撤销。
//
// 挂点（两个公开函数，运行时查找 ⇒ patch 生效；闭包内引用不透，铁律）：
//   ① 当场报告：包装 window.v4AttachSemanticEvidence（workflow.js:138 全局裸调用）。
//      ⚠️ 不能去包 window.v4RedlineBanner —— attachSemEvidence 调的是**闭包引用** redlineBanner
//         （本文件 :2135），patch 不透；v4.11.33 选了同一个挂点，本块沿用。
//   ② 历史详情：包装 v4DetailHTML（最外层，后加载 ⇒ 能看到内层全部产出），
//      用 V4RLH.render(rel) 的原样输出**精确定位**并替换那段红色横幅（同一函数同一输入 ⇒ 逐字符相同）。
//
// 持久化（三层，目的是团队看到同一个结论）：
//   ① r.__redline.revoked                        —— 当场即时生效
//   ② det.rlRevoked（**不以 __ 开头**，能进存档与飞书）
//      = { zero:0/1, n:原命中总数, list:[{fp,code,cat,term,src,ts,action,quote,at,note}] }
//   ③ 飞书 PUT { result:{host,date,total,modules,v4Report} }：
//      · modules **必带全 c1–c8**（feishu-fill 无条件写这 8 列，缺一个就会把那列写空 ⇒ 本块宁可不写）
//      · 不传 rawScoreText ⇒「未记录 违规-综合评分」列不动 ✓
//      · v4Report = 更新后的 det ⇒ 换人 / 换机器也看得到撤销结论
//        ⚠️ 但这只到「主播日报」表 —— 而历史 tab 的云端行读的是「历史评分」表（下一层，v4.11.43 才补）
//   ④ v4.11.43 增：**历史评分表**回写（这一条才让"云端行"真正持久化）
//      · POST window.FEISHU_SYNC_URL → api/feishu-sync.js 的 upsertHistory()
//      · 按 主播+日期 **先删旧行、再建 1 行** ⇒ 恒为该主播当日最新的那一条
//      · 🔴 先删后建 ⇒ 三个"宁可不写"守卫（与 libBody 同一份实现）：
//        缺产品/c1（会清空该两列）、报告 >95000（会丢报告）、日期格式非常规（会建畸形行）
//      · 该表**没有**「未记录 违规-综合评分」列（2026-10-14 实测 309 行字段并集 0/309）⇒ 天然不碰
//
// 回退：localStorage `v4rev_enabled='0'` + 刷新 ⇒ 按钮与留痕消失，判定回到 v4.11.40 原状。
//   另：`v4librev_enabled='0'`（v4.11.43）⇒ 只停「历史评分表回写」这一路，其余全照旧。
// 诊断：V4RLREV.debug() / .off() / .on() / .probe(r)
// 已知不做（如实登记）：
//   · 批量（≥2 主播）只有汇总横幅、无逐条明细 ⇒ 不挂按钮；
//   · `#/vision` 一键完整日报本就是红线盲区（裸调 runGrading、不走 redlineApply）⇒ 无横幅即无按钮；
//   · v4.11.43 已补上原先这条缺口：撤销结论**同时回写云端「历史评分」表**
//     （走 api/feishu-sync.js 的 upsertHistory，按 主播+日期 先删旧行再建 1 行）
//     ⇒ 历史 tab 的**云端行**（别人评的 / 换台机器看到的）撤销后同样持久、全员可见。
//     ⚠️ 仍不做：批量汇总横幅本就不挂按钮。
// =====================================================
(function(){
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  if(window.V4RLREV && window.V4RLREV.__installed) return;

  var LOG = function(m){ try{ console.log('[v4.11.41] ' + m); }catch(e){} };
  var LS_OFF = 'v4rev_enabled';
  // v4.11.43：历史评分表回写的**独立**阀门。关掉它只停这一路，
  //   按钮、留痕、主播日报表写回、本机存档全部照旧。
  var LS_LIBOFF = 'v4librev_enabled';
  function on(){ try{ return localStorage.getItem(LS_OFF) !== '0'; }catch(e){ return true; } }
  // ⚠️ 必须自己挡 null/undefined：本文件里 `esc` 有多份实现（其中一份不挡 null），
  //   一旦漏挡，报告里就会出现字面 "undefined"（沙箱用例抓到过 data-v4host="undefined"）。
  function E(v){ if(v == null) return ''; try{ return (typeof esc === 'function') ? esc(v) : String(v); }catch(e){ return String(v); } }

  // 视觉：与 v4.11.17 当场横幅 / v4.11.32 历史块逐项对齐（ITO 金白；判罚红 / 留痕金）
  var ACC_RED = '#b0524c', BG_RED = '#fbf3f2';
  var ACC_GOLD = '#c9a962', BG_GOLD = '#fbf8ef';
  var GOLD_TXT = '#8a6d3b';
  var TXT = '#5c564e', SUB = '#8b857c';
  var SHOWQ = 90, SHOWN = 8;

  var STATS = { toggle:0, revoke:0, restore:0, fbOk:0, fbFail:0, fbSkip:'', localOk:0, err:'' };
  // v4.11.43：历史评分表回写这一路的独立计数（lib= 该表；fb= 主播日报表）
  STATS.libOk = 0; STATS.libFail = 0; STATS.libSkip = '';

  // ---------------- 指纹：内容级主键 ----------------
  // 六元组 code/src/cat/term/ts/action。同场两条**完全一样**的命中会一起撤（实际极少，可接受）。
  var SEP = '\u0001';
  function fp(x){
    x = x || {};
    return [x.code||'', x.src||'', x.cat||'', x.term||'', x.ts||'', x.action||''].join(SEP);
  }
  function nowStr(){
    try{
      var d = new Date(), p = function(n){ return (n<10?'0':'') + n; };
      return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }catch(e){ return ''; }
  }

  // ---------------- 归一化：运行时 rel / 存档 det 两路统一 ----------------
  function normRel(rel, rb){
    rel = rel || {};
    var revs = rel.revoked || [];
    var raw = rel.reasons || null;
    if((!raw || !raw.length) && rb && rb.list && rb.list.length){
      // 全部撤销后 v4.11.32 的 pick 会返回 null ⇒ det.redline 不再含 reasons，
      //   此处用自己沉淀的槽位兜底渲染（否则留痕整块消失）。
      raw = rb.list.map(function(v){
        return { code:v.code, cat:v.cat, term:v.term, src:v.src, ts:v.ts, action:v.action,
                 quote:v.quote, revoked:true, revAt:v.at, revNote:v.note, fp:v.fp };
      });
    }
    raw = raw || [];
    var list = [], actN = 0, revN = 0, i, k;
    for(i=0;i<raw.length;i++){
      var x = raw[i] || {};
      var f = x.fp || fp(x);
      /* 🔴 v4.11.42 修：留痕的「撤销时间/理由」只记在**留痕记录**里（rel.revoked / rb.list），
         `recountRel` 只把 x.revoked 置 true、**从不写 x.revAt/x.revNote**。
         旧写法 `x.revoked ? {at:x.revAt||''} : null` 会先构造出一个"真值但空时间"的 rv，
         导致下面那句 `if(!rv)` 的兜底查询**永远不执行** ⇒ 当场报告里留痕只有「理由：未填写」、
         时间戳（明明存在 rel.revoked[0].at）被吞掉；而历史详情走的是另一条路径（rb.list 命中）反而有时间。
         ⇒ 改成：**先按指纹找留痕记录（运行时 → 存档），拿到 at/note 后再决定 rv 是否成立**。 */
      var rec = null;
      for(k=0;k<revs.length;k++){ if(String((revs[k]||{}).fp || '') === f){ rec = revs[k]; break; } }
      if(!rec && rb && rb.list) for(k=0;k<rb.list.length;k++){
        if(String((rb.list[k]||{}).fp || '') === f){ rec = rb.list[k]; break; }
      }
      var rv = (x.revoked || rec) ? { at:(rec && rec.at) || x.revAt || '', note:(rec && rec.note) || x.revNote || '' } : null;
      list.push({ x:x, fp:f, rid:i, rev:rv });
      if(rv) revN++; else actN++;
    }
    var sess = !!rel.sessionZero;
    return {
      sess: sess,
      zeroBase: (rb && rb.zero) ? true : (rel.zeroBase !== undefined ? !!rel.zeroBase : sess),
      list: list, actN: actN, revN: revN,
      total: Math.max(list.length, (rb && typeof rb.n === 'number') ? rb.n : 0)
    };
  }

  // 原分（撤销后要回填的那个数）：优先 rawTotal 留存，退用 v4.11.38 精确复算
  function rawOf(x, rel){
    if(rel && typeof rel.rawTotal === 'number') return rel.rawTotal;
    if(x && typeof x.rawTotal === 'number') return x.rawTotal;
    try{
      var q = (typeof v4RawScore === 'function') ? v4RawScore(x) : null;
      if(q && q.exact && typeof q.total === 'number') return q.total;   // via='rebuilt' 精确复算
    }catch(e){}
    return null;
  }

  // ---------------- 重算：只动 total / grade ----------------
  function recountRel(rel){
    var revs = rel.revoked || [], rs = rel.reasons || [];
    var zeroR = 0, revN = 0, i, k;
    for(i=0;i<rs.length;i++){
      var x = rs[i] || {}, rv = false;
      for(k=0;k<revs.length;k++){ if(String((revs[k]||{}).fp || '') === fp(x)){ rv = true; break; } }
      x.revoked = rv;
      if(rv) revN++;
      else if(x.action !== 'MODULE_ZERO') zeroR++;
    }
    if(rel.zeroBase === undefined) rel.zeroBase = !!rel.sessionZero;   // 只落一次 ⇒ 幂等
    rel.revokedN = revN; rel.activeN = rs.length - revN; rel.zeroReasons = zeroR;
    // 原始未判 0 ⇒ 撤销不影响归零；原始判 0 且**无任何条目**可撤 ⇒ 保持原判（绝不误撤）
    rel.sessionZero = rel.zeroBase ? (zeroR > 0 || rs.length === 0) : false;
    return rel.sessionZero;
  }
  function recomputeRev(r){
    var rel = r && r.__redline;
    if(!rel) return false;
    var rawT = rawOf(r, rel);
    if(rawT === null && !rel.sessionZero) return false;
    var sess = recountRel(rel);
    if(sess){ r.total = 0; r.grade = 'E'; }
    else { r.total = rawT; r.grade = v4RawGrade(rawT); }
    return true;
  }
  function canRevoke(rel, rawT){
    if(!rel) return { ok:false, why:'本场没有红线判罚数据' };
    var has = (rel.revoked && rel.revoked.length) || 0;
    // ⚠️ 本块处理的是**整场归零**（sessionZero）。v3.1.x 起 MODULE_ZERO 恒不产生
    //   （见 violation-rules.js v3.0.0 说明）；万一是老存档留下的模块归零记录，
    //   撤销它**不影响总分**（本块不回滚 redlineZeroModule 的模块扣分）⇒
    //   与其给一个"按了没反应"的死按钮，不如明确拒绝并说明。
    var sessRel = !!rel.sessionZero || !!rel.zeroBase;
    if(!sessRel && !has) return { ok:false, why:'本场未被整场判 0，撤销对综合评分无影响，故不提供' };
    if(typeof rawT !== 'number') return { ok:false, why:'取不到本场原分（记录过旧，无原分留存也复算不出），撤销后无法回填分数，已阻止' };
    return { ok:true, why:'' };
  }

  // ---------------- 渲染 ----------------
  function btn(act, rid, scope){
    // ⚠️ 表头的两个动作是 'allrev' / 'allunrev'，不能只判 'rev' ——
    //   写漏了会让「全部误判」显示成「恢复」（沙箱用例 L1 抓到过一次）。
    var isRev = (act === 'rev' || act === 'allrev');
    var s = 'font-size:12px;padding:1px 8px;margin-left:8px;border-radius:4px;cursor:pointer;line-height:1.5;'
          + 'border:1px solid ' + (isRev ? ACC_RED : ACC_GOLD) + ';background:#fff;color:' + (isRev ? ACC_RED : GOLD_TXT);
    var a = ' type="button" data-v4rev="' + act + '" style="' + s + '"';
    if(typeof rid === 'number' && rid >= 0) a += ' data-v4rid="' + rid + '"';
    // 空值不落属性：`data-v4host=""` 会让 onClick 误判成"历史路径"且定位失败
    if(scope && scope.ts != null && scope.ts !== '') a += ' data-v4ts="' + E(scope.ts) + '"';
    if(scope && scope.host != null && scope.host !== '') a += ' data-v4host="' + E(scope.host) + '"';
    var label = (act === 'allrev') ? '全部误判' : (act === 'allunrev') ? '全部恢复' : (isRev ? '误判' : '恢复');
    return '<button' + a + '>' + label + '</button>';
  }

  function innerHTMLOf(n, scope){
    var sess = n.sess, acc = sess ? ACC_RED : ACC_GOLD;
    var title = sess ? '命中平台红线 —— 本场总分按 0 计'
              : (n.zeroBase ? '全部命中已撤销（误判）—— 本场按原分计'
                            : '命中平台红线 —— 对应能力模块按 0 计');
    var h = '<div style="font-weight:600;color:' + acc + ';margin-bottom:6px;display:flex;align-items:center;flex-wrap:wrap;gap:6px">'
          + '<span>' + title + '</span>';
    var btns = '';
    // 只在该场**确实存在「整场归零」可撤**时才给按钮（未判 0 / 仅模块归零 ⇒ 没有可撤的处置，
    //   给了也是死按钮 —— 与 canRevoke 同一口径）。
    var canAct = !!(n.zeroBase || n.revN > 0);
    if(canAct && n.actN > 0) btns += btn('allrev', -1, scope);
    if(canAct && n.revN > 0) btns += btn('allunrev', -1, scope);
    if(btns) h += '<span style="margin-left:auto;font-weight:400">' + btns + '</span>';
    h += '</div><div style="color:' + TXT + '">';

    var shown = n.list.slice(0, SHOWN), i;
    for(i=0;i<shown.length;i++){
      var it = shown[i], x = it.x || {}, rv = it.rev;
      var strike = rv ? 'text-decoration:line-through;color:' + SUB : '';
      h += '<div style="' + (rv ? 'opacity:.78;' : '') + '">· '
        + (x.code ? '<span style="color:' + (rv ? SUB : acc) + ';font-weight:600">[' + E(x.code) + ']</span> ' : '')
        + '<b style="' + strike + '">' + E(x.cat) + '</b>'
        + (x.term ? '　触发词「<b style="' + strike + '">' + E(x.term) + '</b>」' : '')
        + '　<span style="color:' + SUB + '">[' + E(x.src) + '（' + (x.action === 'MODULE_ZERO' ? '模块归0' : '整场归0') + '）]</span>'
        + (x.ts ? ' <span style="color:' + SUB + '">' + E(x.ts) + '</span>' : '')
        + (canAct ? btn(rv ? 'unrev' : 'rev', it.rid, scope) : '')
        + (x.quote ? '<div style="color:' + SUB + ';font-size:12px;margin-left:12px">「' + E(String(x.quote).slice(0, SHOWQ)) + '」</div>' : '')
        + (rv ? '<div style="color:' + GOLD_TXT + ';font-size:12px;margin-left:12px">已撤销（误判）'
              + (rv.at ? ' · ' + E(rv.at) : '') + '　理由：' + E(rv.note || '未填写') + '</div>' : '')
        + '</div>';
    }
    if(n.total > shown.length) h += '<div>· …另有 ' + (n.total - shown.length) + ' 组命中</div>';
    h += '</div>';

    var note = '';
    if(sess){
      note = '模块明细仅供参考复盘，不计入总分。依据《抖音直播客观违规规则》。'
           + (canAct ? '<br>点「误判」= 撤回本条判罚并回填原分（留痕，可随时「恢复」）'
             + (n.revN ? '；已撤销 ' + n.revN + ' 条。' : '。') : '');
    } else if(n.zeroBase){
      note = '本条判罚已被人工复核撤销 ⇒ 本场按原分计'
           + (n.revN ? '（共撤销 ' + n.revN + ' 条）' : '')
           + '；模块明细与子标准分一字未改。'
           + '<br>「未记录 违规-综合评分」列保持原值不变（它本就是「不做红线处置」的口径，与撤销后总分同值）。';
    }
    if(note) h += '<div style="color:' + SUB + ';font-size:12px;margin-top:6px">' + note + '</div>';
    return h;
  }

  function boxStyleOf(n, margin){
    var acc = n.sess ? ACC_RED : ACC_GOLD;
    return 'border:1px solid ' + acc + ';border-left:4px solid ' + acc
      + ';background:' + (n.sess ? BG_RED : BG_GOLD)
      + ';border-radius:8px;padding:12px 14px;margin:' + (margin || '10px 0') + ';font-size:13px;line-height:1.7';
  }

  // ---------------- 沉淀 / 反沉淀 ----------------
  function sinkOf(rel){
    var revs = (rel && rel.revoked) || [];
    if(!revs.length) return null;
    var list = [], i;
    for(i=0;i<revs.length;i++){
      var v = revs[i] || {};
      list.push({ fp:String(v.fp||''), code:String(v.code||''), cat:String(v.cat||''), term:String(v.term||''),
                  src:String(v.src||''), ts:String(v.ts||''), action:String(v.action||''),
                  quote:String(v.quote||'').slice(0,120), at:String(v.at||''), note:String(v.note||'').slice(0,120) });
    }
    return { zero: rel.zeroBase ? 1 : 0, n: ((rel.reasons||[]).length), list: list };
  }
  // 运行时 rel → 存档形状（与 v4.11.32 的 pick 同构，供历史详情继续用 v4.11.32 的渲染契约）
  function archiveRel(rel){
    if(!rel) return null;
    var out = [], rs = rel.reasons || [];
    for(var i=0;i<rs.length;i++){
      var x = rs[i] || {};
      out.push({ cat:String(x.cat||''), code:String(x.code||''), term:String(x.term||''),
                 src:String(x.src||''), action:String(x.action||''), ts:String(x.ts||''),
                 quote:String(x.quote||'').slice(0,120) });
    }
    return { sessionZero: !!rel.sessionZero, moduleZero: !!rel.moduleZero,
             n: out.length, reasons: out };
  }

  // ---------------- 持久化：本机存档 + 飞书 ----------------
  function fbReady(){ try{ return window.FEISHU_FILL_URL || ''; }catch(e){ return ''; } }
  // feishu-fill 无条件写「综合评分」+ c1–c8 ⇒ 必须带齐 8 个 key，缺一个就会把那列写空
  var CN = ['c1','c2','c3','c4','c5','c6','c7','c8'];
  function modsForWrite(mods){
    var map = {}, i;
    for(i=0;i<(mods||[]).length;i++){ var m = mods[i]; if(m && m.key && typeof m.score === 'number') map[m.key] = m.score; }
    var out = [];
    for(i=0;i<CN.length;i++){
      if(typeof map[CN[i]] !== 'number') return null;      // 不齐 ⇒ 宁可不写，也不清空别人的列
      out.push({ key: CN[i], score: map[CN[i]] });
    }
    return out;
  }
  // 载荷构造单独成函数（v4.11.41）：只为**可验证** —— 验证脚本能直接取到「将要发出去的 body」，
  //   断言里面没有 rawScoreText（⇒「未记录 违规-综合评分」列不动）且 c1–c8 齐全。行为与原来逐字符相同。
  function buildBody(det, total){
    det = det || {};
    var mods = modsForWrite(det.mods);
    if(!mods) return { ok:false, why:'存档缺 c1–c8 任一能力分，已阻止写入（避免清空飞书列）' };
    var body = { host: det.host, date: det.date, studio: det.studio,
                 result: { host: det.host, date: det.date, total: total, modules: mods } };
    var warn = '';
    try{
      var rep = JSON.stringify(det);
      if(rep.length <= 95000) body.result.v4Report = rep;
      else warn = '（报告 ' + rep.length + ' 字符超上限，本次未写报告列，综合评分照写）';
    }catch(e){}
    // v4.11.45：这两列（红线命中 / 已标注）的注入点 —— 见文件末尾同名块。
    //   挂在这里（而不是只包那 4 个写入口）是因为**撤销 / 恢复**走的是 fbWrite 直调本函数，
    //   不经过那些入口 ⇒ 只有这里能保证撤销后重写时这两列跟着刷新成撤销后的口径。
    //   语义：null = 不挂键（老记录，不动该列）；'' = 写空串清列（确知本场无命中）。
    try{ if(window.V4RLCOL && window.V4RLCOL.fill) window.V4RLCOL.fill(det, body.result); }catch(e){}
    return { ok:true, body: body, warn: warn };
  }
  function fbWrite(det, total, cb){
    var url = fbReady();
    if(!url){ STATS.fbSkip = '未配置写回端点'; cb && cb({ ok:false, why:STATS.fbSkip }); return; }
    if(!/^\d{4}-\d{1,2}-\d{1,2}/.test(String((det && det.date) || ''))){
      STATS.fbSkip = '日期格式非常规，已阻止写入（避免建重复行）';
      cb && cb({ ok:false, why:STATS.fbSkip }); return;
    }
    var bb = buildBody(det, total);
    if(!bb.ok){ STATS.fbSkip = bb.why; cb && cb({ ok:false, why:bb.why }); return; }
    var body = bb.body, repWarn = bb.warn;
    fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      .then(function(res){ return res.json().catch(function(){ return {}; }); })
      .then(function(j){
        if(j && j.ok){ STATS.fbOk++; cb && cb({ ok:true, warn:repWarn }); }
        else { STATS.fbFail++; cb && cb({ ok:false, why:((j && (j.reason || j.error)) || '写入被拒绝') + repWarn }); }
      })
      .catch(function(e){ STATS.fbFail++; cb && cb({ ok:false, why:((e && e.message) || '网络失败') + repWarn }); });
  }
  // ---------------- v4.11.43：回写「历史评分」表（云端行撤销真正持久化的那一半） ----------------
  // 缘由：v4.11.41 的撤销只写「主播日报」表 + 本机存档。而历史 tab 的**云端行**读的是
  //   「历史评分」表（tblkN1e6yCtXl5bG）的「完整主播报告」列 ⇒ 结论没进这张表，别人
  //   （或换台机器 / 换浏览器 / 换个 origin）展开历史记录看到的仍是老的 0 分报告。
  // 通路：直发 window.FEISHU_SYNC_URL（api/feishu-sync.js）→ upsertHistory()：
  //   按 主播+日期 **先删旧行、再建 1 行** ⇒ 撤销 / 恢复的结论恒为该主播当日最新一条。
  // 🔴 正因为是「先删后建」，下面几条必须挡住 —— 这不是"不写"，而是"删了旧的又写不进"，比不写更糟：
  //   ① 缺「产品」或「c1」⇒ 新行那两列是空的、旧行已删 ⇒ 列被清空。宁可不写。
  //   ② 报告串 > 95000 ⇒ 服务端不写报告列（feishu-sync 的防御性校验），但旧行照样被删
  //      ⇒ 整份报告丢失。同样宁可不写。
  //   ③ 日期格式非常规 ⇒ 会在该表建出畸形新行。宁可不写。
  // ⚠️ **v4.11.46 更正本块原先的一条错注**：这里曾写「历史评分表**没有**『未记录 违规-综合评分』列
  //   （2026-10-14 实测全表 309 行字段并集 …，该列 0/309）」——那是**看 records 的 keys 并集**得出的假象：
  //   整列为空的字段**根本不会出现在 keys 里**。2026-10-15 走 `GET /fields` 实测该表 13 字段、
  //   **确有这一列**（field_id `fldqUEk0jk`，当时 0/330 覆盖），只是没人写过。
  //   ⇒ 已接通：本块 libBody 挂 `raw` → 服务端 upsertHistory 写入该列。
  //   🔴 铁律：判「字段是否存在」**必须走 `GET /fields`**，看 records 会得出相反结论。
  // 回退：localStorage `v4librev_enabled='0'` + 刷新 ⇒ 不回写该表（其余全照旧）。
  function libReady(){ try{ return window.FEISHU_SYNC_URL || ''; }catch(e){ return ''; } }
  function libOn(){ try{ return localStorage.getItem(LS_LIBOFF) !== '0'; }catch(e){ return true; } }

  // 纯函数（不发请求）：构造要发往历史评分表的 body；任一守卫不过 ⇒ { ok:false, why }
  // 抽成函数的目的是**可验证** —— 验证脚本与 V4RLREV.libPayload 直接取同一份实现，
  //   不会出现"断言的那份"和"真正发出去的那份"漂移。
  function libBody(det){
    det = det || {};
    var product = String(det.product == null ? '' : det.product).trim();
    var c1 = (typeof det.c1Score === 'number') ? det.c1Score : null;
    if(!product || c1 === null){
      return { ok:false, why:'存档缺「产品」或「c1」分，已阻止回写（避免删旧行时清空飞书列；本机已生效）' };
    }
    if(!/^\d{4}-\d{1,2}-\d{1,2}/.test(String(det.date || ''))){
      return { ok:false, why:'日期格式非常规，已阻止回写（避免在历史评分表建出畸形行）' };
    }
    var rep = '';
    try{ rep = JSON.stringify(det); }catch(e){ rep = ''; }
    if(!rep) return { ok:false, why:'存档无法序列化，已阻止回写' };
    if(rep.length > 95000){
      return { ok:false, why:'报告 ' + rep.length + ' 字符超上限（>95000），已阻止回写'
                          + '（服务端超限不写报告列、旧行却已被删 ⇒ 会丢报告）' };
    }
    // v4.11.46：带上「未记录 违规-综合评分」（历史评分表的这一列也接上）。
    //   值口径 = **不做红线处置的原分**（`78.5（精确）` 形态）⇒ ⚠️ **撤销不改变它**：
    //     撤销撤的是「处置」，而这个口径本来就是「没有处置时的分数」，两者同值。
    //   算不出 ⇒ 空串（不传数字、不猜）；服务端判据是 `!== undefined` ⇒ 空串也会如实写入。
    //   ⚠️ 服务端是「先删同主播同日期旧行、再建 1 行」⇒ 空串与不挂键在新行上等效，不会残留旧值。
    var rawTxt = '';
    try{ rawTxt = v4RawCellText(det); }catch(e){ rawTxt = ''; }
    return { ok:true, body: { history: [{
      host: det.host, date: String(det.date || ''), studio: String(det.studio || ''),
      product: product, total: det.total, grade: String(det.grade || ''),
      c1: c1, report: rep, raw: rawTxt
    }] } };
  }

  function fbWriteLib(det, cb){
    var fin = function(o){ try{ if(cb) cb(o); }catch(e){} };
    if(!libOn()){ STATS.libSkip = '历史评分表回写已关闭（' + LS_LIBOFF + '=0）';
                  fin({ ok:false, why:STATS.libSkip, off:true }); return; }
    var url = libReady();
    if(!url){ STATS.libSkip = '未配置历史评分表写回端点（FEISHU_SYNC_URL）';
              fin({ ok:false, why:STATS.libSkip }); return; }
    var lb = libBody(det);
    if(!lb.ok){ STATS.libSkip = lb.why; fin({ ok:false, why:lb.why }); return; }
    fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(lb.body) })
      .then(function(res){ return res.json().catch(function(){ return {}; }); })
      .then(function(j){
        var h = (j && j.results && j.results[0] && j.results[0].r) || null;
        if(j && j.ok && h && h.ok){ STATS.libOk++; fin({ ok:true }); }
        else { STATS.libFail++;
               fin({ ok:false, why:'写入被拒绝：' + ((h && h.reason) || (j && (j.error || j.reason)) || '未知原因') }); }
      })
      .catch(function(e){ STATS.libFail++; fin({ ok:false, why:'网络失败：' + ((e && e.message) || '') }); });
  }

  // 本机存档：按 ts+host 就地更新（没有就按 host+日期 兜底找最近一条）
  function localSave(det){
    try{
      var ds = v4ReadLS('grading_detail_v1', '[]'), hit = -1, i;
      for(i=0;i<ds.length;i++){ if(det.ts != null && String(ds[i].ts) === String(det.ts) && ds[i].host === det.host){ hit = i; break; } }
      if(hit < 0) for(i=ds.length-1;i>=0;i--){
        if(ds[i].host === det.host && String(ds[i].date||'') === String(det.date||'')){ hit = i; break; }
      }
      if(hit < 0) return false;
      if(det.rlRevoked) ds[hit].rlRevoked = det.rlRevoked; else delete ds[hit].rlRevoked;
      // ⚠️ revV 必须跟着一起存（真机实测抓到过：只存了 rlRevoked、没存 revV ⇒
      //   存量记录缺格式标记，日后无法判断它是不是"会留痕的那一版"产出的）。
      if(det.revV) ds[hit].revV = det.revV; else delete ds[hit].revV;
      if(det.redline) ds[hit].redline = det.redline; else delete ds[hit].redline;
      ds[hit].total = det.total; ds[hit].grade = det.grade;
      localStorage.setItem('grading_detail_v1', JSON.stringify(ds));
      STATS.localOk++;
      return true;
    }catch(e){ STATS.err = 'localSave:' + ((e && e.message) || e); return false; }
  }
  // 摘要库（历史列表行显示的就是它）
  function localSaveSummary(det){
    try{
      var lib = v4ReadLS('grading_history_v1', '[]'), hit = -1, i;
      for(i=lib.length-1;i>=0;i--){
        if(det.ts != null && String(lib[i].ts) === String(det.ts) && lib[i].host === det.host){ hit = i; break; }
      }
      if(hit < 0) for(i=lib.length-1;i>=0;i--){
        if(lib[i].host === det.host && String(lib[i].date||'') === String(det.date||'')){ hit = i; break; }
      }
      if(hit < 0) return false;
      lib[hit].total = det.total; lib[hit].grade = det.grade;
      localStorage.setItem('grading_history_v1', JSON.stringify(lib));
      return true;
    }catch(e){ return false; }
  }
  function findTsFor(r){
    try{
      var lib = v4ReadLS('grading_history_v1', '[]');
      for(var i=lib.length-1;i>=0;i--){
        if(lib[i] && lib[i].host === r.host && String(lib[i].date||'') === String(r.date||'')) return lib[i].ts;
      }
    }catch(e){}
    return null;
  }

  // ---------------- 当场报告：DOM 重绘 ----------------
  function hostOf(root){
    return root || document.getElementById('singleReport') || document.getElementById('result') || document.body;
  }
  function isAux(el){
    if(!el || el.nodeType !== 1) return true;
    if(el.id === 'redlineBanner') return true;
    var c = String(el.className || '');
    return c.indexOf('v4raw-result-box') >= 0 || c.indexOf('v4note-anchor') >= 0;
  }
  function mainCardOf(host){
    for(var n = host.firstChild; n; n = n.nextSibling){ if(n.nodeType === 1 && !isAux(n)) return n; }
    return null;
  }
  function paintScore(r){
    try{
      var ts = document.getElementById('totalScore'); if(ts) ts.textContent = r.total;
      var gb = document.getElementById('gradeBadge');
      if(gb){ gb.textContent = r.grade + ' 级'; gb.className = 'grade g' + r.grade; }
    }catch(e){}
  }
  function syncRawCard(r, host){
    if(!host) return;
    var cur = host.querySelector ? host.querySelector('.v4raw-result-box') : null;
    var want = !!(r.__redline && r.__redline.sessionZero) && v4RawOn();
    if(want && !cur){
      var blk = v4RawResultHTML(v4DetailSnapshot(r, Date.now()), 'daily');
      if(blk){
        var d = document.createElement('div');
        d.className = 'v4raw-result-box';
        d.innerHTML = blk;
        var main = mainCardOf(host);
        try{ host.insertBefore(d, main ? main.nextSibling : null); }catch(e){}
      }
    } else if(!want && cur && cur.parentNode){
      cur.parentNode.removeChild(cur);
    }
  }
  function repaintRuntime(r, root){
    if(!r || !r.__redline) return;
    var host = hostOf(root), n = normRel(r.__redline, null);
    var want = n.sess || n.revN > 0;
    var box = document.getElementById('redlineBanner');
    if(box && box.parentNode && !want){ box.parentNode.removeChild(box); box = null; }
    if(!want){ syncRawCard(r, host); paintScore(r); return; }
    if(!box){
      box = document.createElement('div');
      box.id = 'redlineBanner';
      try{ host.insertBefore(box, host.firstChild); }catch(e){ return; }
    }
    box.style.cssText = boxStyleOf(n, '10px 0');
    box.innerHTML = innerHTMLOf(n, null);
    syncRawCard(r, host);
    paintScore(r);
  }

  // ---------------- 历史详情：只重渲染该条详情容器（展开是纯 CSS checkbox，整表重渲染会收起） ----------------
  function historyBlock(det){
    var rel = det && det.redline, rb = det && det.rlRevoked;
    if(!rel && !(rb && rb.list && rb.list.length)) return '';
    var n = normRel(rel, rb);
    if(!n.list.length && !n.revN && !n.sess) return '';
    return '<div class="v4rl-his" style="' + boxStyleOf(n, '0 0 10px') + '">'
         + innerHTMLOf(n, { ts: det.ts, host: det.host }) + '</div>';
  }
  function syncSummary(sumEl, det){
    if(!sumEl) return;
    try{
      var sp = sumEl.querySelector('span[style*="min-width:52px"]');
      var b = sp ? sp.querySelector('b') : null;
      if(b) b.textContent = det.total;
      var gs = sumEl.querySelector('span[style*="font-size:10.5px"]');
      if(gs) gs.textContent = det.grade || '';
    }catch(e){}
  }
  function repaintHistory(anchorEl, det){
    try{
      var detEl = anchorEl && anchorEl.parentNode;
      if(detEl && detEl.className && String(detEl.className).indexOf('v4his-det') >= 0){
        detEl.innerHTML = v4DetailHTML(det);
        syncSummary(detEl.previousElementSibling, det);
        return true;
      }
    }catch(e){ STATS.err = 'repaintHistory:' + ((e && e.message) || e); }
    try{ if(typeof window.v4ArchRender === 'function') window.v4ArchRender('history'); }catch(e2){}
    return false;
  }

  // ---------------- 切换 ----------------
  function toggleOne(rel, idx){
    var x = (rel.reasons || [])[idx];
    if(!x) return { ok:false, why:'该条命中已不存在（记录可能已刷新），未做任何改动' };
    var f = fp(x);
    rel.revoked = rel.revoked || [];
    var found = -1, i;
    for(i=0;i<rel.revoked.length;i++){ if(String((rel.revoked[i]||{}).fp || '') === f){ found = i; break; } }
    if(found >= 0){ rel.revoked.splice(found, 1); STATS.restore++; }
    else {
      rel.revoked.push({ fp:f, code:x.code||'', cat:x.cat||'', term:x.term||'', src:x.src||'',
                         ts:x.ts||'', action:x.action||'', quote:String(x.quote||'').slice(0,120),
                         at:nowStr(), note:'' });
      STATS.revoke++;
    }
    recountRel(rel); STATS.toggle++;
    return { ok:true, action: (found >= 0 ? 'restore' : 'revoke') };
  }
  function toggleAll(rel, toRevoke){
    var rs = rel.reasons || [], i, k;
    rel.revoked = rel.revoked || [];
    for(i=0;i<rs.length;i++){
      var x = rs[i] || {}, f = fp(x), found = -1;
      for(k=0;k<rel.revoked.length;k++){ if(String((rel.revoked[k]||{}).fp || '') === f){ found = k; break; } }
      if(toRevoke && found < 0){
        rel.revoked.push({ fp:f, code:x.code||'', cat:x.cat||'', term:x.term||'', src:x.src||'',
                           ts:x.ts||'', action:x.action||'', quote:String(x.quote||'').slice(0,120),
                           at:nowStr(), note:'' });
      } else if(!toRevoke && found >= 0){ rel.revoked.splice(found, 1); }
    }
    recountRel(rel); STATS.toggle++;
    return { ok:true, action: (toRevoke ? 'revoke' : 'restore') };
  }

  // ---------------- 提示条 ----------------
  function toast(msg, bad){
    try{
      var el = document.getElementById('v4rev-toast');
      if(!el){
        el = document.createElement('div');
        el.id = 'v4rev-toast';
        el.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;max-width:420px;'
          + 'padding:10px 14px;border-radius:8px;font-size:12.5px;line-height:1.6;pointer-events:none';
        document.body.appendChild(el);
      }
      el.style.background = bad ? BG_RED : BG_GOLD;
      el.style.border = '1px solid ' + (bad ? ACC_RED : ACC_GOLD);
      el.style.color = bad ? ACC_RED : GOLD_TXT;
      el.innerHTML = msg;
      el.style.display = 'block';
      clearTimeout(el.__t);
      el.__t = setTimeout(function(){ try{ el.style.display = 'none'; }catch(e){} }, 6000);
    }catch(e){}
  }

  // ---------------- 点击（事件委托：重渲染后按钮依然有效） ----------------
  function findBtn(el){
    for(var n = el; n && n !== document; n = n.parentNode){
      if(n.nodeType === 1 && n.getAttribute && n.getAttribute('data-v4rev')) return n;
    }
    return null;
  }
  function commitRuntime(r, act){
    var rel = r.__redline, host = hostOf(null);
    repaintRuntime(r, null);
    var det = null;
    try{ det = v4DetailSnapshot(r, findTsFor(r) || Date.now()); }catch(e){}
    if(det){ localSave(det); localSaveSummary(det); }
    toast('已' + (act === 'restore' ? '恢复' : '撤销') + '本条判罚 —— 本场综合评分 '
          + (rel.sessionZero ? '仍为 0（还剩未撤销命中）' : '回填为 ' + r.total) + '，正在同步飞书…', false);
    if(!det) return;
    /* v4.11.44：当场报告路径也要**双写** —— 与 commitHistory 同一口径。
       v4.11.43 只改了历史详情那一支（commitHistory），当场这支仍是单写 ⇒
       在当场报告点「误判」时，历史评分表里还是撤销前的旧报告
       （同事从历史 tab 打开那条云端行，看到的仍是 0 分）。2026-10-14 线上探针实测抓出。 */
    var pend = 2, r1 = null, r2 = null;
    var fin2 = function(){
      if(--pend > 0) return;
      var ok1 = !!(r1 && r1.ok), ok2 = !!(r2 && r2.ok);
      var t = '已' + (act === 'restore' ? '恢复' : '撤销') + '本条判罚 —— 本场综合评分 '
            + (rel.sessionZero ? '仍为 <b>0</b>（还剩未撤销命中）' : '回填为 <b>' + r.total + '</b>');
      t += ok1 ? '　已同步飞书「综合评分」' + ((r1 && r1.warn) || '')
               : '　⚠️ 日报表未同步：' + ((r1 && r1.why) || '未知原因');
      t += ok2 ? '　历史评分表已回写（全员可见）。'
               : '　⚠️ 历史评分表未回写：' + ((r2 && r2.why) || '未知原因');
      if(!(ok1 && ok2)) t += '（本机已生效）';
      toast(t, false);
    };
    fbWrite(det, r.total, function(res){ r1 = res; fin2(); });
    fbWriteLib(det, function(res){ r2 = res; fin2(); });
  }
  function commitHistory(det, rel, anchorEl, act){
    var rawT = rawOf(det, rel);
    det.total = rel.sessionZero ? 0 : (typeof rawT === 'number' ? rawT : det.total);
    det.grade = v4RawGrade(det.total);
    // 存档不变式（与 v4.11.41 快照包装同一口径，负对照要求逐字节相同）：
    //   `rlRevoked` / `revV` 存在 ⟺ 至少有一条撤销留痕；全部恢复后回到"从未撤销"的形状，不留空壳字段。
    var s2 = sinkOf(rel);
    if(s2){ det.rlRevoked = s2; det.revV = '4.11.41'; }
    else { delete det.rlRevoked; delete det.revV; }
    if(rel.sessionZero){
      // ⚠️ 必须换回**存档形状**（v4.11.32 的契约），不能把运行时 rel 原样塞进去；
      //   同时保住 v4.11.33 的标注明细（notes / notesN / noteV），否则一次撤销会把它抹掉。
      var keep = det.redline || {};
      var ar = archiveRel(rel);
      if(keep.notes){ ar.notes = keep.notes; ar.notesN = keep.notesN; ar.noteV = keep.noteV; }
      det.redline = ar;
    }
    else { delete det.redline; }
    localSave(det); localSaveSummary(det);
    repaintHistory(anchorEl, det);
    // v4.11.43：云端缓存里还留着旧的「完整主播报告」⇒ 清掉，下次重渲染 / 切 tab 会拉新值。
    //   （本机有明细的行不受影响：本机明细优先，本机那条已就地更新过。）
    try{ if(window.V4CLOUD && window.V4CLOUD.cache) delete window.V4CLOUD.cache['history']; }catch(e){}
    toast('历史记录已' + (act === 'restore' ? '恢复' : '撤销') + ' —— 综合评分 <b>' + det.total
          + '</b>，正在同步飞书…', false);
    /* v4.11.43：**两路并行**，都回来才给最终结论 ——
       ① 「主播日报」表（feishu-fill，v4.11.41 起就有）
       ② 「历史评分」表（feishu-sync，本版新增）⇒ 这条才让历史 tab 的**云端行**真正持久化 */
    var pend = 2, r1 = null, r2 = null;
    var fin2 = function(){
      if(--pend > 0) return;
      var ok1 = !!(r1 && r1.ok), ok2 = !!(r2 && r2.ok);
      var t = '历史记录已' + (act === 'restore' ? '恢复' : '撤销') + ' —— 综合评分 <b>' + det.total + '</b>';
      t += ok1 ? '　已同步飞书。' + ((r1 && r1.warn) || '')
               : '　⚠️ 日报表未同步：' + ((r1 && r1.why) || '未知原因');
      t += ok2 ? '　历史评分表已回写（全员可见）。'
               : '　⚠️ 历史评分表未回写：' + ((r2 && r2.why) || '未知原因');
      if(!(ok1 && ok2)) t += '（本机已更新）';
      toast(t, !(ok1 && ok2));
    };
    fbWrite(det, det.total, function(res){ r1 = res; fin2(); });
    fbWriteLib(det, function(res){ r2 = res; fin2(); });
  }

  function onClick(ev){
    var b = findBtn(ev.target);
    if(!b || !on()) return;
    try{ ev.preventDefault(); ev.stopPropagation(); }catch(e){}
    var act = String(b.getAttribute('data-v4rev') || '');
    var rid = parseInt(b.getAttribute('data-v4rid'), 10);
    var ts = b.getAttribute('data-v4ts'), hs = b.getAttribute('data-v4host');
    var isAll = (act === 'allrev' || act === 'allunrev');
    var toRev = (act === 'rev' || act === 'allrev');
    var anchorEl = b.parentNode;
    while(anchorEl && anchorEl !== document.body && !(anchorEl.className && String(anchorEl.className).indexOf('v4rl-his') >= 0)) anchorEl = anchorEl.parentNode;
    if(anchorEl === document.body) anchorEl = null;

    // ---- 历史详情路径（按钮带 ts/host） ----
    if(ts){
      var det = null;
      try{ det = v4DetailByTs(ts, hs); }catch(e){}
      if(!det){ toast('找不到该条历史记录（可能已被清理），未做任何改动。', true); return; }
      var rel = det.redline;
      if(!rel){
        var rb0 = det.rlRevoked;
        if(!(rb0 && rb0.list && rb0.list.length)){ toast('该记录未沉淀红线数据，无法撤销。', true); return; }
        rel = { sessionZero: !!rb0.zero, moduleZero: false, zeroBase: !!rb0.zero,
                rawTotal: (typeof det.rawTotal === 'number' ? det.rawTotal : null),
                reasons: rb0.list.map(function(v){ return { code:v.code, cat:v.cat, term:v.term, src:v.src,
                         ts:v.ts, action:v.action, quote:v.quote }; }),
                revoked: rb0.list.map(function(v){ return { fp:v.fp, at:v.at, note:v.note }; }) };
      } else {
        // 存档里的 sessionZero 就是「本次处置前的原始判定」（撤销只改这个字段）⇒ 直接当基线
        if(rel.zeroBase === undefined) rel.zeroBase = !!rel.sessionZero;
      }
      var rawH = rawOf(det, rel);
      var can2 = canRevoke(rel, rawH);
      if(!can2.ok){ toast(can2.why, true); return; }
      var res2 = isAll ? toggleAll(rel, toRev) : toggleOne(rel, rid);
      if(!res2.ok){ toast(res2.why, true); return; }
      commitHistory(det, rel, anchorEl, res2.action);
      return;
    }

    // ---- 当场报告路径 ----
    var r = LAST_R;
    if(!r || !r.__redline){ toast('未找到本场结果（请刷新后重试），未做任何改动。', true); return; }
    var can = canRevoke(r.__redline, rawOf(r, r.__redline));
    if(!can.ok){ toast(can.why, true); return; }
    var res = isAll ? toggleAll(r.__redline, toRev) : toggleOne(r.__redline, rid);
    if(!res.ok){ toast(res.why, true); return; }
    if(!recomputeRev(r)){ toast('重算失败：取不到本场原分，已放弃本次撤销。', true); return; }
    commitRuntime(r, res.action);
  }

  // ---------------- 装载 ----------------
  var LAST_R = null, swapped = 0;

  // ① 当场报告：包 v4AttachSemanticEvidence（批量也走这里；批量只有汇总横幅，不挂按钮）
  try{
    if(typeof window.v4AttachSemanticEvidence === 'function'){
      var _att = window.v4AttachSemanticEvidence;
      window.v4AttachSemanticEvidence = function(x){
        var ret = _att.apply(this, arguments);
        try{
          if(on() && x && !Array.isArray(x) && x.__redline){ LAST_R = x; repaintRuntime(x, null); }
        }catch(e){ STATS.err = 'attach:' + ((e && e.message) || e); LOG(STATS.err); }
        return ret;
      };
      swapped++;
    }
  }catch(e){}

  // ② 历史详情：替换那段红色横幅 + 隐去与总分重复的「不计违规项」卡
  try{
    if(typeof v4DetailHTML === 'function'){
      var _html = v4DetailHTML;
      v4DetailHTML = function(det){
        var h = _html.apply(this, arguments);
        try{
          if(!on() || !det) return h;
          var mine = historyBlock(det);
          if(!mine) return h;
          var old = '';
          try{
            if(det.redline && window.V4RLH && typeof window.V4RLH.render === 'function') old = String(window.V4RLH.render(det.redline));
          }catch(e1){}
          if(old && h.indexOf(old) >= 0) h = h.replace(old, function(){ return mine; });
          else h = mine + h;
          // 本场已不再判 0 ⇒「不计违规项」卡与总分是同一个数，隐去以免看着像 bug。
          //   ⚠️ 隐去的只是**这份重复展示**；飞书那一列的值一个字都没动（老大明确要求不变）。
          var n2 = normRel(det.redline, det.rlRevoked);
          if(!n2.sess && n2.revN > 0 && typeof det.rawTotal === 'number'){
            var rw = '';
            try{ rw = v4RawResultHTML(det, 'history'); }catch(e2){}
            if(rw && h.indexOf(rw) >= 0) h = h.replace(rw, function(){ return ''; });
          }
        }catch(e3){ STATS.err = 'html:' + ((e3 && e3.message) || e3); LOG(STATS.err); }
        return h;
      };
      swapped++;
    }
  }catch(e){}

  // ③ 存档：把撤销表沉淀成 det.rlRevoked（不以 __ 开头 ⇒ 能进存档与飞书）
  try{
    if(typeof v4DetailSnapshot === 'function'){
      var _snap = v4DetailSnapshot;
      v4DetailSnapshot = function(r, ts){
        var det = _snap.apply(this, arguments);
        try{
          if(!on() || !det || !r) return det;
          var s = sinkOf(r.__redline);
          if(s){ det.rlRevoked = s; det.revV = '4.11.41'; }   // revV = **存档格式标记**，不跟 V4_VERSION 走
          else if(det.rlRevoked) delete det.rlRevoked;
        }catch(e1){ STATS.err = 'snap:' + ((e1 && e1.message) || e1); LOG(STATS.err); }
        return det;
      };
      swapped++;
    }
  }catch(e){}

  // ④ 重新评分：把该主播该日期的历史撤销结论回灌到新结果（同一场次的人工复核应当沿用）
  try{
    if(typeof window.v4Evaluate === 'function'){
      var _ev = window.v4Evaluate;
      window.v4Evaluate = async function(segs, productKey, job){
        var r = await _ev.apply(this, arguments);
        try{
          if(on() && r && r.__redline && r.host){
            var det0 = null;
            try{
              var ds = v4ReadLS('grading_detail_v1', '[]');
              for(var i=ds.length-1;i>=0;i--){
                if(ds[i] && ds[i].host === r.host && String(ds[i].date||'') === String(r.date||'') && ds[i].rlRevoked){ det0 = ds[i]; break; }
              }
            }catch(e1){}
            if(det0 && det0.rlRevoked && det0.rlRevoked.list && det0.rlRevoked.list.length){
              r.__redline.revoked = det0.rlRevoked.list.map(function(v){ return { fp:v.fp, at:v.at, note:v.note }; });
              recomputeRev(r);
              LOG('回灌历史撤销 ' + r.__redline.revoked.length + ' 条 → ' + r.host + ' ' + r.date
                  + '，总分 ' + r.total + (r.__redline.sessionZero ? '（仍判 0）' : '（已按原分）'));
            }
          }
        }catch(e2){ STATS.err = 'revive:' + ((e2 && e2.message) || e2); LOG(STATS.err); }
        return r;
      };
      swapped++;
    }
  }catch(e){}

  try{ document.addEventListener('click', onClick, true); }catch(e){}

  window.V4RLREV = {
    __installed: true,
    version: (typeof V4_VERSION === 'string') ? V4_VERSION.replace(/^v/, '') : '',
    on:  function(){ try{ localStorage.removeItem(LS_OFF); }catch(e){} return 'on'; },
    off: function(){ try{ localStorage.setItem(LS_OFF, '0'); }catch(e){} return 'off'; },
    onQ: on,
    swapped: swapped,
    fp: fp,
    rawOf: rawOf,
    norm: function(rel, rb){ return normRel(rel || {}, rb || null); },
    sink: sinkOf,
    archive: archiveRel,
    // 纯函数入口（沙箱验证用：不碰 DOM、不发网络请求）
    recount: recountRel,
    recompute: recomputeRev,
    canRevoke: function(rel, rawT){ return canRevoke(rel, (rawT === undefined ? (rel && rel.rawTotal) : rawT)); },
    toggle: toggleOne,
    toggleAll: toggleAll,
    build: function(rel, rb, scope){ return innerHTMLOf(normRel(rel, rb), scope || null); },
    // 载荷层接缝：返回**将要发往飞书的 body**（不发请求）⇒ 验证脚本可断言
    //   「未记录 违规-综合评分」列不被触碰、c1–c8 齐全（缺一即 ok:false，宁可不写）
    payload: function(det, total){ return buildBody(det, total); },
    modsForWrite: modsForWrite,
    probe: function(r){
      var rel = r && r.__redline;
      return { has: !!rel, can: canRevoke(rel, rawOf(r, rel)), total: r && r.total, grade: r && r.grade,
               sessionZero: !!(rel && rel.sessionZero), zeroBase: !!(rel && rel.zeroBase),
               revoked: rel ? ((rel.revoked||[]).length) : 0, active: rel ? (rel.activeN || 0) : 0,
               listed: rel ? ((rel.reasons||[]).map(function(x){ return { code:x.code, revoked: !!x.revoked }; })) : [] };
    },
    // v4.11.43：历史评分表回写的独立开关与接缝
    libOnQ: libOn,
    libOn:  function(){ try{ localStorage.removeItem(LS_LIBOFF); }catch(e){} return 'on'; },
    libOff: function(){ try{ localStorage.setItem(LS_LIBOFF, '0'); }catch(e){} return 'off'; },
    libUrl: libReady,
    // 与 fbWriteLib 共用同一份 libBody ⇒ 断言的就是真正发出去的那份载荷
    libPayload: libBody,
    debug: function(){ return { on: on(), swapped: swapped, stats: STATS, shellV: V4_VERSION,
                                fillUrl: fbReady(), libUrl: libReady(), libOn: libOn() }; }
  };
  LOG('已装载：红线判罚可人工撤销（留痕可恢复）｜接管 ' + swapped + '/4 个公开入口；判定口径未动，原分取 rel.rawTotal 或精确复算');
  LOG('v4.11.44：当场报告路径也双写（与历史详情同口径）—— 主播日报表(fill) + 历史评分表(sync)');
})();

// =====================================================
// v4.11.45（2026-10-15）：飞书日报表两列同步
//   「命中平台红线 —— 本场总分按 0 计」 + 「已标注（不判 0 分）」
// -----------------------------------------------------
// 需求原文（老大 2026-10-15）：「飞书在线表上面并未记录 评分结果中这2项，需要同步的」
//   ⇒ 把工作台评分结果页面上那两块（红色判罚横幅 / 金色标注区）的**明细清单**写进飞书两列。
//
// 三处落点（缺任何一处，这两列恒为空 —— 2026-10-15 实测坐实）：
//   ① 飞书「主播日报」tblQC7Jfzmxp6QJI **已有**这两列：老大手工建的，实测第 27 / 28 个字段，
//      类型均为多行文本；全表 177 行 0 覆盖。
//      🔴 列名逐字（多行文本按列名匹配，错一个字就是静默写空）：
//         「命中平台红线 —— 本场总分按 0 计」—— 是「**按** 0 计」，不是「0 分计」
//         「已标注（不判 0 分）」—— **没有 AI 前缀**
//   ② api/feishu-fill.js —— 加两行列名映射（服务端，必须 push 才生效）
//   ③ 本块 —— 生成纯文本并挂到载荷对象上
//
// 挂点（**两个**，一条通路都不能漏）：
//   A. buildBody(det,total) 里留一行 hook —— 覆盖 v4-shell 自己的写回（撤销 / 恢复，v4.11.41+）。
//      ⚠️ buildBody / fbWrite 同在一个 IIFE 闭包内 ⇒ 从外面 patch 不透（铁律）⇒ 只能在源码里加一行。
//   B. 包装 4 个公开写入口（同 v4.11.37 的做法）—— 覆盖 app-core / workflow 自己构造载荷的通路
//      （autoFillFeishu / addHistoryRecord / V4Jobs.sync / V4Jobs.syncLibs）。
//      ⚠️ workflow.js 排在 v4-shell.js 之后加载 ⇒ 装载时 V4Jobs.* 恒为 no-op，故配 lateWrap 补包。
//
// 数据源（只读，判定逻辑一行未动）：
//   · 红线命中  rel.reasons —— {cat,code,term,src,action,ts,quote}
//               ⚠️ code / term / ts 可能是空串：**语义通道命中**就是全空（实测王菲 2026-10-14）
//   · 撤销留痕  运行时 rel.revoked[] / 存档 det.rlRevoked.list —— 按 fp() 指纹匹配
//               ⚠️ archiveRel() **不保留** revoked 标记 ⇒ 必须靠指纹反查，不能读 reasons[].revoked
//   · 标注明细  rel.scan.annotateHits（运行时）/ det.redline.notes（存档，v4.11.33 沉淀）
//
// 口径（严格对齐页面渲染，避免「表里一套、屏上一套」）：
//   · 标题随撤销状态走：仍判 0 / 部分撤销 / 全部撤销（留痕不真删，逐条标「已撤销（误判）」+ 时间 + 理由）
//   · 未命中 / 未标注 ⇒ 内容为空（老大 2026-10-15 选定「明细清单，未命中留空」）
//   · 🔴 三种返回语义必须分清（本块最容易写错的地方）：
//       null  ⇒ **不挂键**（PUT 部分更新，缺键不清空既有值）—— 用于「本场数据不可知」的老记录
//       ''    ⇒ **显式写空串清列** —— 用于「确知本场无命中」（有 redline 数据却无明细）
//       非空  ⇒ 正常写入明细
//   · 🔴 全撤后存档契约会 delete det.redline（v4.11.41「不留空壳」）⇒ 此时只能从 det.rlRevoked.list
//     还原命中清单，否则会把「已撤销」的场次写成空，等于把留痕抹掉。
// 导出 window.V4RLCOL 供**存量回填脚本**复用同一份文本口径（绝不另写一套模板，防两处漂移）。
// =====================================================
(function(){
  var LS_OFF   = 'v4rlcol_enabled';
  var MAX_ITEM = 30;      // 单列最多渲染条数（超出走「…另有 N 条」）
  var MAX_LEN  = 9000;    // 单格文本上限保护（飞书多行文本单格官方上限 100000，留足余量）
  var QMAX     = 120;     // 单条引文截断
  var SEP      = String.fromCharCode(1);   // 必须与 v4.11.41 的 fp() 一致
  var STATS = { hit:0, note:0, blank:0, skip:0, wrapped:0, err:'' };
  var LOG = function(m){ try{ console.log('[v4.11.45] ' + m); }catch(e){} };

  function on(){ try{ return localStorage.getItem(LS_OFF) !== '0'; }catch(e){ return true; } }
  function S(v){ return String(v == null ? '' : v); }
  function one(v, n){
    var s = S(v).replace(/\s+/g, ' ').trim();
    return (n && s.length > n) ? (s.slice(0, n) + '…') : s;
  }
  // 与 v4.11.41 的 fp() 逐字符同口径（撤销留痕就是按它索引的）
  function fp(x){
    x = x || {};
    return [x.code||'', x.src||'', x.cat||'', x.term||'', x.ts||'', x.action||''].join(SEP);
  }
  // 运行时对象与存档快照统一成一份视图（两条通路的字段名不一样，必须归一）
  function norm(det){
    det = det || {};
    var rl = det.redline || det.__redline || null;
    var list = [];
    if(det.rlRevoked && det.rlRevoked.list && det.rlRevoked.list.length) list = det.rlRevoked.list;
    else if(rl && rl.revoked && rl.revoked.length) list = rl.revoked;
    return { rl: rl,
             // 「本场红线数据是否可知」：存档看 redlineV（v4.11.31+ 才写），运行时看 __redline 在不在
             known: !!(det.redlineV || det.__redline || det.redline),
             notes: (rl && rl.notes) || (rl && rl.scan && rl.scan.annotateHits) || [],
             notesN: (rl && rl.notesN) || (rl && rl.scan && rl.scan.annotateGroups) || 0,
             reasons: (rl && rl.reasons) || [], rev: list };
  }
  function revMap(view){
    var m = {}, i;
    for(i=0;i<view.rev.length;i++){ var x = view.rev[i] || {}; if(x.fp) m[S(x.fp)] = x; }
    return m;
  }
  // 逐条明细（字段顺序刻意与页面横幅一致：编号、分类、触发词、来源、时间）
  function item(x, rv, withAct){
    var s = S(x.cat);
    if(x.code) s = '[' + S(x.code) + '] ' + s;
    if(x.term) s += '　触发词「' + S(x.term) + '」';
    if(x.count && x.count > 1) s += ' ×' + x.count;
    if(x.src) s += '　[' + S(x.src) + (withAct ? '（' + (x.action === 'MODULE_ZERO' ? '模块归0' : '整场归0') + '）' : '') + ']';
    if(x.ts) s += ' ' + S(x.ts);
    if(rv) s += '　✗ 已撤销（误判）' + (rv.at ? ' · ' + S(rv.at) : '') + (rv.note ? '　理由：' + S(rv.note) : '');
    return s;
  }
  function render(title, rows){
    var out = title, i, n = 0;
    for(i=0;i<rows.length && i<MAX_ITEM;i++){
      out += '\n' + (i+1) + '. ' + rows[i].line;
      if(rows[i].quote) out += '\n　　「' + rows[i].quote + '」';
      n++;
    }
    if(rows.length > n) out += '\n…另有 ' + (rows.length - n) + ' 条';
    if(out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '\n…（明细超长已截断，完整内容见评分系统）';
    return out;
  }

  /* ---------- 第一列：命中平台红线 —— 本场总分按 0 计 ---------- */
  function redlineText(det){
    var view = norm(det), rl = view.rl, rb = revMap(view), rows = [], i, x, rv;
    if(view.reasons.length){
      for(i=0;i<view.reasons.length;i++){
        x = view.reasons[i] || {}; rv = rb[fp(x)] || null;
        rows.push({ line: item(x, rv, true), quote: one(x.quote, QMAX) });
      }
    } else if(view.rev.length){
      // 全撤后 det.redline 已被 delete ⇒ 从留痕还原（否则等于把留痕抹掉）
      for(i=0;i<view.rev.length;i++){ x = view.rev[i] || {};
        rows.push({ line: item(x, x, true), quote: one(x.quote, QMAX) });
      }
    } else {
      // 确知无命中 ⇒ 空串清列；数据不可知（老记录）⇒ 不挂键、不误清
      return view.known ? '' : null;
    }
    var revN = 0;
    for(i=0;i<rows.length;i++){ if(rows[i].line.indexOf('已撤销（误判）') >= 0) revN++; }
    var sess = !!(rl && rl.sessionZero);
    var title;
    if(revN && revN === rows.length) title = '全部命中已撤销（误判）—— 本场按原分计（共 ' + rows.length + ' 处）';
    else if(sess) title = '本场总分按 0 计（共 ' + rows.length + ' 处命中' + (revN ? '，其中 ' + revN + ' 处已撤销为误判' : '') + '）';
    else if(rl && rl.moduleZero) title = '对应能力模块按 0 计（共 ' + rows.length + ' 处命中）';
    else title = '共 ' + rows.length + ' 处命中';
    return render(title, rows);
  }

  /* ---------- 第二列：已标注（不判 0 分） ---------- */
  function annotText(det){
    var view = norm(det), ns = view.notes, rows = [], i, x;
    if(!ns.length){
      // 🔴 判据是「**标注数据可知吗**」，不是「有没有红线」：
      //   v4.11.33 之前的存档 det.redline 只有 reasons、**根本没有 notes 字段**
      //   ⇒ 那时压根没沉淀标注，写空串会把别人已经填好的值误清。
      //   （2026-10-15 沙箱断言抓到过：原先写成 view.rl ? '' : null 会把这种记录判成"确知无标注"。）
      var rl0 = view.rl;
      var known = !!(rl0 && (rl0.notes || (rl0.scan && rl0.scan.annotateHits)));
      return known ? '' : null;
    }
    for(i=0;i<ns.length;i++){ x = ns[i] || {};
      rows.push({ line: item(x, null, false), quote: one(x.quote, QMAX) });
    }
    var n = view.notesN || ns.length;
    return render('已标注 ' + n + ' 处（不判 0 分，不影响总分与等级）', rows);
  }

  /* ---------- 挂点 A：buildBody 的注入点（唯一被 fbWrite 覆盖的地方） ---------- */
  function fill(det, result){
    try{
      if(!on() || !result || typeof result !== 'object') return 0;
      var t1 = redlineText(det), t2 = annotText(det);
      if(t1 !== null){ result.redlineText = t1; if(t1) STATS.hit++; else STATS.blank++; } else STATS.skip++;
      if(t2 !== null){ result.annotText  = t2; if(t2) STATS.note++; else STATS.blank++; } else STATS.skip++;
      return 1;
    }catch(e){ STATS.err = 'fill:' + ((e && e.message) || e); LOG(STATS.err); return 0; }
  }

  /* ---------- 挂点 B：4 个公开写入口（app-core / workflow 自己构造载荷的通路） ---------- */
  function wrap(obj, name){
    try{
      if(!obj || typeof obj[name] !== 'function') return false;
      var orig = obj[name];
      if(orig.__v41145) return false;              // 幂等：包过的本次不重复计
      var patched = function(x){
        try{
          var arr = Array.isArray(x) ? x : [x], i;
          for(i=0;i<arr.length;i++){ var r = arr[i]; if(r && typeof r === 'object') fill(r, r); }
        }catch(e){ STATS.err = 'wrap:' + ((e && e.message) || e); LOG(STATS.err); }
        return orig.apply(this, arguments);
      };
      patched.__v41145 = true;
      obj[name] = patched;
      return true;
    }catch(e){ return false; }
  }
  function mount(){
    var n = 0;
    if(wrap(window, 'autoFillFeishu')) n++;
    if(wrap(window, 'addHistoryRecord')) n++;
    try{ if(wrap(window.V4Jobs, 'sync')) n++; }catch(e){}
    try{ if(wrap(window.V4Jobs, 'syncLibs')) n++; }catch(e){}
    return n;
  }
  STATS.wrapped = mount();
  function lateWrap(){
    var t = mount();
    if(t > STATS.wrapped) STATS.wrapped = t;
    LOG('写入口接管（含延迟补包）：累计 ' + STATS.wrapped + '/4');
  }
  try{
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lateWrap);
    else setTimeout(lateWrap, 0);
  }catch(e){}

  window.V4RLCOL = {
    __installed: true,
    version: V4_VERSION.replace(/^v/, ''),
    fieldHit:  '命中平台红线 —— 本场总分按 0 计',
    fieldNote: '已标注（不判 0 分）',
    onQ: on,
    on:  function(){ try{ localStorage.removeItem(LS_OFF); }catch(e){} return 'on'; },
    off: function(){ try{ localStorage.setItem(LS_OFF, '0'); }catch(e){} return 'off'; },
    fill: fill,
    // 供存量回填脚本复用同一份文本口径；null = 不写该列，'' = 写空串清列
    text:  function(det){ return { redlineText: redlineText(det), annotText: annotText(det) }; },
    probe: function(det){
      var t = this.text(det);
      return { redlineText: t.redlineText, annotText: t.annotText,
               hit:  t.redlineText === null ? 'skip' : (t.redlineText ? 'write' : 'blank'),
               note: t.annotText  === null ? 'skip' : (t.annotText  ? 'write' : 'blank') };
    },
    debug: function(){ return { on: on(), stats: STATS, shellV: V4_VERSION }; }
  };
  LOG('已装载：飞书日报表两列同步（红线命中 / 已标注）｜写入口接管 ' + STATS.wrapped + '/4，判定逻辑未动');
})();

// ============================================================================
// v4.11.50：品类门控（行李箱 / 包袋 分开识别）——  2026-10-27
// 背景（老大报障）：双肩包的评判规则混进行李箱场次，行李箱主场被判成双肩包。
// 根因（已实测复现）：整场品类原先由「段归属字符长度」决胜 —— 谁那段字多谁赢，
//   不看证据强度。一句包袋对比话术就能把行李箱主场判给双肩包；
//   反过来双肩包场次里一句行李箱术语也会把整场判给行李箱。
// 修法（只在壳层，不改任何权重 / 公式 / 扣分口径 / 既有词表）：
//   ① 品类预判：行李箱迹象分 vs 包袋迹象分（只用不可混淆的品类词，禁单字「包」）
//   ② 包型预判：包袋内再分 双肩包型 / 托特包型（治 tote 抢 backpack）
//   ③ 品类内选品：强信号（品名全名 / 括号内中文名 / 别名 / 专属词）优先，
//      「字数额度」只作兜底 —— 原逻辑用它决胜，正是 C6 回归的元凶
//   ④ 安全阀：迹象不足、或品类内零命中 → 返回空，交回原有 auto 逻辑，绝不硬猜
// 数据依赖：GRADING_STANDARD.products[*].cat（luggage|bag）与 .sub（backpack|tote），
//   由 standard.js v2.2 新增；产品若无 cat 标签则**永不被排除**（防新增产品被误挡）。
// 退路：localStorage 置 v4cat_enabled='0' 后刷新即恢复原状。
// 自检：V4CAT.debug([{text:'这一款双肩包…'}]) / V4CAT.off() / V4CAT.on()
// ----------------------------------------------------------------------------
// v4.11.51（2026-10-28 老大拍板：**文件名与话术冲突时一律以文件名为准**）
// 背景（老大提问：「品类区分是根据上传视频的名称做第一次筛选，这个不行么？」）：
//   本来就行 —— v4.11.32 的 A 路径注释写明业务口径「主播整场不念品名时以文件名为准」。
//   但 v4.11.50 的门控把 productKey 从 'auto' 先改成了具体产品，导致内层 A 路径的
//   条件 key==='auto' 不成立 ⇒ 文件名彻底失去发言权。实测（_vfy_filename_priority.mjs）
//   文件名/话术冲突 3 个用例 F1/F2/F3 **全部判错**，A 路径 autoFixed 计数不动。
// 修法：门控入口先问文件名。文件名能定品 ⇒ **不覆盖 pk**，放手交内层 A 路径用同一文件名
//   定品（这样 A 的 forcedKey 会带上考核品 ⇒ B 的 ④ 模块对齐一并生效，报告上下同一产品名，
//   不会退回 10-08 那个「顶部双肩包 / ④ 行李箱」打架的老毛病）；
//   仅当 A 路径不可用（V4PFX 被关 / 未装载）时才由门控自己定 pk 兜底。
//   文件名缺失或识别不出（48 份历史语料有 24 份文件名压根没产品段）⇒ 照旧走话术门控。
// 退路（两级）：localStorage 置 v4fnfirst_enabled='0' 恢复「文件名只兜底真歧义」；
//   置 v4cat_enabled='0' 连同门控一起恢复 10-27 之前。
// 自检：V4CAT.debug([{text:'…'}])（会先报文件名优先结果）/ V4CAT.fnPick([{text:'…'}])
// ============================================================================
(function(){
  if(window.V4CAT && window.V4CAT.__installed) return;

  var ON_KEY = 'v4cat_enabled';
  function on(){ try{ return localStorage.getItem(ON_KEY) !== '0'; }catch(e){ return true; } }
  function LOG(m){ try{ if(window.__V4CAT_VERBOSE) console.log('[cat-gate] ' + m); }catch(e){} }
  var LAST = null;

  // 品类迹象词（权重 3=品类名词，2=形态/结构；**禁单字「包」**，避免包邮/包裹/包含误命中）
  var CAT_SIG = {
    luggage: [['行李箱',3],['拉杆箱',3],['登机箱',3],['托运箱',3],['硬箱',3],['箱体',2],['箱壳',2],
              ['万向轮',2],['静音轮',2],['滚轮',2],['拉杆',2],['海关锁',2],['tsa',2],['铝框',2],
              ['前开盖',2],['顶开盖',2],['20寸',2],['24寸',2],['26寸',2],['28寸',2],['30寸',2]],
    bag:      [['双肩包',3],['背包',3],['托特包',3],['通勤包',3],['手提包',3],['斜挎包',3],['单肩包',3],
              ['双肩',2],['单肩',2],['斜挎',2],['肩带',2],['背带',2],['背负',2],['腋下',2],['手提',2]]
  };
  // 包袋二级包型迹象词
  var SUB_SIG = {
    backpack: [['双肩包',3],['背包',3],['双肩',3]],
    tote:     [['托特包',3],['托特',3],['单肩',2],['手提包',2],['手提',2],['腋下',2]]
  };

  // 段内打分：每词每段只计一次；若短词是某已命中长词的子串则不计（「双肩包」命中则不再算「背包」「双肩」）
  function scoreSeg(t, table){
    var matched = [], i;
    for(i=0;i<table.length;i++){
      if(t.indexOf(table[i][0]) >= 0) matched.push({w:table[i][0], wt:table[i][1]});
    }
    var total = 0, hits = [];
    for(i=0;i<matched.length;i++){
      var m = matched[i], shadowed = false;
      for(var k=0;k<matched.length;k++){
        if(k === i) continue;
        var n = matched[k];
        if(n.w.length > m.w.length && n.w.indexOf(m.w) >= 0){ shadowed = true; break; }
      }
      if(!shadowed){ total += m.wt; hits.push(m.w + '+' + m.wt); }
    }
    return {total:total, hits:hits};
  }

  // 专属词池：与 v4-shell.js 内 v4BuildExclPool 等价（该函数是 IIFE 私有，此处独立实现并缓存）
  var POOL_CACHE = null, POOL_FOR = null;
  function buildPool(){
    var STD = GRADING_STANDARD;
    if(POOL_CACHE && POOL_FOR === STD) return POOL_CACHE;
    var keys = Object.keys(STD.products || {});
    var exclMap = {}, i;
    for(i=0;i<keys.length;i++) exclMap[keys[i]] = (STD.productExclusive && STD.productExclusive[keys[i]]) || [];
    function usedBy(w){
      var owners = 0;
      for(var a=0;a<keys.length;a++){
        var k2 = keys[a], hit = false;
        if((exclMap[k2]||[]).indexOf(w) >= 0) hit = true;
        if(!hit && STD.sellpoints && STD.sellpoints[k2] && STD.sellpoints[k2].list){
          var L = STD.sellpoints[k2].list;
          for(var b=0;b<L.length;b++){ if((L[b].keywords||[]).indexOf(w) >= 0){ hit = true; break; } }
        }
        if(!hit && STD.products[k2]){
          var al = STD.products[k2].aliases || [];
          if(al.indexOf(w) >= 0 || STD.products[k2].name === w) hit = true;
        }
        if(hit) owners++;
      }
      return owners;
    }
    var pool = {}, c, d;
    for(c=0;c<keys.length;c++){
      var k3 = keys[c]; pool[k3] = [];
      var ex = exclMap[k3];
      for(d=0;d<ex.length;d++){
        var w = ex[d]; if(!w) continue;
        if(usedBy(w) <= 1) pool[k3].push(String(w).toLowerCase());
      }
    }
    POOL_CACHE = pool; POOL_FOR = STD;
    return pool;
  }

  // 强信号分数：品名 100 / 括号内中文名 200 / 别名 50 / 专属词 10。
  // **刻意不含卖点词（原逻辑的 ×1）** —— 卖点词同品类几乎通用，会把真品名信号淹没。
  function strongScore(t, pk, pool){
    var STD = GRADING_STANDARD, sc = 0;
    var p = STD.products[pk] || {};
    var name = p.name ? String(p.name).toLowerCase() : '';
    if(name && t.indexOf(name) >= 0) sc += 100;
    var inner = '';
    if(name){
      var nm = name.match(/[（(]([^）)]+)[）)]/);
      if(nm) inner = nm[1].toLowerCase();
    }
    if(inner && t.indexOf(inner) >= 0) sc += 200;
    var al = p.aliases || [], i;
    for(i=0;i<al.length;i++){
      var aw = String(al[i] || '').toLowerCase();
      if(aw && t.indexOf(aw) >= 0) sc += 50;
    }
    var ex = pool[pk] || [];
    for(i=0;i<ex.length;i++){ if(ex[i] && t.indexOf(ex[i]) >= 0) sc += 10; }
    return sc;
  }

  function pickScoped(segs){
    var STD = GRADING_STANDARD;
    var keys = Object.keys(STD.products || {});
    var pool = buildPool();
    var sL = 0, sB = 0, subB = 0, subT = 0;
    var trace = [], s;
    for(s=0;s<segs.length;s++){
      var t = String((segs[s] && segs[s].text) || '').toLowerCase();
      if(!t){ trace.push({lug:0, bag:0, hits:[]}); continue; }
      var a = scoreSeg(t, CAT_SIG.luggage);
      var b = scoreSeg(t, CAT_SIG.bag);
      sL += a.total; sB += b.total;
      subB += scoreSeg(t, SUB_SIG.backpack).total;
      subT += scoreSeg(t, SUB_SIG.tote).total;
      trace.push({lug:a.total, bag:b.total, hits:a.hits.concat(b.hits)});
    }
    var cat = 'unknown';
    if(sL > sB) cat = 'luggage'; else if(sB > sL) cat = 'bag';
    var sub = 'unknown';
    if(cat === 'bag'){
      if(subB > subT) sub = 'backpack'; else if(subT > subB) sub = 'tote';
    }
    var info = {cat:cat, sub:sub, sL:sL, sB:sB, subBackpack:subB, subTote:subT};
    if(cat === 'unknown'){
      info.reason = '品类迹象不足，交回原 auto 逻辑';
      return {pk:'', info:info, trace:trace};
    }
    // 候选集：品类不符则排除；无 cat 标签的产品**永不被排除**；包袋再按包型收窄
    var allowed = [], i;
    for(i=0;i<keys.length;i++){
      var k = keys[i], p = STD.products[k] || {};
      var pc = p.cat || '';
      if(!pc){ allowed.push(k); continue; }
      if(pc !== cat) continue;
      if(cat === 'bag' && sub !== 'unknown'){
        var ps = p.sub || '';
        if(ps && ps !== sub) continue;
      }
      allowed.push(k);
    }
    var strong = {}, chars = {};
    for(i=0;i<allowed.length;i++){ strong[allowed[i]] = 0; chars[allowed[i]] = 0; }
    for(s=0;s<segs.length;s++){
      var tt = String((segs[s] && segs[s].text) || '').toLowerCase();
      if(!tt) continue;
      var bestK = '', bestSc = 0;
      for(i=0;i<allowed.length;i++){
        var pk = allowed[i];
        var sc = strongScore(tt, pk, pool);
        if(sc > 0) strong[pk] += sc;
        if(sc > bestSc){ bestSc = sc; bestK = pk; }
      }
      if(bestK && bestSc > 0) chars[bestK] += tt.length;
    }
    info.candidates = allowed;
    info.strong = strong;
    var top = '', topS = 0;
    for(i=0;i<allowed.length;i++){
      if(strong[allowed[i]] > topS){ topS = strong[allowed[i]]; top = allowed[i]; }
    }
    if(topS > 0){
      info.reason = '强信号选品';
      return {pk:top, info:info, trace:trace};
    }
    var top2 = '', tc = 0;
    for(i=0;i<allowed.length;i++){
      if(chars[allowed[i]] > tc){ tc = chars[allowed[i]]; top2 = allowed[i]; }
    }
    if(tc > 0){
      info.reason = '字数额度兜底（强信号全无）';
      return {pk:top2, info:info, trace:trace};
    }
    info.reason = '品类内零命中，交回原 auto 逻辑';
    return {pk:'', info:info, trace:trace};
  }

  // ---------- v4.11.51：文件名优先（冲突时以文件名为准） ----------
  var FN_KEY = 'v4fnfirst_enabled';
  function fnOn(){ try{ return localStorage.getItem(FN_KEY) !== '0'; }catch(e){ return true; } }
  function joinTxt(segs){
    var o = [], i;
    for(i=0;i<(segs||[]).length;i++) o.push(String((segs[i]||{}).text || ''));
    return o.join('\n');
  }
  // 只认「正在跑的任务」的文件名，不读 DOM —— 与 v4.11.32 同口径（防跑批时误取另一页签选中的文件）
  function runningFile(){
    try{
      var J = window.V4Jobs;
      if(!J || !J.getJob) return '';
      var order = ['vision','daily','batch'], i;
      for(i=0;i<order.length;i++){
        var jb = J.getJob(order[i]);
        if(jb && jb.state === 'running' && jb.file && jb.file.name) return jb.file.name;
      }
    }catch(e){}
    return '';
  }
  // 文件名 → 产品 key；识别不出 / 不在标准库 ⇒ null（回落话术门控）
  function fnPick(segs){
    if(!fnOn()) return null;
    var fn = runningFile();
    if(!fn) return null;
    var inf = null;
    try{
      if(typeof window.detectProductFromName === 'function') inf = window.detectProductFromName(fn, joinTxt(segs));
    }catch(e){ LOG('文件名推断异常：' + ((e && e.message) || e)); return null; }
    if(!inf) return null;
    var STD = (typeof GRADING_STANDARD !== 'undefined' && GRADING_STANDARD) ? GRADING_STANDARD : window.GRADING_STANDARD;
    if(!STD || !STD.products || !STD.products[inf]) return null;
    var p = STD.products[inf] || {};
    return { pk: inf, cat: p.cat || 'unknown', sub: p.sub || 'unknown', file: fn };
  }
  // 内层 A 路径（v4.11.32）是否可用：可用就放手让它定品（顺带把 ④ 模块一起对齐）
  function aPathUsable(){
    try{
      return !!(window.V4PFX && window.V4PFX.__installed && window.V4PFX.offQ && !window.V4PFX.offQ());
    }catch(e){ return false; }
  }
  function fnInfo(f, note){
    return { pk: f.pk, info: {
      cat: f.cat, sub: f.sub, reason: note, file: f.file,
      sL: 0, sB: 0, subBackpack: 0, subTote: 0, candidates: [f.pk], strong: {}
    }, trace: [] };
  }

  // ---- 挂载：包 window.runGrading，先定品类再交给原有链路 ----
  var _origRun = window.runGrading;
  if(typeof _origRun === 'function'){
    window.runGrading = function(segs, productKey, options){
      var pk = productKey;
      var isAuto = (pk === 'auto' || pk === '' || pk === null || typeof pk === 'undefined');
      if(isAuto && on()){
        // 一级：文件名优先（v4.11.51，2026-10-28 拍板：冲突时以文件名为准）
        var f = fnPick(segs);
        if(f){
          if(aPathUsable()){
            // 放手：pk 保持 auto，让内层 A 路径用同一文件名定品 ⇒ forcedKey 带上考核品 ⇒ B 的 ④ 模块一起对齐
            LAST = fnInfo(f, '文件名优先（放手交 A 路径）：' + f.file);
            LOG('文件名优先 → 放手交 A 路径（' + f.pk + '，文件「' + f.file + '」）');
          } else {
            pk = f.pk;
            LAST = fnInfo(f, '文件名优先（A 路径不可用，门控自定）：' + f.file);
            LOG('文件名优先 → 门控自定 ' + f.cat + (f.sub !== 'unknown' ? '/' + f.sub : '') + ' ⇒ ' + f.pk + '（文件「' + f.file + '」）');
          }
        } else if(segs && segs.length){
          // 二级：话术门控（v4.11.50 原逻辑，一字未改）
          var r = pickScoped(segs);
          LAST = r;
          if(r.pk){
            pk = r.pk;
            LOG('品类门控 → ' + r.info.cat + (r.info.sub !== 'unknown' ? '/' + r.info.sub : '') + ' ⇒ ' + r.pk + '（' + r.info.reason + '）');
          } else {
            LOG('品类门控未定 → 交回原 auto（' + r.info.reason + '）');
          }
        }
      }
      return _origRun(segs, pk, options);
    };
  }

  window.V4CAT = {
    __installed: true,
    __v: '4.11.51',
    on: on,
    off: function(){ try{ localStorage.setItem(ON_KEY, '0'); }catch(e){} return 'off'; },
    enable: function(){ try{ localStorage.removeItem(ON_KEY); }catch(e){} return 'on'; },
    catOf: function(pk){ return ((GRADING_STANDARD.products || {})[pk] || {}).cat || ''; },
    subOf: function(pk){ return ((GRADING_STANDARD.products || {})[pk] || {}).sub || ''; },
    curCat: function(){ return LAST && LAST.info ? LAST.info.cat : ''; },
    last: function(){ return LAST; },
    // v4.11.51：自检入口与真实链路同序 —— 先问文件名，再问话术
    fnPick: function(segs){ return fnPick(segs); },
    pick: function(segs){
      var f = fnPick(segs);
      if(f) return (LAST = fnInfo(f, '文件名优先（自检）：' + f.file));
      return pickScoped(segs);
    },
    debug: function(segs){
      var f = fnPick(segs);
      var r = f ? fnInfo(f, '文件名优先（自检）：' + f.file) : pickScoped(segs || []);
      var out = {
        fromFilename: !!f,
        cat: r.info.cat, sub: r.info.sub, picked: r.pk || '(交回原逻辑)', reason: r.info.reason,
        score: {luggage: r.info.sL, bag: r.info.sB, backpack: r.info.subBackpack, tote: r.info.subTote},
        candidates: r.info.candidates || null,
        strong: r.info.strong || null,
        segScore: r.trace
      };
      try{ console.log('[cat-gate] 判定详情', out); }catch(e){}
      return out;
    }
  };
  LOG('品类门控已装载（开关 v4cat_enabled）');
})();
