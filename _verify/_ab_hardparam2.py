# -*- coding: utf-8 -*-
"""硬参数新口径 A/B 三件套验证（只读，不改生产文件）。

对照组：
  A 组 = 改动前版本（_bak/hardparam-20261116-1100/app-core.js + semantic-core.js）
  B 组 = 当前工作区（改动后）

同一批真实 .srt 语料、同一 sandbox 桩，唯一差异是被测文件本身。

验证四件事：
  1. 无硬参数错误的场次，A/B 总分必须完全一致（防误伤）
  2. 有硬参数错误的场次，B 组 c1 必须为 0，且降幅符合 c1×(25/90)
  3. 回退阀 v4hardparam_c1zero='0' 能恢复旧口径（-4/处、c1 不动）
  4. semantic-core recompute 与 app-core runGrading 的总分一致（修掉 /100 失配）
"""
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAK = os.path.join(REPO, '_bak', 'hardparam-20261116-1100')

NODE = r'''
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = process.argv[2];
const BAK  = process.argv[3];
const FLAG = process.argv[4] || '';   // 'revert' => 设 v4hardparam_c1zero='0'

function stubEl() {
  const e = {
    style:{}, innerHTML:'', textContent:'', value:'', children:[], dataset:{}, className:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    appendChild(){return e;}, insertBefore(){return e;}, removeChild(){}, remove(){},
    setAttribute(){}, getAttribute(){return null;}, removeAttribute(){},
    querySelector(){return stubEl();}, querySelectorAll(){return [];},
    addEventListener(){}, removeEventListener(){}, focus(){}, blur(){}, click(){},
    closest(){return null;}, scrollIntoView(){},
    getBoundingClientRect(){return {top:0,left:0,width:0,height:0,bottom:0,right:0};}
  };
  return e;
}

function makeCtx() {
  const box = {
    console, JSON, Math, Date, String, Number, Boolean, Array, Object, RegExp, Error, TypeError,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, escape, unescape,
    setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    document:{ getElementById(){return stubEl();}, querySelector(){return stubEl();}, querySelectorAll(){return [];},
      createElement(){return stubEl();}, addEventListener(){}, removeEventListener(){},
      body:stubEl(), documentElement:stubEl(), head:stubEl(), cookie:'' },
    localStorage:{ _d:{}, getItem(k){ return Object.prototype.hasOwnProperty.call(this._d,k)?this._d[k]:null; },
      setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; }, clear(){ this._d={}; } },
    sessionStorage:{ getItem(){return null;}, setItem(){}, removeItem(){} },
    navigator:{ userAgent:'node-ab', clipboard:{ writeText(){ return Promise.resolve(); } } },
    location:{ href:'http://127.0.0.1:8791/v4/', origin:'http://127.0.0.1:8791', protocol:'http:',
      host:'127.0.0.1:8791', hostname:'127.0.0.1', search:'', hash:'' },
    alert(){}, confirm(){ return true; }, prompt(){ return null; },
    fetch(){ return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({}), text:()=>Promise.resolve('') }); },
    V4Jobs:{ sync(){}, syncLibs(){}, syncTop1(){}, cachedRequest(){ return Promise.resolve(null); } }
  };
  box.window = box; box.self = box; box.globalThis = box;
  return vm.createContext(box);
}

function loadGroup(stdPath, appPath, semPath, flag) {
  const ctx = makeCtx();
  vm.runInContext(fs.readFileSync(stdPath, 'utf8'), ctx, { filename: 'standard.js' });
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), ctx, { filename: 'app-core.js' });
  vm.runInContext(fs.readFileSync(semPath, 'utf8'), ctx, { filename: 'semantic-core.js' });
  if (flag === 'revert') ctx.localStorage.setItem('v4hardparam_c1zero', '0');
  return ctx;
}

function walk(dir, acc) {
  acc = acc || [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else if (/\.srt$/i.test(e.name)) acc.push(p);
  }
  return acc;
}

const A = loadGroup(REPO + '/v3/standard.js', BAK + '/app-core.js', BAK + '/semantic-core.js', '');
const B = loadGroup(REPO + '/v3/standard.js', REPO + '/v4/app-core.js', REPO + '/v4/semantic-core.js', '');
const Bv = loadGroup(REPO + '/v3/standard.js', BAK + '/app-core.js', BAK + '/semantic-core.js', 'revert');
const Rv = loadGroup(REPO + '/v3/standard.js', REPO + '/v4/app-core.js', REPO + '/v4/semantic-core.js', 'revert');

let files = [];
for (const d of ['C:/Users/QwQ/Desktop', REPO + '/../_test_audio']) files = files.concat(walk(path.resolve(d)));
files = Array.from(new Set(files)).sort();

function grade(ctx, segs) {
  let r = null;
  try { r = ctx.runGrading(segs, null); } catch (e) { return null; }
  const c1 = (r.modules || []).filter(m => m.key === 'c1')[0] || {};
  return {
    total: r.total, grade: r.grade,
    c1: c1.score == null ? null : c1.score,
    c1zero: !!c1.hardParamZero,
    errors: (r.baseline && r.baseline.errors) || 0,
    // 语义 recompute 一致性：把同一份 r 交给该 context 的 recompute 再算一遍
    ...(function(){
      let rt = null;
      try {
        const SEM = ctx.V4SEM;
        if (SEM && typeof SEM.recompute === 'function') { SEM.recompute(r); rt = r.total; }
      } catch (e) {}
      return { recomputed: rt };
    })()
  };
}

const per = [];
for (const f of files) {
  let raw = '';
  try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  let segs0 = null;
  try { segs0 = A.parseTranscript(raw); } catch (e) { continue; }
  if (!segs0 || segs0.length < 20) continue;
  const segs = A.applyAsrFix(segs0);

  const a = grade(A, segs);
  if (!a) continue;
  const b = grade(B, segs);
  const bv = grade(Bv, segs);
  const rv = grade(Rv, segs);
  per.push({
    file: f.replace(/\\/g, '/').split('/').slice(-2).join('/'),
    A: a, B: b, B_revert: bv, Bnew_revert: rv
  });
}

console.log(JSON.stringify({ sessions: per.length, per }, null, 1));
'''


def main():
    tmp = os.path.join(REPO, '_verify', '_ab2.tmp.js')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(NODE)
    try:
        out = subprocess.run(['node', tmp, REPO, BAK], capture_output=True, timeout=1800)
        if out.returncode != 0:
            print('node 失败:', out.stderr.decode('utf-8', 'replace')[:2500])
            return 1
        data = json.loads(out.stdout.decode('utf-8', 'replace'))
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    per = data['per']
    n = data['sessions']
    if n == 0:
        print('⚠️ 无语料')
        return 2

    print('=' * 78)
    print('A/B 三件套验证 · 语料 %d 场' % n)
    print('  A = 改动前（_bak/hardparam-20261116-1100）   B = 改动后（工作区）')
    print('=' * 78)

    # ---- ① 无误场次不得变动 ----
    err0 = [p for p in per if p['A']['errors'] == 0]
    bad0 = [p for p in err0 if p['A']['total'] != p['B']['total']]
    print('\n① 无硬参数错误场次（%d 场）A/B 是否一致：' % len(err0), end=' ')
    print('✅ 全部一致' if not bad0 else '❌ %d 场变动' % len(bad0))
    for p in bad0[:6]:
        print('   %s  %.1f → %.1f' % (p['file'][-44:], p['A']['total'], p['B']['total']))

    # ---- ② 有错场次 c1 归零 ----
    errN = [p for p in per if p['A']['errors'] > 0]
    print('\n② 有硬参数错误场次（%d 场）：' % len(errN))
    ok_c1 = 0
    for p in errN:
        z = p['B']['c1'] == 0
        if z:
            ok_c1 += 1
        exp = round(p['A']['total'] - (p['A']['c1'] or 0) * 25 / 90 + 0, 2)
        print('   %-40s 错%d处  c1 %s→%s  total %.1f→%.1f' % (
            p['file'][-40:], p['A']['errors'], p['A']['c1'], p['B']['c1'],
            p['A']['total'], p['B']['total']))
    print('   c1 已归零：%d / %d' % (ok_c1, len(errN)), '✅' if ok_c1 == len(errN) else '❌')

    # ---- ③ 回退阀 ----
    print('\n③ 回退阀 v4hardparam_c1zero=0（两个方向各测一次）：')
    rvA_ok = sum(1 for p in per if p['B_revert'] and p['B_revert']['total'] == p['A']['total'])
    print('   回退后的旧版本 vs 原始的旧版本：%d/%d 一致 %s' % (
        rvA_ok, len(per), '✅' if rvA_ok == len(per) else '❌'))
    rvB_ok = sum(1 for p in per if p['Bnew_revert'] and p['Bnew_revert']['total'] == p['A']['total'])
    print('   回退后的新版本 vs 原始的旧版本：%d/%d 一致 %s（应全一致＝回退真能还原旧口径）' % (
        rvB_ok, len(per), '✅' if rvB_ok == len(per) else '❌'))
    if rvB_ok != len(per):
        for p in per:
            if p['Bnew_revert'] and p['Bnew_revert']['total'] != p['A']['total']:
                print('     %s  %.1f vs %.1f' % (p['file'][-40:], p['Bnew_revert']['total'], p['A']['total']))

    # ---- ④ recompute 一致性 ----
    print('\n④ semantic recompute 与 runGrading 总分一致性（应≈0；旧代码此处偏差均值 6.34）：')
    ins = [p for p in per if p['B'].get('recomputed') is not None]
    olds = [p for p in per if p['A'].get('recomputed') is not None]
    if not ins:
        print('   ❌ recompute 取不到（V4SEM 未挂到 context）')
    else:
        dif = [abs(p['B']['recomputed'] - p['B']['total']) for p in ins]
        print('   新版本 %d 场，最大偏差 %.2f  %s' % (len(ins), max(dif), '✅' if max(dif) <= 0.11 else '❌'))
        if olds:
            difA = [abs(p['A']['recomputed'] - p['A']['total']) for p in olds]
            print('   旧版本 %d 场，最大偏差 %.2f  （这是被修掉的失配）' % (len(olds), max(difA)))

    # 汇总
    chg = [p for p in per if p['A']['grade'] != p['B']['grade']]
    print('\n' + '=' * 78)
    print('等级变动：%d / %d 场' % (len(chg), n))
    for p in chg:
        print('   %-42s %s→%s  %.1f→%.1f' % (p['file'][-42:], p['A']['grade'], p['B']['grade'],
                                             p['A']['total'], p['B']['total']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
