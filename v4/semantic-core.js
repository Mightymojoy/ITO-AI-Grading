// =====================================================
// v4.9.0 语义评分核心（纯函数，无 DOM 依赖）
// 浏览器：<script> 后挂 window.V4SEM；node 测试：require('./semantic-core.js')
// 职责（只做"判定证据 → 分数"的折算，绝不自己产生判定）：
//   ① 判定清单 V4SEM_SUB_POINTS：把 GRADING_STANDARD 的子标准拆成"考核子点"
//      （子点拆分的唯一依据 =《主播评分_语义判定Prompt稿v1.md》§5，逐卡转译、不发挥）
//   ② v4SemLevel()：子点状态集合 → 档位 level(0/0.5/1)
//   ③ v4SemApply()：云端证据包 → 覆写 runGrading 结果 r 的 level/quality/score，
//      并重算模块分/总分/等级/概览（公式与 app-core runGrading 3.1-3.3 完全同构）
// 铁律：app-core.js 一字不动；本文件 + v4-shell.js + api/semantic-judge.js 纯加法
// =====================================================
(function(root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V4SEM = factory();
})(typeof self !== 'undefined' ? self : this, function(){

  var STD = (typeof GRADING_STANDARD !== 'undefined') ? GRADING_STANDARD : null;

  // ============ ① 档位/行为配置（v1 假设稿，影子回归后可调） ============
  // fullRatio=1 表示"全部考核子点通过才满档"；halfRatio=0.5 表示"过半即半档"。
  // ⚠️ v1 换算假设：与《主播评分卡v1规则表》"档位建议值"一致，属待回归校准项，
  //    非最终业务口径——08-20 基准录屏影子回归后按数据定死。
  var CFG = {
    enabled: true,                 // 语义评分总开关（设置页可关）
    apiUrl:  'https://cloud-five-pi.vercel.app/api/semantic-judge',
    timeoutMs: 25000,              // 云端判定超时（超时 → 自动降级关键词引擎）
    maxChars: 30000,               // 送模型文本上限（超长截断，保留前段——主播前半程通常已覆盖核心卖点）
    fullRatio: 1.0,
    halfRatio: 0.5
  };

  // ============ ② 判定清单：子标准 id → 考核子点（Prompt 稿 §5 逐卡转译） ============
  // 每子点：{ id:'a', name:'子点短名', q:'判定问句' }；模型逐问句输出证据，壳层只数"通过几个子点"
  var POINTS = {
    // ---- c1 产品理解能力（计分） ----
    '1.1': { name: '产品知识掌握', points: [
      { id: 'a', name: '硬参数',   q: '是否讲出具体数值（容量/自重/尺寸/升数）？' },
      { id: 'b', name: '材质用料', q: '是否讲清材质（PC/抗菌/工艺）及为什么好（含同源类比）？' },
      { id: 'c', name: '结构部件', q: '轮/拉杆/锁/收纳分区等部件是否讲到（含功能等价说法）？' },
      { id: 'd', name: '售后权益', q: '售后两条权益（360天换新 / 5年免费维修）是否都讲到（可分散两处）？' }
    ]},
    '1.2': { name: '产品定位理解', points: [
      { id: 'a', name: '人群定位',   q: '是否说清产品给谁用（点名人群或画像式表达）？' },
      { id: 'b', name: '场景角色',   q: '是否绑定使用场景/出行方式（尺寸↔场景）？' },
      { id: 'c', name: '价值一句话', q: '是否给出一句话价值主张（收束式价值句）？' }
    ]},
    '1.3': { name: '产品差异化表达', points: [
      { id: 'a', name: '对比对象',   q: '是否有明确对比对象（代际/尺寸/系列）？' },
      { id: 'b', name: '差异维度',   q: '差异是否落到具体维度（布局/重量/价格/功能）？' },
      { id: 'c', name: '落到选择',   q: '差异后是否给"什么情况选什么"的建议？' }
    ]},
    '1.4': { name: '卖点提炼能力', points: [
      { id: 'a', name: '总结信号',     q: '是否有总结动作（自问自答/收束式总结句）？' },
      { id: 'b', name: '总结含真卖点', q: '总结落点是"卖点连价值"还是只复述参数清单？' },
      { id: 'c', name: '记忆点',       q: '是否留下可被记住的一句话（痛点钩子）？' }
    ]},
    // ---- c2 逻辑组织能力/流畅度（计分） ----
    '2.1': { name: '逻辑组织（五步）', full: 4, half: 2, points: [   // full/half 对齐现行 step minFull=4/5
      { id: 'a', name: '需求段',   q: '是否有"用户需求"步：铺垫用户场景/痛点（有实质内容，非只念步骤词）？' },
      { id: 'b', name: '定位段',   q: '是否有"产品定位"步：引出产品与型号定位（有实质介绍）？' },
      { id: 'c', name: '卖点段',   q: '是否有"核心卖点"步：卖点连价值（非只报参数）？' },
      { id: 'd', name: '价值段',   q: '是否有"使用价值"步：卖点接进真实使用流程/利益？' },
      { id: 'e', name: '建议段',   q: '是否有"购买建议"步：收束且有购买建议/CTA？' }
    ]},
    // 2.2 流畅度为"质量主导卡"（complete=always 恒 1.0），特殊折算见 v4SemQuality22 —— 无子点档位表
    // ---- c3 场景化表达能力（计分） ----
    '3.1': { name: '场景化表达', points: [
      { id: 'a', name: '场景锚点',   q: '是否有具体场景（机场/高铁/飞机/酒店/出差等）？' },
      { id: 'b', name: '功能绑场景', q: '功能与场景是否同句且解释便利（判定核心）？' },
      { id: 'c', name: '画面细节',   q: '是否有可想象的场景细节（具象延展）？' }
    ]},
    '3.2': { name: '案例延展', points: [
      { id: 'a', name: '案例标记',   q: '是否有案例引入（比如/例如/像/如果/还有的人）？' },
      { id: 'b', name: '分人群',     q: '案例是否分人群/分场景类型（非单一泛例）？' },
      { id: 'c', name: '具象细节',   q: '案例是否有具象物/细节（物品/动作）？' }
    ]},
    // ---- c4 可视化道具运用（计分） ----
    '4.1': { name: '道具演示', points: [
      { id: 'a', name: '演示信号',   q: '是否有演示信号词（"你看/展示/给大家看/我现在展示的这款"）？' },
      { id: 'b', name: '真实动作',   q: '是否有真实道具演示动作？（⚠ 口播不足以证明——无视觉通道证据一律 UNCLEAR，不得臆断 HIT）' },
      { id: 'c', name: '效果反馈',   q: '演示后是否有效果反馈（"绰绰有余/空间大概这么大"）？' }
    ]},
    // ---- c5 情绪感染能力（计分） ----
    '5.1': { name: '画面感', points: [
      { id: 'a', name: '画面构建词', q: '是否有画面构建词（想象/就像/仿佛/画面/感觉像）？' },
      { id: 'b', name: '具象画面',   q: '是否有可感的主体画面（人物+场景+动作）？' },
      { id: 'c', name: '感受收尾',   q: '是否以感受词收尾（放心/心动/满意/绰绰有余）？' }
    ]},
    '5.2': { name: '节奏与真实体验', points: [
      { id: 'a', name: '个人立场',   q: '是否有个人观点立场（我建议/我个人/我不建议）？' },
      { id: 'b', name: '真实体验',   q: '是否以亲身经历/身份讲真实顾虑（非"真的很棒"式空泛）？' }
    ]},
    // ---- c6 需求识别能力（只分析/仲裁） ----
    '6.1': { name: '用户识别', points: [
      { id: 'a', name: '点名用户',   q: '是否点名具体用户（称呼具体对象）？' },
      { id: 'b', name: '基于用户',   q: '是否基于该用户特征下判断/给建议？' }
    ]},
    '6.2': { name: '需求挖掘', points: [
      { id: 'a', name: '单点问询',   q: '是否主动问需求（几天/几人/尺寸/装什么）？' },
      { id: 'b', name: '追问成链',   q: '是否有连续 2+ 问环环相扣（问询成链路）？' }
    ]},
    '6.3': { name: '痛点判断', points: [
      { id: 'a', name: '痛点具体化', q: '是否把用户痛点说具体（痛点+场景）？' },
      { id: 'b', name: '痛点连功能', q: '痛点是否连到功能解法（所以/因此/这款就不用…）？' }
    ]},
    '6.4': { name: '推荐匹配', points: [
      { id: 'a', name: '推荐有依据', q: '推荐是否引用前序问询（回执式推荐）？' },
      { id: 'b', name: '推荐成决策', q: '是否落到决策动作（促单/明确主推）？' }
    ]},
    // ---- c7 临场反应能力（只分析/仲裁） ----
    '7.1': { name: '突发处理', points: [
      { id: 'a', name: '稳定承接', q: '观众插话/操作中断时是否稳定承接（不丢主线）？' },
      { id: 'b', name: '承诺返回', q: '是否承诺稍后处理并回到主线（有交代）？' }
    ]},
    // ---- c8 转化引导能力（只分析/仲裁） ----
    '8.1': { name: '价值塑造', points: [
      { id: 'a', name: '价值锚点', q: '是否有"值"的对比锚点（赠品价值/差价/明星同款等）？' },
      { id: 'b', name: '价值理由', q: '是否解释为什么值（材质→耐用→值的因果链）？' }
    ]},
    '8.2': { name: '成交引导', points: [
      { id: 'a', name: 'CTA具体',   q: 'CTA 是否具体（几号链接/下单/加购/申请权益）？' },
      { id: 'b', name: 'CTA带对象', q: 'CTA 是否指向当前顾客/明确对象（非无差别喊单）？' }
    ]}
  };

  // 2.2 流畅度无子点表（恒档位 1.0，质量分主导）——单独标记，供请求端仍下发给模型做负证判定
  var POINTS_22 = { id: '2.2', name: '流畅度', points: [
    { id: 'a', name: '冗余负证', q: '是否存在同句重复结构≥3次/整句复读/语气词堆积（负证，逐处列出）？' },
    { id: 'b', name: '节奏正证', q: '是否有结构标记词（首先/接下来/再来说/重点/最后）？' },
    { id: 'c', name: '停顿呼吸', q: '段落间是否有自然停顿/话题切换的完整句边界？' }
  ]};

  // 归一化：给每个子点表注入所在子标准 id（levelFromEvs / apply 的比对用 def.id + '-' + p.id）
  for(var _k in POINTS){ POINTS[_k].id = _k; }
  POINTS_22.id = '2.2';

  // ============ ③ 从 GRADING_STANDARD 生成"本次判定请求" ============
  // 只取 standard.js 真实存在的子标准（防止模型输出到不存在的 subId）
  function buildJudges(){
    var out = [];
    if(!STD || !STD.modules) return out;
    var order = ['c1','c2','c3','c4','c5','c6','c7','c8'];
    for(var i=0;i<order.length;i++){
      var mod = STD.modules[order[i]];
      if(!mod || !mod.standards) continue;
      for(var j=0;j<mod.standards.length;j++){
        var s = mod.standards[j];
        var def = POINTS[s.id];
        if(def){ out.push({ mod: mod.name, id: s.id, name: def.name, points: def.points }); }
        else if(s.id === '2.2'){ out.push({ mod: mod.name, id: '2.2', name: '流畅度', points: POINTS_22.points }); }
        // 其它（如 legacy/重复 id）不参与语义判定，保持关键词引擎
      }
    }
    return out;
  }

  // 文本截断（超长保留前段 + 结尾标记）
  function truncate(segs){
    var parts = [];
    var len = 0;
    for(var i=0;i<segs.length;i++){
      var line = (segs[i].ts ? '[' + segs[i].ts + '] ' : '') + String(segs[i].text || '');
      if(len + line.length > CFG.maxChars){
        parts.push('……（转写过长，已截断至前 ' + CFG.maxChars + ' 字，评分判定基于此片段）');
        break;
      }
      parts.push(line); len += line.length;
    }
    return parts.join('\n');
  }

  // ============ ④ 证据 → 档位 ============
  // evList：该子标准下的证据数组；返回 {level, passed, total, flags:[{point,quote,reason}]}
  function levelFromEvs(def, evList){
    var passed = 0, flags = [], states = {};
    var pts = def.points || [];
    for(var i=0;i<pts.length;i++){
      var p = pts[i];
      var ev = null;
      for(var j=0;j<(evList||[]).length;j++){
        if(evList[j].subId === def.id + '-' + p.id){ ev = evList[j]; break; }
      }
      if(!ev){ states[p.id] = 'MISS'; continue; }
      states[p.id] = ev.state;
      if(ev.state === 'HIT' || ev.state === 'EQUIV') passed++;
      else if(ev.state === 'NEGATE' && /flag_error/i.test(String(ev.reason||''))) flags.push({point:p.name, quote:ev.quote||'', reason:ev.reason||''});
      else if(ev.state === 'UNCLEAR'){ /* 存疑不计分，转人工 */ }
    }
    var total = pts.length;
    var full = (def.full != null) ? def.full : Math.ceil(total * CFG.fullRatio);
    var half = (def.half != null) ? def.half : Math.ceil(total * CFG.halfRatio);
    var level = passed >= full ? 1 : (passed >= half ? 0.5 : 0);
    return {level: level, passed: passed, total: total, full: full, half: half, flags: flags, states: states};
  }

  // 2.2 流畅度质量分（v1 规则：3 基础 + 节奏 +1 + 停顿 +1 − 冗余负证，封顶 5 底 1）
  function quality22(evList){
    var base = 3, neg = 0, pos = 0, pause = 0;
    for(var i=0;i<(evList||[]).length;i++){
      var e = evList[i];
      if(e.subId === '2.2-a' && (e.state === 'HIT' || e.state === 'EQUIV')) neg++;
      if(e.subId === '2.2-b' && (e.state === 'HIT' || e.state === 'EQUIV')) pos++;
      if(e.subId === '2.2-c' && (e.state === 'HIT' || e.state === 'EQUIV')) pause++;
    }
    var q = base + (pos > 0 ? 1 : 0) + (pause > 0 ? 1 : 0) - Math.min(neg, 2);
    return Math.max(1, Math.min(5, q));
  }

  // ============ ⑤ 覆写评分结果 r（核心折算，纯数据操作） ============
  // verdict = { evidences:[{subId,state,confidence,quoteTs,quote,reason}], meta:{...} }
  function apply(r, verdict){
    if(!r || !r.modules || !verdict || !verdict.evidences) return {applied:0, flags:[]};
    var evsAll = verdict.evidences || [];
    var applied = 0;
    var semFlags = [];          // NEGATE+flag_error → 信息准确性红旗
    var byStd = {};
    for(var i=0;i<evsAll.length;i++){
      var e = evsAll[i];
      if(!e || !e.subId) continue;
      var stdId = String(e.subId).split('-')[0]; // '1.1-a' → '1.1'（subId 格式恒为 子标准id-子点id）
      if(!byStd[stdId]) byStd[stdId] = [];
      byStd[stdId].push(e);
    }
    for(var mi=0; mi<r.modules.length; mi++){
      var m = r.modules[mi];
      if(!m || !m.standards) continue;
      for(var si=0; si<m.standards.length; si++){
        var s = m.standards[si];
        var stdId = String(s.id || '');
        var evList = byStd[stdId] || [];
        var def = POINTS[stdId];
        if(!def && stdId !== '2.2') continue;   // 无子点定义 → 维持关键词判定
        if(!evList.length) continue;            // 模型没判该卡 → 维持关键词判定
        applied++;

        if(stdId === '2.2'){
          // 质量主导卡：level 恒 1.0（always），质量按语义负证重算
          var q22 = quality22(evList);
          s.quality.score = q22;
          s.complete.level = s.complete.level === undefined ? 1 : s.complete.level;
          if(s.complete.level === 0.5 && q22 > 3) s.quality.score = 3;
          if(s.complete.level === 0) s.quality.score = 1;
          s.score = Math.round(s.complete.level * s.quality.score * 20);
          s.complete.detail = '语义判定 v4.9：流畅度质量 ' + q22 + '/5（冗余负证驱动）';
          s.complete.sem = {mode:'sem', std:'2.2', evs: evList};
          continue;
        }

        var lr = levelFromEvs(def, evList);
        // 语义红旗收集（并入 r.baseline，与现行"信息准确性红旗 -4/处 封顶 -12"同口径）
        for(var f=0; f<lr.flags.length; f++){
          var fl = lr.flags[f];
          var dup = semFlags.some(function(x){ return x.field === stdId + '-' + fl.point; });
          if(!dup) semFlags.push({ field: stdId + '-' + fl.point, point: fl.point, quote: fl.quote, reason: fl.reason });
        }
        // 覆写档位 + 证据展示结构（hits/misses 复用具名结构，渲染层零改动）
        s.complete.level = lr.level;
        s.complete.detail = '语义判定 v4.9：通过 ' + lr.passed + '/' + lr.total + ' 子点（满≥' + lr.full + '，半≥' + lr.half + '）';
        s.complete.hits = evList.filter(function(e){ return e.state === 'HIT' || e.state === 'EQUIV'; })
          .slice(0, 3).map(function(e){ return { kw: e.subId, ts: e.quoteTs || '', ctx: e.quote || '' }; });
        s.complete.misses = def.points.filter(function(p){
          var hit = evList.some(function(e){ return e.subId === def.id + '-' + p.id && (e.state === 'HIT' || e.state === 'EQUIV'); });
          return !hit;
        }).map(function(p){ return '未达标子点：' + p.name; });
        s.complete.sem = { mode:'sem', passed: lr.passed, total: lr.total, full: lr.full, half: lr.half, states: lr.states, evs: evList };
        // 质量：沿用原关键词质量因子结果；档位封顶口径与 app-core 一致
        var qs = s.quality && s.quality.score != null ? s.quality.score : 3;
        if(lr.level === 0.5 && qs > 3) qs = 3;
        if(lr.level === 0) qs = 1;
        s.quality.score = qs;
        s.score = Math.round(lr.level * qs * 20);
      }
    }
    // 语义红旗并入 baseline（信息准确性独立板块，进问题库；与关键词基线错误同口径 -4/处）
    if(semFlags.length){
      r.baseline = r.baseline || {errors:0, items:[]};
      r.baseline.errorItems = r.baseline.errorItems || [];
      r.baseline.items = r.baseline.items || [];
      for(var b=0;b<semFlags.length;b++){
        var sf = semFlags[b];
        var dupB = (r.baseline.items||[]).some(function(x){ return x.field === 'sem:' + sf.field; });
        if(dupB) continue;
        r.baseline.items.push({ field: 'sem:' + sf.field, standard: '(语义判定红旗)', wrong: [sf.field], error: true, ev: { ts:'', ctx: (sf.quote||sf.reason||'').slice(0,60) }, semFlag: true });
        r.baseline.errorItems.push({ field: 'sem:' + sf.field, wrong: [sf.field], ev: { ts:'', ctx: (sf.quote||sf.reason||'').slice(0,60) } });
        r.baseline.errors = (r.baseline.errors||0) + 1;
      }
    }
    // 重算：模块分 → 总分（含 baseline 红旗扣分）→ 等级 → 概览
    recompute(r);
    return {applied: applied, flags: semFlags.length};
  }

  // 重算派生字段（与 app-core runGrading 3.1-3.3 公式同构，纯加法不触核心）
  function recompute(r){
    if(!r || !r.modules) return;
    var moduleResults = r.modules;
    var total = 0;
    for(var i=0;i<moduleResults.length;i++){
      var m = moduleResults[i];
      var sum = 0;
      for(var j=0;j<(m.standards||[]).length;j++) sum += m.standards[j].score || 0;
      var ms = m.standards && m.standards.length ? Math.round(sum / m.standards.length) : 0;
      m.score = ms;
      m.weighted = (m.weight > 0) ? Math.round(ms * m.weight / 100 * 10) / 10 : null;
      if(m.weight > 0) total += ms * m.weight / 100;
    }
    var blErr = (r.baseline && r.baseline.errors) || 0;
    var pen = Math.min(12, blErr * 4);
    total = Math.round((total - pen) * 10) / 10;
    if(total < 0) total = 0;
    r.total = total;
    r.grade = gradeOf(total);
    // 概览（最优/最弱只从计分能力中选；与 runGrading 3.3 一致）
    var scored = moduleResults.filter(function(x){ return x.weight > 0; });
    var sorted = scored.slice().sort(function(a,b){ return b.score - a.score; });
    var best = sorted[0], worst = sorted[sorted.length - 1];
    var bestStd = null, worstStd = null;
    for(var a=0;a<moduleResults.length;a++) for(var b2=0;b2<(moduleResults[a].standards||[]).length;b2++){
      var s1 = moduleResults[a].standards[b2];
      if(!bestStd || s1.score > bestStd.score) bestStd = s1;
      if(!worstStd || s1.score < worstStd.score) worstStd = s1;
    }
    var strength = '', problem = '';
    if(bestStd && bestStd.score >= 80) strength = bestStd.name + ' ' + bestStd.score + '分（' + ((bestStd.complete && bestStd.complete.hits && bestStd.complete.hits[0]) ? bestStd.complete.hits[0].ctx : '') + '）';
    else if(best) strength = best.name + ' ' + best.score + '分';
    problem = worstStd ? worstStd.name + ' ' + worstStd.score + '分' : '—';
    var tagline = '';
    if(best && best.score >= 75 && worst && worst.score <= 30) tagline = '「会讲产品，但还没形成完整成交闭环」——' + best.name + ' 明显强于 ' + worst.name;
    else if(worst && worst.score <= 30) tagline = '「' + worst.name + '是最大短板」——需优先补齐再谈整体提升';
    else if(total >= 80) tagline = '「整体表现优秀，保持并精细化」';
    else tagline = '「整体处于' + r.grade + '级，需按改进建议逐项训练」';
    r.overview = r.overview || {};
    r.overview.strength = strength;
    r.overview.problem = problem;
    r.overview.best = (best ? best.name + ' ' + best.score + '分' : r.overview.best || '—');
    r.overview.worst = (worst ? worst.name + ' ' + worst.score + '分' : r.overview.worst || '—');
    r.overview.tagline = tagline;
    r.training = buildTraining(moduleResults, sorted);
    r.cases = buildCases(r);
  }

  function gradeOf(total){
    if(!STD || !STD.grades) return total >= 90 ? 'A' : (total >= 80 ? 'B' : (total >= 70 ? 'C' : (total >= 60 ? 'D' : 'E')));
    var g = 'E';
    for(var i=0;i<STD.grades.length;i++){ if(total >= STD.grades[i].min){ g = STD.grades[i].name; break; } }
    return g;
  }

  // 改善建议（低分 3 个计分能力；逻辑同 runGrading 3.3）
  function buildTraining(moduleResults, sorted){
    var train = [];
    var lows = (sorted || []).slice().sort(function(a,b){ return a.score - b.score; });
    for(var i=0;i<Math.min(3, lows.length);i++){
      var m = lows[i];
      if(m.score >= 80) continue;
      var probs = [];
      for(var j=0;j<(m.standards||[]).length;j++){
        var ss = m.standards[j];
        if(ss.score <= 40){
          var miss = ((ss.complete && ss.complete.misses) || []).slice(0,3).join('、');
          probs.push(ss.name + (miss ? '（' + miss + '）' : ''));
        }
      }
      var target = m.score < 45 ? 60 : 70;
      train.push({
        mod: m.name, score: m.score, key: m.key,
        gap: probs.join('；') || ('整体表现低于合格线（' + m.score + ' 分）'),
        action: (STD && STD.training && STD.training[m.key]) || '',
        verify: '下次评分该能力 ≥ ' + target + ' 分'
      });
    }
    return train;
  }

  // 案例 TOP3（优秀取高分子标准的语义证据原文——比关键词 extractFullQuote 更贴切；不足取低分卡）
  function buildCases(r){
    var good = [], bad = [];
    for(var i=0;i<r.modules.length;i++){
      var m = r.modules[i];
      for(var j=0;j<(m.standards||[]).length;j++){
        var s = m.standards[j];
        var hit0 = (s.complete && s.complete.hits && s.complete.hits[0]) || {};
        var evTxt = hit0.ctx || '';
        var ts = hit0.ts || '';
        if(s.score >= 90 && evTxt && good.length < 3){
          good.push({ std: s.id + ' ' + s.name, ev: evTxt, ts: ts, mod: m.name, full: true });
        }
        if(s.score <= 20 && bad.length < 3){
          bad.push({ std: s.id + ' ' + s.name, miss: ((s.complete && s.complete.misses)||[]).slice(0,2).join('、'), ev: evTxt, mod: m.name });
        }
      }
    }
    return { good: good.slice(0,3), bad: bad.slice(0,3) };
  }

  // ============ 对外 API ============
  return {
    CFG: CFG,
    POINTS: POINTS,
    POINTS_22: POINTS_22,
    buildJudges: buildJudges,
    truncate: truncate,
    levelFromEvs: levelFromEvs,
    quality22: quality22,
    apply: apply,
    recompute: recompute,
    _v: '4.9.2'
  };
});
