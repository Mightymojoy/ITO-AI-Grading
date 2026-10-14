# -*- coding: utf-8 -*-
"""
只读探针：验证「非判 0 场次」的『不计违规项综合评分』是否恒等于「综合评分」。

用途 —— 回答老大的问题「这次更新了之后是否满足我的要求」里最关键的那一处：
  「我现在需要 2 个评分结果」⇒ 非判 0 场次那一列要不要也填？
  如果非判 0 场次的该值恒等于综合评分，那么「填了 = 同一行两个相同数字」，
  属于**噪音而非信息**；反之则必须填。

口径（与前端 v4.11.38 v4RawScore 完全一致）：
  精确复算 = Σ mods[weight>0].weighted − min(12, 红旗处数 × 4)
  红旗处数 = det.extra.bl.errs → det.rawBlk → det.baseline.errors（同 v4RawBlk 取值链）

安全性：只读本地备份 JSON，**零网络请求、零写入**。
"""
import json
import math
import glob
import os
import sys


def js_round(x):
    """复刻 JS Math.round（Python round 是银行家舍入，不能直接用）"""
    return math.floor(x + 0.5)


def r1(x):
    return js_round(x * 10) / 10.0


def raw_blk(det):
    """复刻前端 v4RawBlk() 的取值链"""
    if not isinstance(det, dict):
        return None
    v = det.get('rawBlk')
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v
    bl = det.get('baseline')
    if isinstance(bl, dict) and isinstance(bl.get('errors'), (int, float)) \
            and not isinstance(bl.get('errors'), bool):
        return bl['errors']
    ex = det.get('extra')
    if isinstance(ex, dict):
        b = ex.get('bl')
        if isinstance(b, dict) and isinstance(b.get('errs'), (int, float)) \
                and not isinstance(b.get('errs'), bool):
            return b['errs']
    return None


def raw_score(det):
    """复刻前端 v4RawScore()，返回 (值, via) 或 None"""
    rt = det.get('rawTotal')
    if isinstance(rt, (int, float)) and not isinstance(rt, bool):
        t, via = float(rt), 'stored'
    else:
        mods = det.get('mods') or det.get('modules') or []
        s, has = 0.0, False
        for m in mods:
            if not isinstance(m, dict):
                continue
            if (m.get('weight') or 0) > 0 and isinstance(m.get('weighted'), (int, float)) \
                    and not isinstance(m.get('weighted'), bool):
                s += float(m['weighted'])
                has = True
        if not has:
            return None
        blk = raw_blk(det)
        if blk is not None:
            t, via = s - min(12, blk * 4), 'rebuilt'
        else:
            t, via = s, 'derived'
    tot = r1(t)
    if tot < 0:
        tot = 0.0
    return tot, via


def main():
    cands = sorted(glob.glob('_bak/rawcol-backfill-*/daily-records.before.json'))
    if not cands:
        print('!! 找不到备份，退出')
        return 1
    path = cands[-1]
    print('数据源：%s  (%d B)' % (path, os.path.getsize(path)))
    recs = json.load(open(path, encoding='utf-8'))
    print('记录总数：%d' % len(recs))
    print()

    zero_rows, nz_rows, no_report = [], [], []
    for rec in recs:
        f = rec.get('fields') or {}
        host, date = f.get('主播'), f.get('日期')
        raw = f.get('完整主播报告')
        try:
            total = float(f.get('综合评分'))
        except (TypeError, ValueError):
            total = None
        det = None
        if raw:
            try:
                det = json.loads(raw)
            except Exception:
                det = None
        if not det:
            no_report.append((host, date, total))
            continue
        q = raw_score(det)
        if not q:
            no_report.append((host, date, total))
            continue
        val, via = q
        if total is not None and total == 0:
            zero_rows.append((host, date, total, val, via))
        else:
            nz_rows.append((host, date, total, val, via))

    print('=' * 74)
    print('① 判 0 场次（综合评分 == 0）：两列【必然不同】⇒ 填了才有信息')
    print('=' * 74)
    print('  条数 %d' % len(zero_rows))
    from collections import Counter
    print('  取值路径分布：%s' % dict(Counter(x[4] for x in zero_rows)))
    print('  示例（前 6）：')
    print('    %-8s %-12s %10s %12s %10s' % ('主播', '日期', '综合评分', '未记录列', '路径'))
    for a, b, c, d, e in zero_rows[:6]:
        print('    %-8s %-12s %10s %12s %10s' % (a, b, c, d, e))
    print()

    print('=' * 74)
    print('② 非判 0 场次：『不计违规项』是否恒等于「综合评分」？')
    print('=' * 74)
    same = [x for x in nz_rows if x[2] is not None and abs(x[3] - x[2]) < 1e-9]
    diff = [x for x in nz_rows if x[2] is not None and abs(x[3] - x[2]) >= 1e-9]
    print('  可对照条数 %d' % len(nz_rows))
    print('  ✅ 两值【完全相等】 %d 条' % len(same))
    print('  ❌ 两值【不相等】 %d 条' % len(diff))
    if diff:
        print('     ⚠️ 不相等样本（若存在，说明我的"恒等"判断有反例，必须查）：')
        for a, b, c, d, e in diff[:12]:
            print('       %-8s %-12s 综合=%-8s 复算=%-8s via=%s' % (a, b, c, d, e))
    print()
    print('  取值路径分布：%s' % dict(Counter(x[4] for x in nz_rows)))
    print()

    print('=' * 74)
    print('③ 无「完整主播报告」⇒ 这列无法回填（两列都填不了）')
    print('=' * 74)
    print('  条数 %d' % len(no_report))
    for a, b, c in no_report:
        print('    %-8s %-12s 综合评分=%s' % (a, b, c))
    print()

    print('=' * 74)
    print('④ 结论：两种口径下表内两列的差异行数')
    print('=' * 74)
    print('  口径 A（只填判 0）：非判 0 的 %d 条该列留空' % len(nz_rows))
    print('       ⇒ 两列"看起来不同"的行 = %d 行（即判 0 行）' % len(zero_rows))
    print('  口径 B（非判 0 也填）：')
    print('       ⇒ 其中 %d 行两个数字【一模一样】（纯重复）' % len(same))
    print('       ⇒ 真正提供新信息的 = %d 行' % len(zero_rows))
    print('  两口径的「新信息量」完全相同，差别只在 B 会让表更满（多 %d 行重复值）'
          % len(same))
    return 0


if __name__ == '__main__':
    sys.exit(main())
