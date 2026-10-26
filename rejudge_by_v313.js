// rejudge_by_v313.js —— 用 v3.1.3 规则对存量红线命中逐条重判
// 输入: _bak/repair_inputs.json（含 zero16 / yes / pending93 三组，每行带完整评分存档 JSON）
// 输出: _rejudge_v313.out.txt  +  _bak/rejudge_v313.json
//
// 判据（对齐 semantic-core.js / violation-scan.js 真实实现）：
//   · src='字面'  → 用 violation-scan.scan([{text:quote}]) 重扫，看新规则下该句还命中什么档
//   · src='语义' 且 cat='绝对化用语' → n1 安全阀: quote 非空 && !N1_STRICT && N1_EXEMPT  ⇒ 豁免
//   · src='语义' 且 cat='最高级用语' → n2 安全阀: !N2_STRICT && N2_EXEMPT              ⇒ 豁免
//   · 其他 cat（拉踩/保价/诱导/物流/材质…）本版未动 ⇒ 保持原判
//   ⚠️ 一条 reason 的最终档 = max(字面重扫档, 语义安全阀后档)，只降不升；
//      同句若字面仍判 SESSION_ZERO，则即便语义被豁免也不撤销（防一句带过）
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const RULES = path.join(HERE, 'v4', 'violation-rules.js');
const SCAN = path.join(HERE, 'v4', 'violation-scan.js');
const SEM = path.join(HERE, 'v4', 'semantic-core.js');

const R = require(RULES);
globalThis.V4ViolationRules = R;
const S = require(SCAN);
const SEMC = require(SEM);
const SAFE = SEMC.SAFETY;

const RANK = { '': 0, 'ANNOTATE': 1, 'MODULE_ZERO': 2, 'SESSION_ZERO': 3 };
function rank(a) { return RANK[a || ''] || 0; }
// Node 无 printf，用 padEnd 对齐（中文按 2 宽计）
function wid(s) { s = String(s == null ? '' : s); let w = 0; for (const ch of s) w += /[\u2E80-\uFFFF]/.test(ch) ? 2 : 1; return w; }
function pad(s, n) { s = String(s == null ? '' : s); return s + ' '.repeat(Math.max(0, n - wid(s))); }
function padL(s, n) { s = String(s == null ? '' : s); return ' '.repeat(Math.max(0, n - wid(s))) + s; }

// 找出某段文本命中的 EXEMPT 条目（字面通道的唯一合法撤销依据）
function whichExempt(text) {
  const out = [];
  (R.EXEMPT || []).forEach(e => {
    try {
      e.re.lastIndex = 0;
      const m = e.re.exec(text);
      if (m) out.push({ term: e.term, hit: m[0] });
    } catch (err) { }
  });
  return out;
}

// 字面重扫：返回该句在新规则下的最高 action
// ⚠️ scan() 返回的是汇总对象（sessionZero / moduleZero / annotate / hits），不是数组
function literalAction(quote) {
  let r = null;
  try { r = S.scan([{ text: quote }]); } catch (e) { r = null; }
  if (!r || !r.ok) return { action: '', hits: [], terms: ['scan失败:' + (r && r.reason || '?')] };
  let action = '';
  if (r.sessionZero) action = 'SESSION_ZERO';
  else if (r.moduleZero) action = 'MODULE_ZERO';
  else if (r.annotate) action = 'ANNOTATE';
  const hits = r.hits || [];
  const terms = hits.map(h => (h.code || '') + '/' + (h.term || '') + '/' + (h.action || ''));
  return { action, hits, terms };
}

// 语义安全阀：返回 true = 该条应被豁免
function semanticExempt(cat, quote) {
  const q = String(quote || '');
  if (cat === '绝对化用语') {
    if (!q) return false;                                  // 拿不到原文不豁免（保守）
    return !SAFE.N1_STRICT_RE.test(q) && SAFE.N1_EXEMPT_RE.test(q);
  }
  if (cat === '最高级用语') {
    return !SAFE.N2_STRICT_RE.test(q) && SAFE.N2_EXEMPT_RE.test(q);
  }
  return false;                                            // 其他类别本版未动
}

function rejudgeRow(row) {
  let o;
  try { o = JSON.parse(row.report || ''); } catch (e) { return { ok: false, why: 'report 非 JSON' }; }
  const rl = o.redline || {};
  const reasons = rl.reasons || [];
  const per = [];
  let beforeZero = 0, afterZero = 0;
  let beforeMod = 0, afterMod = 0;

  reasons.forEach((x, i) => {
    const src = x.src || '', cat = x.cat || '', quote = x.quote || '', action = x.action || '';
    const before = rank(action);
    if (action === 'SESSION_ZERO') beforeZero++;
    if (action === 'MODULE_ZERO') beforeMod++;

    // ① 字面通道
    const lit = literalAction(quote);
    let after = lit.action;

    // ② 语义通道
    let semEx = false;
    if (src === '语义') {
      semEx = semanticExempt(cat, quote);
    }

    // ③ 合并：只降不升（不引入原判之外的新判罚）
    const rb = rank(action), rl = rank(after);
    let finalRank;
    let exHits = [];
    if (src === '语义') {
      if (semEx) {
        // 语义被安全阀豁免 ⇒ 只剩字面通道残留（该句若仍含字面违规词，按字面档保留）
        finalRank = rl;
      } else {
        // 语义仍判 ⇒ 不低于原判；字面若更重则取字面
        finalRank = Math.max(rb, rl);
      }
    } else {
      // 🔴 字面命中：**不做单句重扫**。
      //   原因：原判基于整段/窗口扫描，EXEMPT 是整段级、GUARD 有上下文约束；
      //   拿单句 quote 重扫会因上下文不足而"扫不出来"，把真违规假撤销
      //   （2026-10-26 实测抓到：「你给我直边点一个关注」「完全不会爆开」「永久不再返场」
      //     单句重扫均无命中或降档，但 EXEMPT 里根本没有对应豁免 ⇒ 属引擎假撤销）。
      //   ⇒ 字面命中的唯一合法撤销依据 = EXEMPT 是否命中该句。
      exHits = whichExempt(quote);
      finalRank = exHits.length ? 0 : rb;
    }

    const finalAction = finalRank >= 3 ? 'SESSION_ZERO' : (finalRank === 2 ? 'MODULE_ZERO' : (finalRank === 1 ? 'ANNOTATE' : ''));
    if (finalAction === 'SESSION_ZERO') afterZero++;
    if (finalAction === 'MODULE_ZERO') afterMod++;

    per.push({
      i, src, cat, term: x.term || '', quote,
      before: action, after: finalAction,
      changed: before !== rank(finalAction),
      lit: lit.terms, semEx,
      exemptHits: exHits.map(e => e.term + '⇐「' + e.hit + '」')
    });
  });

  return {
    ok: true,
    host: row.host, date: row.date, v2: row.v2, total: row.total, raw: row.raw,
    redlineV: o.redlineV || '', rawTotal: o.rawTotal, rawPen: o.rawPen, rawBlk: o.rawBlk,
    sessionZeroBefore: !!rl.sessionZero,
    beforeZero, afterZero, beforeMod, afterMod,
    // 新判定：重判后是否仍应整场归零
    stillZero: afterZero > 0,
    per
  };
}

const src = JSON.parse(fs.readFileSync(path.join(HERE, '_bak', 'repair_inputs.json'), 'utf8'));
const out = { rules: R._v, sem: SEMC._v, EXEMPT: R.EXEMPT.length, GUARD: R.GUARD.length, groups: {} };
let txt = [];
function W(s) { txt.push(s); console.log(s); }

W('=== 重判引擎 ===');
W('规则库 _v=' + R._v + '  EXEMPT=' + R.EXEMPT.length + '  GUARD=' + R.GUARD.length
  + ' | semantic-core _v=' + SEMC._v);
W('');

['zero16', 'yes', 'pending93'].forEach(g => {
  const rows = (src[g] || []).map(rejudgeRow);
  const ok = rows.filter(r => r.ok);
  const bad = rows.filter(r => !r.ok);
  out.groups[g] = rows;

  const stillZeroRows = ok.filter(r => r.stillZero);
  const clearedRows = ok.filter(r => !r.stillZero && r.sessionZeroBefore);
  const wasZero = ok.filter(r => r.sessionZeroBefore);

  W('=== 组 [' + g + '] 共 ' + rows.length + ' 行，可解析 ' + ok.length
    + (bad.length ? '，不可解析 ' + bad.length : '') + ' ===');
  W('  存档原判 sessionZero : ' + wasZero.length + ' 行');
  W('  重判后仍应归零       : ' + stillZeroRows.length + ' 行');
  W('  重判后不再归零(可撤) : ' + clearedRows.length + ' 行');
  W('');
});

// ---------- zero16 明细：补分可行性 ----------
W('=== A. zero16（复核=否 + AI有痕迹 + 仍按0计）16 行逐行重判 ===');
W('  ' + pad('日期', 12) + pad('主播', 8) + pad('原命中', 8) + pad('重判后', 8) + pad('补分真值', 11) + '结论');
const a = out.groups.zero16;
a.forEach(r => {
  if (!r.ok) { W('  ' + r.date + ' ' + r.host + '  存档不可解析'); return; }
  const can = !r.stillZero;
  W('  ' + pad(r.date, 12) + pad(r.host, 8) + pad(r.beforeZero + '→S0', 8) + pad(r.afterZero + '→S0', 8)
    + pad((r.rawTotal != null ? r.rawTotal : '·'), 11)
    + (can ? '✅ 可补分 → ' + (r.rawTotal != null ? r.rawTotal : r.raw) : '⛔ 仍有该判项，不补'));
});
const aCan = a.filter(r => r.ok && !r.stillZero).length;
W('');
W('  ⇒ 可补分 ' + aCan + ' 行 / 共 ' + a.length + ' 行；不可补 ' + (a.length - aCan) + ' 行');
W('');

// ---------- zero16 不可补的 5 行：为什么还该判 ----------
W('=== A2. zero16 中「重判后仍应归零」的明细（不可补分，逐条说明）===');
a.filter(r => r.ok && r.stillZero).forEach(r => {
  W('  ● ' + r.date + ' ' + r.host + '  总分=' + r.total + ' rawTotal=' + r.rawTotal);
  r.per.forEach(p => {
    if (rank(p.after) > 0) {
      W('      ✗ [' + p.cat + '] ' + p.src + '「' + String(p.quote).slice(0, 64) + '」');
      W('        原=' + p.before + ' → 新=' + p.after + '  语义豁免=' + p.semEx + '  字面=' + (p.lit[0] || '(无)'));
    }
  });
});
W('');

// ---------- yes 明细：放水风险 ----------
W('=== B. yes（复核=是，人工确认违规）73 行 —— 检查有没有被放过 ===');
const b = out.groups.yes;
const bRisk = b.filter(r => r.ok && r.sessionZeroBefore && !r.stillZero);
W('  存档原判归零 ' + b.filter(r => r.ok && r.sessionZeroBefore).length
  + ' 行；重判后仍归零 ' + b.filter(r => r.ok && r.stillZero).length
  + ' 行；**会被放过 ' + bRisk.length + ' 行**（放水风险）');
if (bRisk.length) {
  W('');
  W('  ⚠️ 以下场次人工已确认违规，但 v3.1.3 会整场不判 0 —— 逐条列出命中被撤原因：');
  bRisk.forEach(r => {
    W('  ● ' + r.date + ' ' + r.host + '  总分=' + r.total + ' rawTotal=' + r.rawTotal);
    r.per.forEach(p => {
      if (rank(p.before) > rank(p.after)) {
        W('      ✗ [' + p.cat + '] ' + p.src + '「' + String(p.quote).slice(0, 60) + '」');
        W('        原=' + p.before + ' → 新=' + (p.after || '(无命中)') + '  语义豁免=' + p.semEx + '  字面=' + (p.lit[0] || '(无)'));
      }
    });
  });
}
W('');

// ---------- pending93 明细 ----------
W('=== C. pending93（未复核 + AI有痕迹）94 行 —— 新规则下会减少多少 ===');
const c = out.groups.pending93;
const cWas = c.filter(r => r.ok && r.sessionZeroBefore);
const cClear = cWas.filter(r => !r.stillZero);
W('  原判归零 ' + cWas.length + ' 行；重判后不再归零 ' + cClear.length + ' 行；仍判 ' + (cWas.length - cClear.length) + ' 行');
W('  按主播：');
const byHost = {};
cClear.forEach(r => { byHost[r.host] = (byHost[r.host] || 0) + 1; });
Object.keys(byHost).sort((x, y) => byHost[y] - byHost[x]).forEach(k => W('     ' + pad(k, 8) + byHost[k]));
W('');

// ---------- 全局命中归因 ----------
W('=== D. 全 374 条命中的重判归因（哪些规则真的少判了）===');
const attr = {};
let totB = 0, totA = 0;
['zero16', 'yes', 'pending93'].forEach(g => {
  (out.groups[g] || []).forEach(r => {
    if (!r.ok) return;
    r.per.forEach(p => {
      totB++;
      if (rank(p.after) < rank(p.before)) {
        totA++;
        const k = p.cat + ' | ' + p.src;
        attr[k] = attr[k] || { n: 0, semEx: 0, litDrop: 0 };
        attr[k].n++;
        if (p.semEx) attr[k].semEx++;
        if (rank(p.after) < rank(p.before) && !p.semEx) attr[k].litDrop++;
      }
    });
  });
});
W('  命中总数 ' + totB + '，重判后降档 ' + totA + ' 条');
Object.keys(attr).sort((x, y) => attr[y].n - attr[x].n).forEach(k => {
  const v = attr[k];
  W('    ' + pad(k, 26) + '降档 ' + pad(v.n, 5) + '(语义安全阀 ' + pad(v.semEx, 4) + '/ 字面豁免 ' + pad(v.litDrop, 4) + ')');
});
W('');

fs.writeFileSync(path.join(HERE, '_bak', 'rejudge_v313.json'), JSON.stringify(out, null, 1), 'utf8');
fs.writeFileSync(path.join(HERE, '_rejudge_v313.out.txt'), txt.join('\n') + '\n', 'utf8');
console.log('\n落盘: _bak/rejudge_v313.json / _rejudge_v313.out.txt');
