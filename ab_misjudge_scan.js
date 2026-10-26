/* ============================================================
 * ab_misjudge_scan.js —— 字面通道 双向 A/B 验证（v3.1.1 → v3.1.2）
 *
 * 目的：飞书人工复核的误判样本，改规则后必须两头都对
 *   ① neg.json（初审=否 = 应不判）：改后命中数应显著下降
 *   ② pos.json（初审=是 = 应仍判）：改后命中数不能掉（掉了就是放水）
 *
 * 铁律执行：
 *   · 每变体 delete require.cache(SCAN) + **显式**赋值 globalThis.V4ViolationRules（防串味）
 *   · identity 自检：同一规则库独立装载两次，逐条结果必须完全一致（不一致=脚本坏了，结论不可信）
 *   · 不用 JSON 深拷贝（RegExp 会变 {}）；本脚本直接 require 两个不同文件，天然独立
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

const HERE = __dirname;
const SCAN_PATH = path.join(HERE, 'v4', 'violation-scan.js');
const OLD = path.join(HERE, '_bak', 'misjudge-fix-20261026', 'violation-rules.js.before');
const NEW = path.join(HERE, 'v4', 'violation-rules.js');
const NEG = path.join(HERE, '_bak', 'misjudge-fix-20261026', 'neg.json');
const POS = path.join(HERE, '_bak', 'misjudge-fix-20261026', 'pos.json');

function loadScan(rulesPath) {
  delete require.cache[require.resolve(SCAN_PATH)];
  delete require.cache[require.resolve(rulesPath)];
  const R = require(rulesPath);
  globalThis.V4ViolationRules = R;          // 必须显式赋值，不能靠副作用
  const S = require(SCAN_PATH);
  if (!(R.EXEMPT && R.EXEMPT.every(e => e.re instanceof RegExp))) {
    throw new Error('规则库 EXEMPT 的 re 不是活 RegExp：' + rulesPath);
  }
  if (S.getRules() !== R) throw new Error('串味：扫描器拿到的不是本次规则库');
  return { R, S };
}

function scanAll(S, segs) {
  return segs.map(it => {
    const res = S.scan([{ text: it.text }]) || {};
    const hits = res.hits || [];
    return {
      text: it.text, meta: it,
      codes: hits.map(h => h.code + '|' + h.term + '|' + h.action),
      actions: hits.map(h => h.action),
      n: hits.length
    };
  });
}

function main() {
  const neg = JSON.parse(fs.readFileSync(NEG, 'utf8'));
  const pos = JSON.parse(fs.readFileSync(POS, 'utf8'));
  console.log('语料：应不判 %d 条 / 应仍判 %d 条', neg.length, pos.length);

  // ---------- identity 自检 ----------
  const A1 = loadScan(OLD); const r1 = scanAll(A1.S, neg);
  const A2 = loadScan(OLD); const r2 = scanAll(A2.S, neg);
  let idOk = r1.length === r2.length;
  for (let i = 0; idOk && i < r1.length; i++) {
    if (r1[i].codes.join(',') !== r2[i].codes.join(',')) idOk = false;
  }
  console.log('identity 自检（旧库装载两次逐条一致）：%s', idOk ? '✅ PASS' : '❌ FAIL —— 结论不可信');
  if (!idOk) process.exit(3);

  // ---------- 双变体 ----------
  const B = loadScan(OLD);
  const bNeg = scanAll(B.S, neg); const bPos = scanAll(B.S, pos);
  const C = loadScan(NEW);
  const cNeg = scanAll(C.S, neg); const cPos = scanAll(C.S, pos);

  console.log('\n规则库：旧 v%s (EXEMPT %d) → 新 v%s (EXEMPT %d)',
    B.R._v, B.R.EXEMPT.length, C.R._v, C.R.EXEMPT.length);

  const cnt = (arr) => ({
    flagged: arr.filter(x => x.n > 0).length,
    total: arr.length,
    zero: arr.filter(x => x.actions.indexOf('SESSION_ZERO') >= 0).length,
    annot: arr.filter(x => x.actions.indexOf('ANNOTATE') >= 0).length
  });
  const bn = cnt(bNeg), cn = cnt(cNeg), bp = cnt(bPos), cp = cnt(cPos);

  console.log('\n=== ① 应不判集（初审=否，%d 条）===', neg.length);
  console.log('   旧：命中 %d 条（归0 %d / 标注 %d）', bn.flagged, bn.zero, bn.annot);
  console.log('   新：命中 %d 条（归0 %d / 标注 %d）', cn.flagged, cn.zero, cn.annot);
  console.log('   ⇒ 退出命中 %d 条，仍误判 %d 条', bn.flagged - cn.flagged, cn.flagged);

  console.log('\n=== ② 应仍判集（初审=是，%d 条）===', pos.length);
  console.log('   旧：命中 %d 条（归0 %d / 标注 %d）', bp.flagged, bp.zero, bp.annot);
  console.log('   新：命中 %d 条（归0 %d / 标注 %d）', cp.flagged, cp.zero, cp.annot);
  console.log('   ⇒ 掉了 %d 条（>0 需逐条核，可能是真放水）', bp.flagged - cp.flagged);

  // ---------- neg 仍误判明细 ----------
  console.log('\n=== neg 仍被命中的（改后）===');
  const stillBad = cNeg.filter(x => x.n > 0);
  if (!stillBad.length) console.log('   （无）');
  stillBad.forEach(x => {
    console.log('   · [%s] %s | %s', x.meta.code || '?', x.meta.term || x.meta.name, x.text.slice(0, 60));
    console.log('       命中 → %s', x.codes.join(' , '));
  });

  // ---------- neg 已退出明细（按词条聚合）----------
  const fixedBy = {};
  bNeg.forEach((x, i) => {
    if (x.n > 0 && cNeg[i].n === 0) {
      const k = (x.meta.code || '') + ' ' + (x.meta.term || x.meta.name || '');
      (fixedBy[k] = fixedBy[k] || []).push(x.text);
    }
  });
  console.log('\n=== neg 已退出命中（按词条）===');
  Object.keys(fixedBy).sort().forEach(k => {
    console.log('   ✓ ' + k.padEnd(30) + ' ' + fixedBy[k].length + ' 条');
    fixedBy[k].slice(0, 2).forEach(t => console.log('       「%s」', t.slice(0, 56)));
  });

  // ---------- pos 掉榜明细（重点：是否放水）----------
  console.log('\n=== ② pos 改后不再命中（放水风险，逐条核）===');
  const lost = [];
  bPos.forEach((x, i) => { if (x.n > 0 && cPos[i].n === 0) lost.push(x); });
  if (!lost.length) console.log('   （无：真违规一条都没放过 ✅）');
  lost.forEach(x => console.log('   ⚠ [%s] %s | %s', x.meta.code || '?', x.meta.term || x.meta.name, x.text.slice(0, 64)));

  return (cn.flagged === 0 && lost.length === 0) ? 0 : 1;
}

process.exit(main());
