/* ============================================================
 * ab_dianzan.js —— `点赞` 口径收窄 双向 A/B（v3.1.2 → v3.1.3）
 *
 * 老大 10-26 拍板：「顾客都在点赞」这类与 09-24 口径A 冲突 → 按误判处理。
 * 验证必须两头都对：
 *   ① NEG（应不判）：客观描述观众行为 —— 改后必须不再 SESSION_ZERO
 *   ② POS（应仍判）：指令式诱导           —— 改后必须仍然 SESSION_ZERO
 *
 * 🔴 铁律（本脚本 v2 修正，v1 踩过）：
 *   扫描器内部 `getRules()` 读的是 `globalThis.V4ViolationRules`，
 *   所以**必须先装载旧库→跑完→存结果→再装载新库**。若先装两库再跑，
 *   旧库那一轮实际用的是新库（串味），会得出「改前改后一模一样」的假结论。
 *   另：console.log 不支持 `%-5s` 这种 printf 填充，一律用模板串。
 * ============================================================ */
'use strict';
const path = require('path');

const HERE = __dirname;
const SCAN_PATH = path.join(HERE, 'v4', 'violation-scan.js');
const OLD = path.join(HERE, '_bak', 'dianzan-fix-20261026', 'violation-rules.js.before');
const NEW = path.join(HERE, 'v4', 'violation-rules.js');

// ---- ① 应不判：客观描述观众/顾客已经发生的「点赞」行为 ----
const NEG = [
  { text: '基本上咱们直播间的很多顾客都在点赞这两个颜色。', note: '10-13 全程（真实误判样本，原件）' },
  { text: '大家都在点赞这个颜色', note: '同句式' },
  { text: '你看评论区很多粉丝都在点赞这一款', note: '同句式' },
  { text: '观众都在点赞雾灰配色', note: '命中第 2 分支' },
  { text: '这个颜色很多顾客在点赞', note: '主语后置' },
];

// ---- ② 应仍判：指令式诱导（含字面「点赞」，属真违规） ----
const POS = [
  { text: '大家点赞关注一下直播间', note: '点赞关注' },
  { text: '双击点赞屏幕', note: '双击点赞' },
  { text: '帮我点赞，点赞到一千就改价', note: '帮我点赞 + 点赞到N才改价' },
  { text: '记得点赞收藏这个视频', note: '点赞收藏' },
  { text: '来点赞，点点赞支持一下主播', note: '来点赞' },
];

function loadScan(rulesPath) {
  delete require.cache[require.resolve(SCAN_PATH)];
  delete require.cache[require.resolve(rulesPath)];
  const R = require(rulesPath);
  globalThis.V4ViolationRules = R;            // 显式赋值，不靠副作用
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
      text: it.text,
      terms: hits.map(h => h.term),
      zero: hits.some(h => h.action === 'SESSION_ZERO'),
      codes: hits.map(h => h.code + '|' + h.term + '|' + h.action),
    };
  });
}

/** 一轮完整装载 + 扫描，结果立刻固化，供下一次装载不受影响 */
function runRound(rulesPath) {
  const { R, S } = loadScan(rulesPath);
  const meta = { ver: R._v, exempt: R.EXEMPT.length, guard: (R.GUARD || []).length };
  return { meta, neg: scanAll(S, NEG), pos: scanAll(S, POS) };
}

function main() {
  // ---------- identity 自检（同库独立装载两次，逐条必须一致）----------
  const a1 = runRound(OLD), a2 = runRound(OLD);
  let idOk = true;
  for (let i = 0; i < NEG.length; i++) if (a1.neg[i].codes.join(',') !== a2.neg[i].codes.join(',')) idOk = false;
  for (let i = 0; i < POS.length; i++) if (a1.pos[i].codes.join(',') !== a2.pos[i].codes.join(',')) idOk = false;
  console.log('identity 自检: ' + (idOk ? 'PASS（同库两次独立装载结果一致）' : 'FAIL ← 结论不可信'));
  if (!idOk) process.exit(2);

  // 🔴 顺序：旧库先跑完并固化，再装新库
  const B = runRound(OLD);
  const A = runRound(NEW);

  console.log(`规则库: ${B.meta.ver} → ${A.meta.ver}`);
  console.log(`EXEMPT 条数: ${B.meta.exempt} → ${A.meta.exempt}   GUARD 条数: ${B.meta.guard} → ${A.meta.guard}\n`);

  console.log(`=== ① 应不判（${NEG.length} 条）：改后必须不再 SESSION_ZERO ===`);
  let negBad = 0;
  NEG.forEach((it, i) => {
    const b = B.neg[i], a = A.neg[i];
    const ok = !a.zero;
    if (!ok) negBad++;
    console.log(`  ${ok ? '✓' : '✗ 未修好'}  改前归零=${String(b.zero).padEnd(5)} 改后归零=${String(a.zero).padEnd(5)} 剩余命中=${a.terms.join('/') || '(无)'}`);
    console.log(`       「${it.text.slice(0, 46)}」  ${it.note}`);
  });

  console.log(`\n=== ② 应仍判（${POS.length} 条）：改后必须仍 SESSION_ZERO ===`);
  let posBad = 0;
  POS.forEach((it, i) => {
    const b = B.pos[i], a = A.pos[i];
    const ok = a.zero;
    if (!ok) posBad++;
    console.log(`  ${ok ? '✓' : '✗ 放水'}  改前归零=${String(b.zero).padEnd(5)} 改后归零=${String(a.zero).padEnd(5)} 命中=${a.terms.join('/') || '(无)'}`);
    console.log(`       「${it.text.slice(0, 46)}」  ${it.note}`);
  });

  const bn = B.neg.filter(x => x.zero).length, an = A.neg.filter(x => x.zero).length;
  const bp = B.pos.filter(x => x.zero).length, ap = A.pos.filter(x => x.zero).length;
  console.log('\n=== 汇总 ===');
  console.log(`  应不判 NEG 归零: 改前 ${bn}/${NEG.length} → 改后 ${an}/${NEG.length}   (未修好 ${negBad} 条)`);
  console.log(`  应仍判 POS 归零: 改前 ${bp}/${POS.length} → 改后 ${ap}/${POS.length}   (被放过 ${posBad} 条)`);
  const pass = negBad === 0 && posBad === 0 && an === 0 && ap === POS.length;
  console.log(pass ? '\n结论: PASS —— 两头都对' : '\n结论: FAIL');
  return pass ? 0 : 1;
}

process.exit(main());
