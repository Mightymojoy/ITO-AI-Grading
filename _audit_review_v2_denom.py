# -*- coding: utf-8 -*-
"""
_audit_review_v2_denom.py —— 只读：按复核列口径算准确分母 + 找潜漏检
口径：复核=是 → 无违规（或确违规无争议）；复核=否 → 看误判内容确认误判
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
            'v2': txt(f.get('复核违规')).strip(), 'wrong': txt(f.get('误判内容')).strip(),
            'rl': txt(f.get('命中平台红线 —— 本场总分按 0 计')).strip(),
            'an': txt(f.get('已标注（不判 0 分）')).strip(),
            'total': txt(f.get('综合评分')).strip()})

    def trace(r):
        return bool(r['rl']) or bool(r['an'])

    print('=== A. AI 侧痕迹 vs 复核取值（%d 行）===' % len(rows))
    print('  %-8s %-6s %s' % ('复核', 'AI痕迹', '行数'))
    for (v2, t), n in sorted(Counter((r['v2'] or '空', '有' if trace(r) else '无') for r in rows).items()):
        print('  %-8s %-6s %d' % (v2, t, n))

    ai = [r for r in rows if trace(r)]
    ai_rev = [r for r in ai if r['v2'] in ('是', '否')]
    ai_no = [r for r in ai if r['v2'] == '否']
    print('\n=== B. 误判率（按复核列口径）===')
    print('  AI 判过违规/标注的场次        : %d' % len(ai))
    print('  ├ 已复核（复核=是/否）        : %d' % len(ai_rev))
    print('  │   ├ 复核=是（确认违规，无争议）: %d' % sum(1 for r in ai_rev if r['v2'] == '是'))
    print('  │   └ 复核=否（= 误判）        : %d' % len(ai_no))
    print('  └ 未复核（复核为空）          : %d' % (len(ai) - len(ai_rev)))
    if ai_rev:
        print('  ⇒ 误判率 = %d / %d = %.1f%%' % (len(ai_no), len(ai_rev), 100.0 * len(ai_no) / len(ai_rev)))

    print('\n=== C. 复核=是 但 AI 无痕迹 = 漏检（AI 没判，人判违规）===')
    miss = [r for r in rows if r['v2'] == '是' and not trace(r)]
    print('  %d 行' % len(miss))
    for r in sorted(miss, key=lambda x: x['date'])[:10]:
        print('   %s %-5s 总分=%-6s' % (r['date'], r['host'], r['total'] or '·'))

    print('\n=== D. 复核=否 的 68 行：误判内容 有/无 与总分状态 ===')
    def state(r):
        if '已撤销' in r['rl']:
            return 'C_已撤销'
        if '按 0 计' in r['rl']:
            return 'A_仍按0计'
        return 'B_仅标注' if r['an'] else 'D_无痕迹'
    for (w, s), n in sorted(Counter(('有内容' if r['wrong'] else '无内容', state(r))
                                    for r in rows if r['v2'] == '否').items()):
        print('  %-8s %-8s %d' % (w, s, n))

    print('\n=== E. 未复核且有 AI 痕迹（待复核工作量）===')
    pend = [r for r in ai if r['v2'] == '']
    print('  %d 行；其中仍按 0 计 %d 行' % (len(pend), sum(1 for r in pend if '按 0 计' in r['rl'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
