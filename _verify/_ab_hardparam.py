# -*- coding: utf-8 -*-
"""硬参数新口径 A/B 量化（只读，不改任何生产文件）。

目的：在动手改代码前，用真实语料算出「硬性参数讲错 ⇒ 产品理解 c1 整块归零」
对总分、等级的量化影响，并顺带核实一处疑似结构性不一致：

  runGrading  : total = Σ(score × weight / W_SUM)，W_SUM = 可计分权重合计（当前 90）
  recompute   : total = Σ(score × weight / 100)          ← semantic-core.js

两者归一基数不同 ⇒ 语义引擎跑过一次后总分会被压到 90 分制。

同时对三种口径做同一批语料的横向对比：
  A 现状      = Σ(score×w/90) − min(12, errors×4)
  B 新口径    = c1 归零 后 Σ(score×w/90)，不再减 −4/处
  C 语义口径  = Σ(score×w/100) − min(12, errors×4)
"""
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NODE_SCRIPT = r'''
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = process.argv[2];

function stubEl() {
  const e = {
    style: {}, innerHTML: '', textContent: '', value: '', children: [], dataset: {}, className: '',
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(){ return e; }, insertBefore(){ return e; }, removeChild(){}, remove(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    querySelector(){ return stubEl(); }, querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}, focus(){}, blur(){}, click(){},
    closest(){ return null; }, scrollIntoView(){},
    getBoundingClientRect(){ return { top:0, left:0, width:0, height:0, bottom:0, right:0 }; }
  };
  return e;
}
const sandbox = {
  console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error, TypeError,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, escape, unescape,
  setTimeout, clearTimeout, setInterval, clearInterval, Promise,
  document: {
    getElementById(){ return stubEl(); }, querySelector(){ return stubEl(); }, querySelectorAll(){ return []; },
    createElement(){ return stubEl(); }, addEventListener(){}, removeEventListener(){},
    body: stubEl(), documentElement: stubEl(), head: stubEl(), cookie: ''
  },
  localStorage: { _d:{}, getItem(k){ return Object.prototype.hasOwnProperty.call(this._d,k)?this._d[k]:null; },
    setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; }, clear(){ this._d={}; } },
  sessionStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node-ab', clipboard: { writeText(){ return Promise.resolve(); } } },
  location: { href:'http://127.0.0.1:8791/v4/', origin:'http://127.0.0.1:8791', protocol:'http:',
    host:'127.0.0.1:8791', hostname:'127.0.0.1', search:'', hash:'' },
  alert(){}, confirm(){ return true; }, prompt(){ return null; },
  fetch(){ return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({}), text:()=>Promise.resolve('') }); },
  V4Jobs: { sync(){}, syncLibs(){}, syncTop1(){}, cachedRequest(){ return Promise.resolve(null); } }
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(REPO + '/v3/standard.js', 'utf8'), ctx, { filename: 'standard.js' });
vm.runInContext(fs.readFileSync(REPO + '/v4/app-core.js', 'utf8'), ctx, { filename: 'app-core.js' });

const { parseTranscript, applyAsrFix, runGrading } = ctx;
// standard.js 里是 `const GRADING_STANDARD`，const 不挂到 context 对象上（全局词法绑定），
// 但同一 context 的后续脚本可以读到 ⇒ 用一句话把它搬运到对象属性上。
vm.runInContext('globalThis.__STD = GRADING_STANDARD;', ctx, { filename: 'get-std.js' });
const STD = ctx.__STD;
if (!STD || !STD.modules) {
  console.error('无法取得 GRADING_STANDARD'); process.exit(9);
}

// 可计分权重合计（复刻 app-core 的 W_SUM）
let W_SUM = 0;
for (const k of ['c1','c2','c3','c4','c5','c6','c7','c8']) {
  const m = STD.modules[k];
  if (m && m.weight > 0) W_SUM += m.weight;
}
if (!(W_SUM > 0)) W_SUM = 100;

function gradeOf(t) {
  for (const g of STD.grades) if (t >= g.min) return g.name;
  return 'E';
}

// 三口径重算（modules 结构取自 runGrading 的真实产物）
function calc3(modules, errors) {
  const sc = (divisor, zeroC1, pen) => {
    let tot = 0;
    for (const m of modules) {
      if (!(m.weight > 0)) continue;
      // c1 归零只在「确有硬参数错误」时触发，否则会误伤无误场次
      const s = (zeroC1 && m.key === 'c1' && errors > 0) ? 0 : m.score;
      tot += s * m.weight / divisor;
    }
    const p = pen ? Math.min(12, errors * 4) : 0;
    return Math.round((tot - p) * 10) / 10;
  };
  return {
    A: Math.max(0, sc(W_SUM, false, true)),    // 现状
    B: Math.max(0, sc(W_SUM, true, false)),    // 新口径：c1 归零 + 取消 -4/处
    C: Math.max(0, sc(100, false, true))       // 语义 recompute 口径（/100）
  };
}

function walk(dir, acc) {
  acc = acc || [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.srt$/i.test(e.name)) acc.push(p);
  }
  return acc;
}

let files = [];
for (const d of ['C:/Users/QwQ/Desktop', REPO + '/../_test_audio']) {
  files = files.concat(walk(path.resolve(d)));
}
files = Array.from(new Set(files)).sort();

const per = [];
for (const f of files) {
  let raw = '';
  try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  let segs0 = null;
  try { segs0 = parseTranscript(raw); } catch (e) { continue; }
  if (!segs0 || segs0.length < 20) continue;
  const segs = applyAsrFix(segs0);
  let r = null;
  try { r = runGrading(segs, null); } catch (e) { continue; }

  const errs = r.baseline ? (r.baseline.errors || 0) : 0;
  const t3 = calc3(r.modules || [], errs);
  per.push({
    file: f.replace(/\\/g, '/').split('/').slice(-2).join('/'),
    errors: errs,
    errFields: ((r.baseline && r.baseline.items) || []).filter(x => x.error).map(x => x.field),
    c1: (r.modules || []).filter(m => m.key === 'c1').map(m => m.score)[0],
    totalRaw: r.total,
    A: t3.A, B: t3.B, C: t3.C,
    gradeA: gradeOf(t3.A), gradeB: gradeOf(t3.B), gradeC: gradeOf(t3.C)
  });
}

console.log(JSON.stringify({ W_SUM, sessions: per.length, per }, null, 1));
'''


def main():
    tmp = os.path.join(REPO, '_verify', '_ab_hardparam.tmp.js')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(NODE_SCRIPT)
    try:
        out = subprocess.run(['node', tmp, REPO], capture_output=True, timeout=1800)
        if out.returncode != 0:
            print('node 失败:', out.stderr.decode('utf-8', 'replace')[:2000])
            return 1
        data = json.loads(out.stdout.decode('utf-8', 'replace'))
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    per = data['per']
    n = data['sessions']
    print('=' * 74)
    print('语料场次 = %d   |   可计分权重合计 W_SUM = %d' % (n, data['W_SUM']))
    print('=' * 74)
    if n == 0:
        print('⚠️ 未找到 .srt 语料，无法量化')
        return 2

    a = [p['A'] for p in per]
    b = [p['B'] for p in per]
    c = [p['C'] for p in per]

    def stat(name, arr):
        return '%-6s 均值 %6.2f   中位 %6.1f   最低 %5.1f   最高 %5.1f' % (
            name, sum(arr) / len(arr), sorted(arr)[len(arr) // 2], min(arr), max(arr))

    print(stat('A 现状', a))
    print(stat('B 新口径', b))
    print(stat('C 语义/100', c))
    print()

    # runGrading 输出值 vs 我复刻的 A（自校验，两者应几乎一致）
    dif = [abs(p['totalRaw'] - p['A']) for p in per]
    print('自校验：runGrading 实际 total 与复刻 A 的最大偏差 = %.2f  （>0.5 说明复刻有误，须先修脚本）'
          % max(dif))
    print()

    # /100 vs /90 的失配
    dBC = [p['A'] - p['C'] for p in per]
    print('🔴 结构性失配（A − C，即 /90 与 /100 的差）：均值 %.2f 分，最大 %.2f 分' %
          (sum(dBC) / n, max(dBC)))
    print('   ⇒ 语义引擎 recompute 跑过一次，总分就被压到 90 分制。')
    print()

    # 新口径影响
    dAB = [p['A'] - p['B'] for p in per]
    hit = [i for i, p in enumerate(per) if p['errors'] > 0]
    print('新口径 B 相对现状 A：')
    print('  有硬参数错误的场次 = %d / %d (%.0f%%)' % (len(hit), n, len(hit) / n * 100))
    if hit:
        dh = [dAB[i] for i in hit]
        print('  这些场次降幅：均值 %.2f 分，最小 %.2f，最大 %.2f' %
              (sum(dh) / len(dh), min(dh), max(dh)))
    unch = [i for i in range(n) if per[i]['errors'] == 0]
    if unch:
        print('  无错误场次是否变动：', '否（0 变化）' if all(dAB[i] == 0 for i in unch)
              else '⚠️ 有变动，需查（最大 %.2f）' % max(abs(dAB[i]) for i in unch))
    print()

    chg = [(p['file'], p['gradeA'], p['gradeB'], p['A'], p['B'], p['errors'])
           for p in per if p['gradeA'] != p['gradeB']]
    print('等级变动场次 = %d / %d (%.0f%%)' % (len(chg), n, len(chg) / n * 100))
    for x in chg[:18]:
        print('  %-46s %s→%s   %.1f→%.1f  错%d处' % (x[0][-46:], x[1], x[2], x[3], x[4], x[5]))
    if len(chg) > 18:
        print('  ...（共 %d 场）' % len(chg))
    print()

    # 错误项分布
    from collections import Counter
    cc = Counter()
    for p in per:
        for f_ in set(p['errFields']):
            cc[f_] += 1
    print('硬参数错误项分布（场次数）：')
    for k, v in cc.most_common(14):
        print('  %-26s %d' % (k, v))

    out_path = os.path.join(REPO, '_verify', '_ab_hardparam_result.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'W_SUM': data['W_SUM'], 'sessions': n, 'per': per}, f, ensure_ascii=False, indent=1)
    print('\n明细已落盘:', out_path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
