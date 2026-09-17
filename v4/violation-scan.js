/* ============================================================
 * v4/violation-scan.js —— 平台红线确定性扫描器（v1.0.0）
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
 * 安全阀：只对**有实测误伤证据、且属业务事实陈述**的词豁免（见 violation-rules.js EXEMPT）。
 *   原则：宁可漏扣一条，不可错扣业务侧认可的话术。
 * ============================================================ */
(function(root){
  'use strict';

  var _v = '1.0.0';

  function getRules(){
    if(root && root.V4ViolationRules) return root.V4ViolationRules;
    if(typeof require === 'function'){
      try{ return require('./violation-rules.js'); }catch(e){}
      try{ return require(require('path').join(__dirname,'violation-rules.js')); }catch(e){}
    }
    return null;
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

  /* 扫描一段纯文本。返回命中原子的数组（未去重）。 */
  function scanText(raw, R){
    var hay = norm(raw);
    if(!hay) return [];
    var out = [];

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
    var list = [];
    if(typeof segs === 'string'){
      list = scanText(segs, R);
    }else{
      var arr = segs || [];
      for(var i=0;i<arr.length;i++){
        var s = arr[i] || {};
        var found = scanText(String(s.text == null ? '' : s.text), R);
        for(var j=0;j<found.length;j++){
          found[j].ts = s.ts || '';
          // 分段扫描时引文就是该段原文（比窗口更可读），同时保留窗口版
          found[j].quote = String(s.text || '').slice(0, 120);
          list.push(found[j]);
        }
      }
    }
    return summarize(list, R);
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

  var API = { _v: _v, scan: scan, scanText: scanText, summarize: summarize, norm: norm, buildRe: buildRe, getRules: getRules };
  root.V4ViolationScan = API;
  if(typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
