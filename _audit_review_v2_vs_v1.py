# -*- coding: utf-8 -*-
"""
_audit_review_v2_vs_v1.py —— 只读：比对「复核=否」与「初审=否」两个误判集是否同一批
"""
import io, os, sys, json, datetime, urllib.request
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
            'host': txt(f.get('主播')).strip(), 'date': date_of(f.get('日期')),
            'v1': txt(f.get('初审违规')).strip(), 'v2': txt(f.get('复核违规')).strip(),
            'wrong': txt(f.get('误判内容')).strip(),
            'rl': txt(f.get('命中平台红线 —— 本场总分按 0 计')).strip(),
            'an': txt(f.get('已标注（不判 0 分）')).strip(),
            'total': txt(f.get('综合评分')).strip()})

    def trace(r):
        return bool(r['rl']) or bool(r['an'])

    A = set((r['date'], r['host']) for r in rows if r['v2'] == '否' and trace(r))
    B = set((r['date'], r['host']) for r in rows if r['v1'] == '否' and trace(r))
    print('复核=否 & AI有痕迹 : %d 行  ← 新口径（权威）' % len(A))
    print('初审=否 & AI有痕迹 : %d 行  ← 我上一轮用的口径' % len(B))
    print('两集完全相同 : %s' % (A == B))
    if A != B:
        print('\n只在复核口径里（初审非否或初审空）%d 行：' % len(A - B))
        for k in sorted(A - B):
            print('   ', k)
        print('\n只在初审口径里（复核非否或复核空）%d 行：' % len(B - A))
        for k in sorted(B - A):
            r = next(x for x in rows if (x['date'], x['host']) == k)
            print('    %s %-5s 初审=%s 复核=%s 总分=%s' % (k[0], k[1], r['v1'] or '空', r['v2'] or '空', r['total']))

    print('\n=== 7 行「初审=否 但 复核空」明细 ===')
    for r in sorted([x for x in rows if x['v1'] == '否' and x['v2'] == ''], key=lambda x: x['date']):
        print('   %s %-5s AI痕迹=%s 总分=%-6s 误判内容=%s'
              % (r['date'], r['host'], '有' if trace(r) else '无', r['total'] or '·',
                 (r['wrong'][:44] or '(空)')))

    print('\n=== 43 行误判按日期分布 ===')
    for k, v in sorted(Counter(k[0] for k in A).items()):
        print('   %s  %d' % (k, v))
    return 0


if __name__ == '__main__':
    sys.exit(main())
