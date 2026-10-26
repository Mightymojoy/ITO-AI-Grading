/* ============================================================
 * verify_semantic_safety.js —— n1/n2 代码侧安全阀离线单测（不调 LLM）
 *
 * 背景：n1「绝对化用语」命中即整场归 0。飞书人工复核 43 场误判里 n1 独占 16 场，
 *       原文全是"一定不会差/完全没问题/不用担心勾丝起球"这类质量信心口语。
 * 本脚本验证：①16 条 n1 误判引文全部被安全阀捕获（应撤）；②真正的功效绝对化承诺不被误撤（负对照）
 *             ③n2 的"卖的最好/明星用的最多/天花板容量"被捕获；④STRICT 项优先于 EXEMPT
 * 另附：⑤「母婴级」在真实整段语境（同段含 7A/抑菌）下能否豁免（EXEMPT 是整段级，单句测试会低估）
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

const HERE = __dirname;
const SC = require(path.join(HERE, 'v4', 'semantic-core.js'));
const S = SC.SAFETY;
const SCAN_PATH = path.join(HERE, 'v4', 'violation-scan.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   → ' + extra : '')); }
}

// ---- ① n1：16 条人工复核误判引文（初审=否）→ 安全阀必须捕获 ----
const N1_MISJUDGE = [
  ['10-22 曹佳', '你是不用担心这个箱子用久了摔坏磕坏砸坏的表量'],
  ['10-21 曲姝锜', '这个单品你背个几年完全没问题'],
  ['10-20 程方', '就你发现你现在用的一定不会差吧'],
  ['10-20 王菲', '所以你完全不用担心受到问题，'],
  ['10-19 王金鸽', '不用担心面料材质会有勾丝磨损起球情况的'],
  ['10-19 杨光来', '用我用让我们用个5年8年十年起验是完全没有问题的'],
  ['10-18 王菲', '明天这个满1500米减180的券，一定一定没有一定一定没有'],
  ['10-18 王金鸽', '连续的摩擦5年半，不用担心面料会勾丝磨损起球啊'],
  ['10-18 苏蓬', '但是我们的行李箱是完全不会的，整个行李箱韧性很足'],
  ['10-17 王金鸽', '一定是让大家好看好背好用'],
  ['10-17 杨光来', '不然180的身高十2升是一定会小的啊'],
  ['10-17 赵亚男', '就是你看托运的话很难超重的一只行李箱'],
  ['10-17 程都兰', '你一定是买到29寸。'],
  ['10-12 王金鸽', '连续的摩擦5年半面料材质都不会有勾丝磨损起球的情况'],
  ['10-12 杨光来', '软钢板暴力托运，暴力运输也是完全OK的。'],
  ['10-12 王菲', '它是完全没有什么问题的。所以你完全不用担心我们的一个售后问题哈，'],
];

console.log('=== ① n1 安全阀：16 条人工复核误判引文应被撤销 ===');
N1_MISJUDGE.forEach(([who, q]) => {
  const ex = S.N1_EXEMPT_RE.test(q);
  const st = S.N1_STRICT_RE.test(q);
  ok(ex && !st, who + ' 「' + q.slice(0, 26) + '」', 'exempt=' + ex + ' strict=' + st);
});

// ---- ② 负对照：真正的功效绝对化承诺，不得被撤销 ----
const N1_MUST_KEEP = [
  '这个箱子绝对是摔不坏的，你放心',
  '我们保证用不坏，坏了给你换新的',
  '这个材质永远不会坏，十年都不变形',
  '放心，绝对摔不坏，不用担心',
];
console.log('\n=== ② 负对照：真·功效绝对化承诺不得被撤销 ===');
N1_MUST_KEEP.forEach(q => {
  const wouldExempt = S.N1_EXEMPT_RE.test(q) && !S.N1_STRICT_RE.test(q);
  ok(!wouldExempt, '「' + q.slice(0, 24) + '」应保持判罚', '被误撤了！strict=' + S.N1_STRICT_RE.test(q));
});

// ---- ③ n2：应豁免 ----
const N2_MUST_EXEMPT = [
  '这个是卖的最好的',
  '卖的最好的颜色就是一号链接',
  '明星用的最多的一个颜色和款',
  '卖得最好，明星自用最多',
  '天花板容量42升容量在的',
  '不够上飞机尺寸行李箱当中的天花板的容量了',
];
console.log('\n=== ③ n2 安全阀：业务侧认可的事实陈述应被撤销 ===');
N2_MUST_EXEMPT.forEach(q => {
  ok(S.N2_EXEMPT_RE.test(q) && !S.N2_STRICT_RE.test(q), '「' + q.slice(0, 28) + '」');
});

// ---- ④ n2 负对照：无依据绝对优势断言，不得撤销 ----
const N2_MUST_KEEP = [
  '我们是行业第一的品牌',
  '全网最低价就在我们直播间',
  '没人比我们做得更好',
  '市面上最好的箱子就是这款',
];
console.log('\n=== ④ n2 负对照：无依据绝对优势断言不得被撤销 ===');
N2_MUST_KEEP.forEach(q => {
  ok(!(S.N2_EXEMPT_RE.test(q) && !S.N2_STRICT_RE.test(q)), '「' + q.slice(0, 26) + '」应保持判罚');
});

// ---- ⑤ 「母婴级」在真实整段语境下的豁免（EXEMPT 是整段级）----
console.log('\n=== ⑤ 母婴级：整段带检测配套时应豁免（单句测试会低估） ===');
delete require.cache[require.resolve(SCAN_PATH)];
delete require.cache[require.resolve(path.join(HERE, 'v4', 'violation-rules.js'))];
globalThis.V4ViolationRules = require(path.join(HERE, 'v4', 'violation-rules.js'));
const SCAN = require(SCAN_PATH);

const CASES = [
  { name: '整段含 7A 级（真实逐字稿常态）', text: '内里材质都是母婴级的。我们这个面料是7A级的，90%加的细菌灭杀率。', expect: false },
  { name: '整段含"切A"(7A 的 ASR 误识)', text: '整个材质是属于母婴级别的切A杀菌以及防水。', expect: false },
  { name: '整段含"抑菌"', text: '这里内里都是母婴级的抑菌的一个材质。', expect: false },
  { name: '裸宣无任何依据（应仍标注）', text: '质作都是母婴级别的，', expect: true },
];
CASES.forEach(c => {
  const res = SCAN.scan([{ text: c.text }]) || {};
  const hit = (res.hits || []).some(h => h.term === '母婴级');
  ok(hit === c.expect, c.name, '实际命中=' + hit + ' 期望=' + c.expect);
});

console.log('\n===== 结果：%d PASS / %d FAIL =====', pass, fail);
process.exit(fail ? 1 : 0);
