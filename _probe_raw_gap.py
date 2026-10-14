# -*- coding: utf-8 -*-
"""
只读分析：把飞书导出的 154 条日报（本地备份 json）当数据源，
量化「精确值」与「反推上限值」之间到底差多少、差在哪两处。

不做任何网络请求、不写任何数据。
"""
import json, os, re, math

BAK = '_bak/rawcol-backfill-20261014-120657/daily-records.before.json'
REP = '完整主播报告'


def js_round(x):
    """复刻 JS Math.round（Python round 是银行家舍入，不能直接用）"""
    return math.floor(x + 0.5) if x >= 0 else -math.floor(-x + 0.5)


def r1(x):
    return js_round(x * 10) / 10.0


def load():
    d = json.load(open(BAK, encoding='utf-8'))
    out = []
    for rec in d:
        f = rec.get('fields') or {}
        raw = f.get(REP)
        det = None
        if raw:
            try:
                det = json.loads(raw)
            except Exception:
                det = None
        out.append({'id': rec.get('record_id'), 'host': f.get('主播'),
                    'date': f.get('日期'), 'total': f.get('综合评分'), 'det': det})
    return out


def main():
    rows = load()
    print('记录总数 %d' % len(rows))
    have = [r for r in rows if r['det']]
    print('有「完整主播报告」且可解析 %d' % len(have))

    # 1) 报告里出现的所有键（看有没有 baseline / rawPen / rawBlk 可用）
    keyset = {}
    for r in have:
        for k in r['det'].keys():
            keyset[k] = keyset.get(k, 0) + 1
    print('\n[报告顶层字段出现次数]')
    for k, v in sorted(keyset.items(), key=lambda x: -x[1]):
        print('  %-14s %d' % (k, v))

    # 2) mods / stds 的字段形态
    mkeys, skeys = {}, {}
    for r in have:
        for m in (r['det'].get('mods') or []):
            for k in m.keys():
                mkeys[k] = mkeys.get(k, 0) + 1
            for s in (m.get('stds') or []):
                for k in s.keys():
                    skeys[k] = skeys.get(k, 0) + 1
    print('\n[mods 元素字段] ', sorted(mkeys.items(), key=lambda x: -x[1]))
    print('[stds 元素字段] ', sorted(skeys.items(), key=lambda x: -x[1]))

    # 3) 有没有 baseline 的痕迹（基准库错误 N 处 / errorItems / baselineResult）
    txt = json.dumps([r['det'] for r in have], ensure_ascii=False)
    for probe in ['基准库错误', 'baseline', 'errorItems', 'baselineResult', '信息准确性', 'rawTotal', 'rawPen', 'rawBlk']:
        print('  探针 %-14s 出现 %d 次' % (probe, txt.count(probe)))

    # 4) 量化：有 rawTotal 的记录里，Σ weighted 与 真实原分 差多少
    print('\n[有 rawTotal 的记录：反推 vs 精确]')
    exact_rows = [r for r in have if isinstance(r['det'].get('rawTotal'), (int, float))]
    print('  rawTotal 存在 %d 条' % len(exact_rows))
    hi = []
    for r in exact_rows:
        det = r['det']
        mods = det.get('mods') or []
        sum_w = 0.0
        sum_raw = 0.0
        for m in mods:
            w = m.get('weight') or 0
            if w > 0:
                if isinstance(m.get('weighted'), (int, float)):
                    sum_w += m['weighted']
                sum_raw += (m.get('score') or 0) * w / 100.0
        sum_w, sum_raw = r1(sum_w), r1(sum_raw)
        rt = det.get('rawTotal')
        pen = det.get('rawPen')
        blk = det.get('rawBlk')
        hi.append((r, sum_w, sum_raw, rt, pen, blk))
        print('  %-8s %s  total=%s rawTotal=%s rawPen=%s rawBlk=%s | Σweighted=%s Σraw=%s | Σw-rawTotal=%s'
              % (r['host'], r['date'], r['total'], rt, pen, blk, sum_w, sum_raw, r1(sum_w - rt)))
    print('  ⇒ 差值集合（Σweighted − rawTotal）: %s'
          % sorted({r1(x[1] - x[3]) for x in hi if x[3] is not None}))

    # 5) 逐模块 round vs 一次 round：全表 154 条的量级
    print('\n[逐模块 round 与一次性 round 的漂移（全表走反推的记录）]')
    drifts = []
    for r in have:
        mods = r['det'].get('mods') or []
        sw = sr = 0.0
        for m in mods:
            w = m.get('weight') or 0
            if w > 0:
                if isinstance(m.get('weighted'), (int, float)):
                    sw += m['weighted']
                sr += (m.get('score') or 0) * w / 100.0
        drifts.append(r1(r1(sw) - r1(sr)))
    import collections
    c = collections.Counter(drifts)
    print('  分布（Σweighted − Σraw，保留 0.1）:')
    for k in sorted(c):
        print('    %+5.1f  %d 条' % (k, c[k]))
    print('  最大正漂移 %+.1f / 最大负漂移 %+.1f / 非零占比 %.0f%%'
          % (max(drifts), min(drifts), 100.0 * sum(1 for d in drifts if d != 0) / len(drifts)))


if __name__ == '__main__':
    main()
