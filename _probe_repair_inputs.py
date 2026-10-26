# -*- coding: utf-8 -*-
"""
_probe_repair_inputs.py —— 只读探针：评估「16 行补分」与「复核=是 重跑」的可行性
目的：
  A. 16 行（复核=否 + AI有痕迹 + 仍按0计）能否算回真实分数？
     → 查「未记录 违规-综合评分」列有没有值、「完整主播报告」够不够长
  B. 复核=是 的 73 行能否用新规则重跑？
     → 查「误判内容」「违规话术」「完整主播报告」三列的内容量
安全：只发 GET，不写飞书一个字节。
"""
import io, json, os, sys, datetime, re, urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
TABLE_ID = 'tblQC7Jfzmxp6QJI'


def load_env(p):
    d = {}
    with io.open(p, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            d[k.strip()] = v.strip().strip('"').strip("'")
    return d


def http_json(url, method='GET', body=None, headers=None, timeout=90):
    h = {'Content-Type': 'application/json; charset=utf-8'}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def txt(v):
    if isinstance(v, list):
        return ''.join(s.get('text', '') if isinstance(s, dict) else str(s) for s in v)
    if isinstance(v, bool):
        return '是' if v else '否'
    return '' if v is None else str(v)


def date_of(v):
    if v is None:
        return ''
    if isinstance(v, list):
        v = v[0] if v else None
        if isinstance(v, dict):
            v = v.get('value') or v.get('text')
    try:
        n = int(v)
    except Exception:
        return str(v)[:10]
    if n > 1e12:
        n = n / 1000.0
    return datetime.datetime.fromtimestamp(n + 8 * 3600, datetime.timezone.utc).strftime('%Y-%m-%d')


def main():
    env = load_env(os.path.join(HERE, '.env'))
    auth = http_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                     method='POST', body={'app_id': env['FEISHU_APP_ID'],
                                          'app_secret': env['FEISHU_APP_SECRET']})
    hdr = {'Authorization': 'Bearer ' + auth['tenant_access_token']}
    base = env['FEISHU_BASE_TOKEN']
    recs, pt = [], ''
    while True:
        u = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=200'
             % (base, TABLE_ID)) + (('&page_token=' + pt) if pt else '')
        r = http_json(u, headers=hdr)
        d = r.get('data') or {}
        recs.extend(d.get('items') or [])
        if not d.get('has_more'):
            break
        pt = d.get('page_token') or ''
        if not pt:
            break

    rows = []
    for rec in recs:
        f = rec.get('fields') or {}
        rows.append({
            'rid': rec.get('record_id'),
            'host': txt(f.get('主播')).strip(),
            'date': date_of(f.get('日期')),
            'v1': txt(f.get('初审违规')).strip(),
            'v2': txt(f.get('复核违规')).strip(),
            'wrong': txt(f.get('误判内容')).strip(),
            'rl': txt(f.get('命中平台红线 —— 本场总分按 0 计')).strip(),
            'an': txt(f.get('已标注（不判 0 分）')).strip(),
            'total': txt(f.get('综合评分')).strip(),
            'raw': txt(f.get('未记录 违规-综合评分')).strip(),   # ← 补分的候选真值
            'legal': txt(f.get('违规话术')).strip(),
            'report': txt(f.get('完整主播报告')).strip(),
        })

    def has_trace(r):
        return bool(r['rl']) or bool(r['an'])

    zero = [r for r in rows if r['v2'] == '否' and has_trace(r) and '按 0 计' in r['rl']]
    yes = [r for r in rows if r['v2'] == '是']

    print('=== A. 待补分 16 行（复核=否 + AI有痕迹 + 仍按0计）===')
    print('  实测行数: %d' % len(zero))
    print('  %-11s %-5s %-7s %-8s %-9s %-7s %-7s' % ('日期', '主播', '总分', '违规项分', '报告字数', '误判内容', '违规话术'))
    has_raw = 0
    for r in sorted(zero, key=lambda x: x['date']):
        flag = ''
        if r['raw']:
            has_raw += 1
            flag = ' ★有真值'
        print('  %-11s %-5s %-7s %-8s %-9d %-7d %-7d%s' % (
            r['date'], r['host'], r['total'] or '·', r['raw'] or '·',
            len(r['report']), len(r['wrong']), len(r['legal']), flag))
    print('  ├ 「未记录 违规-综合评分」有值: %d / %d' % (has_raw, len(zero)))
    print('  └ 「完整主播报告」字数: 中位 %d，最长 %d，>2000字 %d 行' % (
        sorted(len(r['report']) for r in zero)[len(zero) // 2] if zero else 0,
        max((len(r['report']) for r in zero), default=0),
        sum(1 for r in zero if len(r['report']) > 2000)))

    print('\n=== B. 复核=「是」%d 行（人工确认违规）重跑可行性 ===' % len(yes))
    with_wrong = [r for r in yes if r['wrong']]
    with_legal = [r for r in yes if r['legal']]
    with_rep = [r for r in yes if len(r['report']) > 2000]
    print('  ├ 「误判内容」非空（内含命中原文句）: %d / %d' % (len(with_wrong), len(yes)))
    print('  ├ 「违规话术」非空                 : %d / %d' % (len(with_legal), len(yes)))
    print('  └ 「完整主播报告」>2000 字（可整场重跑）: %d / %d' % (len(with_rep), len(yes)))
    if yes:
        arr = sorted(len(r['report']) for r in yes)
        print('    报告字数: 中位 %d，最长 %d' % (arr[len(arr) // 2], arr[-1]))
        arr2 = sorted(len(r['legal']) for r in yes)
        print('    违规话术字数: 中位 %d，最长 %d' % (arr2[len(arr2) // 2], arr2[-1]))

    print('\n=== C. 「完整主播报告」列是否被截断（记忆说只留前 400 字）===')
    allr = [len(r['report']) for r in rows if r['report']]
    if allr:
        arr = sorted(allr)
        print('  非空 %d 行；中位 %d；P90 %d；最长 %d' % (
            len(allr), arr[len(arr) // 2], arr[int(len(arr) * 0.9)], arr[-1]))
        print('  ≤420 字的行数: %d （若绝大多数都 ≤420 ⇒ 确实被截断，不能用于重跑）'
              % sum(1 for x in allr if x <= 420))

    print('\n=== D. 未复核 93 行（AI有痕迹）现状 ===')
    pend = [r for r in rows if r['v2'] == '' and has_trace(r)]
    print('  实测: %d 行；其中仍按 0 计 %d 行' % (
        len(pend), sum(1 for r in pend if '按 0 计' in r['rl'])))
    print('  「违规话术」非空 %d 行；「完整主播报告」>2000字 %d 行' % (
        sum(1 for r in pend if r['legal']), sum(1 for r in pend if len(r['report']) > 2000)))

    out = os.path.join(HERE, '_bak', 'repair_inputs.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, 'w', encoding='utf-8') as f:
        json.dump({'zero16': sorted(zero, key=lambda x: x['date']),
                   'yes': yes, 'pending93': pend}, f, ensure_ascii=False, indent=1)
    print('\n落盘: _bak/repair_inputs.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
