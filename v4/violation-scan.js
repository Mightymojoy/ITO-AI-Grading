/* ============================================================
 * v4/violation-scan.js —— 平台红线确定性扫描器（v1.0.1）
 *
 * 定位：与「语义判定」并列的**第二通道**。语义判定判「讲得好不好」，
 *       本扫描器判「有没有踩平台红线」——命中即按规则库的处置等级执行。
 *
 * 为什么用确定性扫描而不是交给大模型：
 *   ① 老大的口径是「**提到**就判 0 分」= 字面命中，本就不需要语义推理
 *   ② 避免 DeepSeek 非确定性（实测同一文本两次运行结果可能不同，temperature=0 也不保证）
 *   ③ 零 token 成本、可离线、可复跑、结果可逐条回溯
 *
 * ⚠️ 已知边界（如实标注，不掩盖）：
 *   · 字面扫描**抓不到**"意思违规但用词自由"的表达（实测业务侧错误话术召回仅 4%，
 *     已有 C 违规词组也只命中 2/5：C2/C3 拉踩、C4 保价全漏）⇒ 必须与语义通道并用。
 *   · Sheet1 第 6/7/8 类（政治敏感／拉踩／侮辱用户）**表中原文本就没有字面词**，
 *     本扫描器对其返回 `semanticOnly`，由语义通道负责，不硬编码词表。
 *
 * 两层安全阀：
 *   1) EXEMPT（整场级、逐词）—— 词条落在"业务事实陈述"语境即整词豁免
 *   2) GUARD （紧邻窗口、逐命中，v1.0.2）—— 词根级条目须在命中点**紧邻** L/R 字内出现完整短语
 *      依据：真实 4h 逐字稿上 8 个词根条目 112 次命中、真阳性 0（详见规则库注释）
 *      口径：业务侧 2026-09-17 二次拍板「"行业第一"必须 4 字都说了才判违规；
 *            只说"第一"、或只说"行业"，均不归纳到违规中」
 *
 * 一键回退：localStorage 置 `redline_strict='1'` → 忽略 GUARD，恢复纯字面口径。
 * ============================================================ */
(function(root){
  'use strict';

  var _v = '1.0.2';

  function getRules(){
    if(root && root.V4ViolationRules) return root.V4ViolationRules;
    if(typeof require === 'function'){
      try{ return require('./violation-rules.js'); }catch(e){}
      try{ return require(require('path').join(__dirname,'violation-rules.js')); }catch(e){}
    }
    return null;
  }

  /* 严格模式：忽略语境约束，回到"纯字面命中即违规"（v1.0.0 口径）——回退开关 */
  function strictMode(){
    try{
      if(root && root.localStorage && root.localStorage.getItem('redline_strict') === '1') return true;
    }catch(e){}
    return false;
  }

  var _guardCache = {};
  function guardOf(term, R){
    if(Object.prototype.hasOwnProperty.call(_guardCache, term)) return _guardCache[term];
    var list = (R && R.GUARD) || [];
    var g = null;
    for(var i=0;i<list.length;i++){ if(list[i].term === term){ g = list[i]; break; } }
    _guardCache[term] = (g && g.re instanceof RegExp) ? g : null;
    return _guardCache[term];
  }

  /* 语境判定（v1.0.2：紧邻窗口）
     在命中点**紧邻**的 L/R 字切片上 test 宣传/诱导语境正则。
       · L/R 默认取 R.GUARD_L / R.GUARD_R（各 6 字），逐条可用 GUARD[i].L / .R 覆盖
       · "行业第一" ⇒ 命中「第一」时左 4 字内须紧邻"行业"等名词 ⇒ 4 字连写才判
       · "第一个/第一点" ⇒ 左邻不是宣传名词 ⇒ 窗口里凑不出"XX第一" ⇒ 不判
     返回 true = 该命中有效（计入违规）；false = 被语境约束挡掉 */
  function guardOk(term, hay, idx, len, R, stat){
    var g = guardOf(term, R);
    if(!g) return true;
    var L  = (g.L  == null) ? ((R && R.GUARD_L) || 6) : g.L;
    var Rt = (g.R  == null) ? ((R && R.GUARD_R) || 6) : g.R;
    var s = Math.max(0, idx - L), e = Math.min(hay.length, idx + len + Rt);
    var win = hay.slice(s, e);
    var ok;
    try{ g.re.lastIndex = 0; ok = g.re.test(win); }
    catch(err){ ok = false; }        // 正则异常 → 按"不确定"处理，宁漏扣不错扣
    if(!ok && stat){
      stat.guardBlocked++;
      if(stat.blockedSamples.length < 12) stat.blockedSamples.push(term + ' :: …' + win + '…');
    }
    return ok;
  }

  function norm(s){ return String(s == null ? '' : s).replace(/\s+/g, ''); }

  function escapeRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // 词条 → 宽松正则：「XX」为规则库里的占位符（如「原价XX现在XX」），用 .{0,8} 通配
  function buildRe(term){
    var t = norm(term);
    if(t.indexOf('XX') >= 0) return new RegExp(escapeRe(t).replace(/XX/g, '.{0,8}'), 'g');
    return new RegExp(escapeRe(t), 'g');
  }

  // 安全阀：该词条命中处是否落在"业务事实陈述"语境里 → 豁免
  function exempted(term, hayTerm, R){
    var list = (R && R.EXEMPT) || [];
    for(var i=0;i<list.length;i++){
      var e = list[i];
      if(e.term !== term) continue;
      try{ if(e.re.test(hayTerm)) return true; }catch(err){}
    }
    return false;
  }

  // 上下文窗口（在**归一化前的原文**里取，保证引文可读）
  function window_(raw, m, radius){
    var r = radius || 24;
    var s = Math.max(0, m.index - r), e = Math.min(raw.length, m.index + m[0].length + r);
    return (s > 0 ? '…' : '') + raw.slice(s, e) + (e < raw.length ? '…' : '');
  }

  /* 扫描一段纯文本。返回命中原子的数组（未去重）。
     stat（可选）：累积 guardBlocked / blockedSamples，供可观测性上报 */
  function scanText(raw, R, stat){
    var hay = norm(raw);
    if(!hay) return [];
    var out = [];
    var strict = strictMode();

    // ---- Sheet1 八类（ITO 自有红线）----
    for(var i=0;i<R.S1.length;i++){
      var cat = R.S1[i];
      for(var j=0;j<cat.terms.length;j++){
        var t = cat.terms[j];
        var re = buildRe(t);
        var m;
        re.lastIndex = 0;
        while((m = re.exec(hay)) !== null){
          if(exempted(t, hay, R)) break;                  // 落在豁免语境 → 该词整体不算
          if(!strict && !guardOk(t, hay, m.index, m[0].length, R, stat)){
            if(m.index === re.lastIndex) re.lastIndex++;   // 防零宽死循环
            continue;
          }
          out.push({ src:'S1', group:cat.cat, catId:cat.id, term:t, action:cat.action,
                     quote: window_(raw, m), at:m.index });
          if(m.index === re.lastIndex) re.lastIndex++;
        }
      }
    }

    // ---- Sheet2 170 条 ----
    for(var k=0;k<R.S2.length;k++){
      var it = R.S2[k];
      if(exempted(it.term, hay, R)) continue;
      var re2 = buildRe(it.term);
      var m2;
      re2.lastIndex = 0;
      while((m2 = re2.exec(hay)) !== null){
        if(!strict && !guardOk(it.term, hay, m2.index, m2[0].length, R, stat)){
          if(m2.index === re2.lastIndex) re2.lastIndex++;
          continue;
        }
        out.push({ src:'S2', group:it.cat, catId:'s2-r'+it.row, term:it.term, level:it.level,
                   action:it.action, mod:it.mod, point:it.point,
                   quote: window_(raw, m2), at:m2.index });
        if(m2.index === re2.lastIndex) re2.lastIndex++;
      }
    }
    return out;
  }

  /* 主入口：segs = [{ts,text}] 或 纯字符串 */
  function scan(segs){
    var R = getRules();
    if(!R) return { ok:false, reason:'规则库 V4ViolationRules 未加载' };
    var stat = { guardBlocked: 0, blockedSamples: [] };
    var list = [];
    if(typeof segs === 'string'){
      list = scanText(segs, R, stat);
    }else{
      var arr = segs || [];
      for(var i=0;i<arr.length;i++){
        var s = arr[i] || {};
        var found = scanText(String(s.text == null ? '' : s.text), R, stat);
        for(var j=0;j<found.length;j++){
          found[j].ts = s.ts || '';
          // 分段扫描时引文就是该段原文（比窗口更可读），同时保留窗口版
          found[j].quote = String(s.text || '').slice(0, 120);
          list.push(found[j]);
        }
      }
    }
    var res = summarize(list, R, stat);
    res.stat.guardBlocked = stat.guardBlocked;
    res.stat.blockedSamples = stat.blockedSamples;
    res.strict = strictMode();
    return res;
  }

  /* 汇总：按 (类别, 词条, 处置) 去重计数，产出处置决定 */
  function summarize(atoms, R){
    var byKey = {}, uniq = [];
    for(var i=0;i<atoms.length;i++){
      var a = atoms[i];
      var key = a.action + '|' + a.group + '|' + a.term;
      if(byKey[key]){
        byKey[key].count++;
        if(!byKey[key].ts && a.ts) byKey[key].ts = a.ts;
        continue;
      }
      a.count = 1;
      byKey[key] = a;
      uniq.push(a);
    }
    var session = uniq.filter(function(x){ return x.action === 'SESSION_ZERO'; });
    var moduleZero = uniq.filter(function(x){ return x.action === 'MODULE_ZERO'; });
    var mods = [];
    for(var m=0;m<moduleZero.length;m++){
      if(moduleZero[m].mod && mods.indexOf(moduleZero[m].mod) < 0) mods.push(moduleZero[m].mod);
    }
    // Sheet1 中"表中无字面词"的类别 → 必须交语义通道
    var semOnly = [];
    for(var s=0;s<R.S1.length;s++){ if(R.S1[s].semantic) semOnly.push(R.S1[s].cat); }
    return {
      _v: _v,
      ok: true,
      sessionZero: session.length > 0,
      sessionHits: session,
      moduleZero: mods.length > 0,
      modules: mods,
      moduleHits: moduleZero,
      hits: uniq,
      semanticOnly: semOnly,
      stat: {
        atoms: atoms.length,
        uniqHits: uniq.length,
        sessionGroups: session.length,
        moduleGroups: moduleZero.length,
        modules: mods.length
      }
    };
  }

  var API = { _v: _v, scan: scan, scanText: scanText, summarize: summarize, norm: norm,
              buildRe: buildRe, getRules: getRules, guardOf: guardOf, guardOk: guardOk,
              strictMode: strictMode };
  root.V4ViolationScan = API;
  if(typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
