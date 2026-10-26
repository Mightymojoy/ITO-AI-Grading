// audit_exempt_hits.js —— 只读审计：v3.1.3 到底把哪些命中豁免了、被哪条 EXEMPT 命中
// 目的：逐条核对每个"降档"是否有依据，抓出我自己可能写宽的豁免（放水）。
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const R = require(path.join(HERE, 'v4', 'violation-rules.js'));
globalThis.V4ViolationRules = R;
const S = require(path.join(HERE, 'v4', 'violation-scan.js'));
const SEM = require(path.join(HERE, 'v4', 'semantic-core.js'));
const SAFE = SEM.SAFETY;

const rj = JSON.parse(fs.readFileSync(path.join(HERE, '_bak', 'rejudge_v313.json'), 'utf8'));
const RANK = { '': 0, 'ANNOTATE': 1, 'MODULE_ZERO': 2, 'SESSION_ZERO': 3 };
const rank = a => RANK[a || ''] || 0;

// 找出某段文本命中的 EXEMPT 条目（term + why 首句）
function whichExempt(text) {
  const out = [];
  (R.EXEMPT || []).forEach(e => {
    try {
      e.re.lastIndex = 0;
      const m = e.re.exec(text);
      if (m) out.push(e.term + '⇐「' + m[0] + '」');
    } catch (err) { }
  });
  return out;
}

const lines = [];
function W(s) { lines.push(s); console.log(s); }

W('=== v3.1.3 降档命中逐条审计（规则库 _v=' + R._v + '，EXEMPT=' + R.EXEMPT.length + '）===');
W('');

const flagged = [];   // 危险项：人工判"是"的场次里的降档
const all = [];

['zero16', 'yes', 'pending93'].forEach(g => {
  (rj.groups[g] || []).forEach(r => {
    (r.per || []).forEach(p => {
      if (rank(p.after) >= rank(p.before)) return;
      const ex = whichExempt(String(p.quote));
      const rec = {
        g, date: r['date'], host: r['host'], cat: p.cat, src: p.src,
        before: p.before, after: p.after || '(无命中)',
        quote: p.quote, exempt: ex, semEx: p.semEx
      };
      all.push(rec);
      if (g === 'yes') flagged.push(rec);
    });
  });
});

W('降档命中总 %d 条；其中出自「复核=是（人工确认违规）」的 %d 条 ← 这些最危险'
  .replace('%d', all.length).replace('%d', flagged.length));
W('');

// 1) 人工判"是"的场次里被降档的 —— 逐条
W('=== ① 「复核=是」场次里的降档命中（必须逐条自证不是放水）===');
if (!flagged.length) W('  （无）');
flagged.forEach((x, i) => {
  W((i + 1) + '. ' + x.date + ' ' + x.host + '  [' + x.cat + '/' + x.src + '] ' + x.before + ' → ' + x.after);
  W('   「' + String(x.quote).slice(0, 90) + '」');
  W('   命中豁免: ' + (x.exempt.length ? x.exempt.join(' | ') : '(无 EXEMPT)')
    + '   语义安全阀: ' + x.semEx);
  W('');
});

// 2) 危险词专项：这些词一旦被豁就是放水
const DANGER = [
  { k: '完全不会爆开', re: /完全不会爆开/ },
  { k: '永久/永不 + 返场', re: /永久|永不/ },
  { k: '关注（人/账号）', re: /关注/ },
  { k: '评论', re: /评论/ },
  { k: '找不到第二', re: /找不到第二/ },
  { k: '没有比它更', re: /没有比它更/ },
  { k: '绝对/保证/永久不坏', re: /绝对|保证|永久不/ },
  { k: '最', re: /最/ },
];
W('=== ② 危险词专项：谁被豁了、凭什么 ===');
DANGER.forEach(d => {
  const hits = all.filter(x => d.re.test(String(x.quote)));
  if (!hits.length) return;
  W('  ▸ ' + d.k + '  降档 ' + hits.length + ' 条');
  hits.forEach(x => {
    W('     [' + x.g + '] ' + x.date + ' ' + x.host + ' ' + x.cat + ' ' + x.before + '→' + x.after);
    W('        「' + String(x.quote).slice(0, 70) + '」');
    W('        EXEMPT: ' + (x.exempt.length ? x.exempt.join(' | ') : '(无)') + ' / semEx=' + x.semEx);
  });
  W('');
});

fs.writeFileSync(path.join(HERE, '_bak', 'exempt_audit.json'), JSON.stringify(all, null, 1), 'utf8');
fs.writeFileSync(path.join(HERE, '_exempt_audit.out.txt'), lines.join('\n') + '\n', 'utf8');
console.log('\n落盘: _exempt_audit.out.txt / _bak/exempt_audit.json');
