# -*- coding: utf-8 -*-
"""
_probe_raw_exact.py —— 「上限值」能否升级为「精确值」的独立验证（只读，零网络）

背景：
  v4.11.34 之前的老存档不存 rawTotal，只能按 Σ mods[weight>0].weighted 反推；
  反推只算出原公式的减号左边，缺 min(12, 信息准确性红旗处数×4) ⇒ 只能是上限。

本脚本验证的假设：
  存档 det.extra.bl.errs（extraV=4.11.22 起，109/109 条都有）就是那个「处数」，
  补上它之后反推值能精确还原 app-core.js:574-581 的原公式。

两组独立对照（缺一不可）：
  ① 非判 0 场次：反推值 − pen 应 == 飞书「综合评分」（红线没动过它）
  ② 带 rawTotal 的判 0 场次：反推值 − pen 应 == det.rawTotal（两侧都是真值）

口径（严格照抄 app-core.js:574-581）：
  total = Σ(score × weight / 100)            # 不逐模块舍入
  blPenalty = min(12, bl.errors × 4)
  total = round((total − blPenalty) × 10) / 10   # JS Math.round
  if total < 0: total = 0
"""
import json, math, os, sys

BAK = '_bak/rawcol-backfill-20261014-120657/daily-records.before.json'


def js_round(x):
    """复刻 JS Math.round（Python round 是银行家舍入，round(2.5)=2 ≠ JS 的 3）"""
    return math.floor(x + 0.5)


def r1(x):
    return js_round(x * 10) / 10.0


def load():
    with open(BAK, encoding='utf-8') as f:
        return json.load(f)


def blk_of(det):
    """红旗处数：与前端 v4RawBlk() 同优先级"""
    v = det.get('rawBlk')
    if isinstance(v, (int, float)):
        return int(v), 'rawBlk'
    ex = det.get('extra') or {}
    bl = ex.get('bl') or {}
    v = bl.get('errs')
    if isinstance(v, (int, float)):
        return int(v), 'extra.bl.errs'
    return None, None


def weighted_sum(det):
    s, has = 0.0, False
    for m in (det.get('mods') or []):
        w = m.get('weight') or 0
        if w > 0 and isinstance(m.get('weighted'), (int, float)):
            s += m['weighted']
            has = True
    return (r1(s), True) if has else (None, False)


def unrounded_sum(det):
    """照 app-core 原式：不逐模块舍入（用于交叉核对舍入是否真的零影响）"""
    s, has = 0.0, False
    for m in (det.get('mods') or []):
        w = m.get('weight') or 0
        if w > 0 and isinstance(m.get('score'), (int, float)):
            s += m['score'] * w / 100.0
            has = True
    return (s, True) if has else (None, False)


def main():
    recs = load()
    print('备份文件: %s  (%d 字节, %d 条记录)' % (
        BAK, os.path.getsize(BAK), len(recs)))
    print()

    with_rep, no_rep = [], []
    for rec in recs:
        f = rec.get('fields') or {}
        raw = f.get('完整主播报告')
        det = None
        if raw:
            try:
                det = json.loads(raw)
            except Exception:
                det = None
        (with_rep if det else no_rep).append((rec, f, det))

    print('=== 0. 样本 ===')
    print('  有「完整主播报告」: %d 条 ｜ 无报告: %d 条' % (len(with_rep), len(no_rep)))
    have_blk = sum(1 for _, _, d in with_rep if blk_of(d)[0] is not None)
    print('  其中能取到「红旗处数」的: %d / %d' % (have_blk, len(with_rep)))
    print()

    # ---- 舍入影响面（防「上限值」其实是舍入漂移的误解） ----
    n_mod = n_round = 0
    worst = 0.0
    for _, _, det in with_rep:
        for m in (det.get('mods') or []):
            w = m.get('weight') or 0
            if w <= 0:
                continue
            n_mod += 1
            exact = (m.get('score') or 0) * w / 100.0
            if abs(r1(exact) - exact) > 1e-9:
                n_round += 1
                worst = max(worst, abs(r1(exact) - exact))
    print('=== 1. 逐模块舍入是否影响结果 ===')
    print('  计权模块总数 %d ｜ score×weight/100 本身超过 1 位小数、需要舍入的 %d 个 ｜ 单模块最大漂移 %.4f'
          % (n_mod, n_round, worst))
    print()

    # ---- 对照① 非判 0 ----
    a_ok = a_bad = 0
    a_rows = []
    bad_rows = []
    # ---- 对照② 判 0 且带 rawTotal ----
    b_ok = b_bad = 0
    b_rows = []
    # ---- 待回填的判 0 存量 ----
    to_write = []
    unwritable = []

    for rec, f, det in with_rep:
        blk, src = blk_of(det)
        sw, has = weighted_sum(det)
        un, _ = unrounded_sum(det)
        if not has:
            continue
        try:
            t = float(f.get('综合评分'))
        except Exception:
            continue
        pen = min(12, blk * 4) if blk is not None else None
        calc = None
        if pen is not None:
            calc = r1(max(0.0, r1(sw - pen)))
        rt = det.get('rawTotal')

        if rt is not None:
            row = (f.get('主播'), f.get('日期'), sw, blk, pen, calc, rt, det.get('rawBlk'), det.get('rawPen'))
            if calc is not None and abs(calc - rt) < 1e-9:
                b_ok += 1
                b_rows.append(row)
            else:
                b_bad += 1
                bad_rows.append(('对照②',) + row)
        elif t != 0:
            row = (f.get('主播'), f.get('日期'), t, sw, blk, pen, calc, r1(un))
            if calc is not None and abs(calc - t) < 1e-9:
                a_ok += 1
                a_rows.append(row)
            else:
                a_bad += 1
                bad_rows.append(('对照①',) + row)
        else:
            # 判 0 且无 rawTotal ⇒ 本次要回填的存量
            if calc is not None:
                to_write.append((f.get('主播'), f.get('日期'), sw, blk, pen, calc))
            else:
                unwritable.append((f.get('主播'), f.get('日期')))

    print('=== 2. 对照①：非判 0 场次 —— (Σweighted − pen) 是否 == 飞书「综合评分」 ===')
    print('  ✅ 闭合 %d 条 ｜ ❌ 不符 %d 条' % (a_ok, a_bad))
    print('  %-7s %-11s %7s %7s %5s %5s %8s %10s' % ('主播', '日期', '飞书分', 'Σ加权', 'errs', 'pen', '复算', '不丢舍入'))
    for r in a_rows[:8]:
        print('  %-7s %-11s %7s %7s %5s %5s %8s %10s' % tuple(str(x) for x in r))
    if len(a_rows) > 8:
        print('  ...（共 %d 条，全部闭合）' % len(a_rows))
    print()

    print('=== 3. 对照②：带 rawTotal 的判 0 场次 —— (Σweighted − pen) 是否 == det.rawTotal ===')
    print('  ✅ 闭合 %d 条 ｜ ❌ 不符 %d 条' % (b_ok, b_bad))
    print('  %-7s %-11s %7s %5s %5s %8s %9s %6s %6s' %
          ('主播', '日期', 'Σ加权', 'errs', 'pen', '复算', 'rawTotal', 'blk', 'pen'))
    for r in b_rows:
        print('  %-7s %-11s %7s %5s %5s %8s %9s %6s %6s' % tuple(str(x) for x in r))
    print()

    if bad_rows:
        print('  ❌ 不符明细：')
        for r in bad_rows[:20]:
            print('     ', r)
        print()

    # 无报告的记录里，判 0 的有几条（这 6 条才是真正「无法回填」的）
    nr_zero = []
    for rec, f, det in no_rep:
        try:
            if float(f.get('综合评分')) == 0.0:
                nr_zero.append((f.get('主播'), f.get('日期')))
        except Exception:
            pass
    print('=== 4. 结论：判 0 存量回填清单（现在全部是精确值） ===')
    print('  可写 %d 条 ｜ 无法回填 %d 条（无「完整主播报告」，该列保持空白）'
          % (len(to_write) + len(unwritable), len(nr_zero)))
    print('  %-7s %-11s %7s %5s %5s %9s' % ('主播', '日期', 'Σ加权', 'errs', 'pen', '精确值'))
    for r in to_write:
        print('  %-7s %-11s %7s %5s %5s %9s' % tuple(str(x) for x in r))
    if unwritable:
        print()
        print('  ⚠️ 有报告但算不出（模块无权重）：')
        for a, b in unwritable:
            print('     %s %s' % (a, b))
    if nr_zero:
        print()
        print('  ⚠️ 无法回填（根本没有「完整主播报告」存档，该列只能留空）：')
        for a, b in nr_zero:
            print('     %s %s' % (a, b))
    print()

    tot = a_ok + b_ok
    print('=== 5. 总计 ===')
    print('  独立对照共 %d 条，闭合 %d 条，不符 %d 条' % (a_ok + b_ok + a_bad + b_bad, tot, a_bad + b_bad))
    print('  ⇒ %s' % ('假设成立：extra.bl.errs 就是信息准确性红旗处数，反推可升级为精确值'
                      if a_bad + b_bad == 0 else '假设不成立，需继续排查'))
    return 0 if (a_bad + b_bad == 0) else 1


if __name__ == '__main__':
    sys.exit(main())
