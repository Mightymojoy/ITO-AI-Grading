// analyze_n2_gap.js —— 只读分析：n2「最高级用语」的豁免缺口在哪
// 用 v3.1.3 现状，把「被判 n2 但 quote 无『最』字」的命中按性质分类，
// 量化「ASR 把最→至/之/质」与「销量/热度维度陈述」两个缺口的规模。
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;

const rj = JSON.parse(fs.readFileSync(path.join(HERE, '_bak', 'rejudge_v313.json'), 'utf8'));

// 类别判定（顺序敏感：先严格项，再豁免项）
const RULES = [
  // A. 排他性比较断言 —— 必须判（人工也判「是」）
  { k: 'A_排他性比较(应判)', re: /找不到第二|没有比它更|没有比我们|比它更好|比它更加轻|没有比它大|找不到什么比/ },
  // B. 行业地位表述 —— 上一轮刻意保留，待老大口径
  { k: 'B_行业地位(待裁定)', re: /领头羊|领通羊|领头[上样]|行业.{0,4}(第一|领先)/ },
  // C. ASR 把「最」识别成 至/之/质/只/正 —— 实为「卖的最好」类销量陈述
  { k: 'C_ASR变体-销量维度(应豁)', re: /(卖|销)[得的有]{0,2}[至之质只正](好|多|高)|销量[至之质][高多]|明星(选择|自用|用的)[至之质]多|[至之质](好|小|多)的/ },
  // D. 销量/热度维度事实陈述（本就属老大已豁免的那一类，只是措辞不同）
  { k: 'D_销量热度维度(应豁)', re: /销冠|top\s*one|热卖|大爆款|销量排|卖了.{0,4}单|卖的比较?好|卖的非常|销量.{0,2}高|比较热卖/ },
  // E. 辨识度/颜值维度（老大已明确豁免「辨识度最高/颜值最吸睛」）
  { k: 'E_辨识度维度(应豁)', re: /辨识度|识别度|颜值/ },
  // F. 主观感叹
  { k: 'F_主观感叹(应豁)', re: /太好看了|很好看|好好看|真好看|非常好看|很漂亮/ },
  // G. 其他
  { k: 'G_其他', re: /.*/ },
];

function classify(q) {
  for (const r of RULES) if (r.re.test(q)) return r.k;
  return 'G_其他';
}

const groups = ['zero16', 'yes', 'pending93'];
const stat = {};
const detail = {};
let total = 0;
groups.forEach(g => {
  (rj.groups[g] || []).forEach(r => {
    (r.per || []).forEach(p => {
      if (p.cat !== '最高级用语') return;
      if (String(p.quote).indexOf('最') >= 0) return;   // 只看无「最」字的
      total++;
      const k = classify(p.quote);
      stat[k] = stat[k] || { n: 0, stillZero: 0, cleared: 0, groups: {}, rows: new Set() };
      stat[k].n++;
      stat[k].groups[g] = (stat[k].groups[g] || 0) + 1;
      stat[k].rows.add(r.date + ' ' + r.host);
      if (p.after === 'SESSION_ZERO') stat[k].stillZero++; else stat[k].cleared++;
      detail[k] = detail[k] || [];
      detail[k].push({ g, date: r['date'], host: r['host'], quote: p.quote, before: p.before, after: p.after });
    });
  });
});

const out = [];
function W(s) { out.push(s); console.log(s); }
W('=== n2「最高级用语」中 quote 无「最」字的命中：' + total + ' 条 ===');
W('');
const ORDER = ['A_排他性比较(应判)', 'B_行业地位(待裁定)', 'C_ASR变体-销量维度(应豁)',
  'D_销量热度维度(应豁)', 'E_辨识度维度(应豁)', 'F_主观感叹(应豁)', 'G_其他'];
ORDER.forEach(k => {
  const s = stat[k];
  if (!s) return;
  W(k + '  —— ' + s.n + ' 条 / 涉及 ' + s.rows.size + ' 场');
  W('   其中现规则已撤 ' + s.cleared + ' 条、仍判 0 ' + s.stillZero + ' 条'
    + '   分组: ' + JSON.stringify(s.groups));
  (detail[k] || []).slice(0, 6).forEach(d => {
    W('     [' + d.g + '] ' + d.date + ' ' + d.host + ' 「' + String(d.quote).slice(0, 56) + '」');
  });
  if ((detail[k] || []).length > 6) W('     … 另 ' + (detail[k].length - 6) + ' 条');
  W('');
});

// 缺口量化：C+D+E+F 若全部豁免，能多撤多少场
const shouldExempt = new Set();
['C_ASR变体-销量维度(应豁)', 'D_销量热度维度(应豁)', 'E_辨识度维度(应豁)', 'F_主观感叹(应豁)'].forEach(k => {
  (stat[k] && stat[k].rows) ? stat[k].rows.forEach(x => shouldExempt.add(x)) : null;
});
W('=== 若 C+D+E+F 全部豁免，可动的场次数 ===');
W('  涉及 ' + shouldExempt.size + ' 场');

// 但这只是"该场有这一类命中"，不代表整场就只剩这一条 ⇒ 逐场看是否还有别的硬命中
const stillHard = {};
groups.forEach(g => {
  (rj.groups[g] || []).forEach(r => {
    const key = r['date'] + ' ' + r.host;
    if (!shouldExempt.has(key)) return;
    const hard = (r.per || []).filter(p => p.after === 'SESSION_ZERO').map(p => p.cat + '「' + String(p.quote).slice(0, 40) + '」');
    stillHard[g] = stillHard[g] || [];
    stillHard[g].push({ key, stillZero: r.stillZero, hard });
  });
});
W('');
groups.forEach(g => {
  const arr = stillHard[g] || [];
  if (!arr.length) return;
  const onlySoft = arr.filter(x => x.hard.length === 0);
  W('  [' + g + '] 涉及 ' + arr.length + ' 场；其中若把 C~F 都豁免后**整场不再归零**的: ' + onlySoft.length + ' 场');
  onlySoft.slice(0, 20).forEach(x => W('     ✓ ' + x.key));
});
W('');
fs.writeFileSync(path.join(HERE, '_bak', 'n2_gap_analysis.json'), JSON.stringify({ stat, detail }, null, 1), 'utf8');
fs.writeFileSync(path.join(HERE, '_n2_gap.out.txt'), out.join('\n') + '\n', 'utf8');
console.log('\n落盘: _n2_gap.out.txt / _bak/n2_gap_analysis.json');
