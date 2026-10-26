# -*- coding: utf-8 -*-
"""
_audit_review_by_v2.py —— 只读：按老大新口径统计误判
口径（老大 10-26 14:2x 明确）：
  · 复核违规 =「是」 ⇒ 复核认定确有违规，没有误判
  · 复核违规 =「否」 ⇒ 复核认定原判不成立，需看「误判内容」确认误判了哪些
安全：只发 GET，不写飞书一个字节。
"""
import io, json, os, sys, datetime, re, urllib.request
from collections import Counter, defaultdict

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
            'host': txt(f.get('主播')).strip(),
            'date': date_of(f.get('日期')),
            'v1': txt(f.get('初审违规')).strip(),      # 初审
            'v2': txt(f.get('复核违规')).strip(),      # 复核  ← 权威列
            'wrong': txt(f.get('误判内容')).strip(),
            'rl': txt(f.get('命中平台红线 —— 本场总分按 0 计')).strip(),
            'an': txt(f.get('已标注（不判 0 分）')).strip(),
            'total': txt(f.get('综合评分')).strip(),
            'legal': txt(f.get('疑似违规话术')).strip(),
        })

    print('=== 0. 全表 %d 行 ===' % len(rows))

    print('\n=== 1. 「复核违规」取值分布（权威列）===')
    for k, v in sorted(Counter(r['v2'] or '(空)' for r in rows).items()):
        print('  %-6s %d' % (k, v))

    print('\n=== 2. 初审 × 复核 交叉（看复核有没有推翻初审）===')
    cross = Counter((r['v1'] or '空', r['v2'] or '空') for r in rows)
    print('  %-6s %-6s %s' % ('初审', '复核', '行数'))
    for (a, b), n in sorted(cross.items()):
        print('  %-6s %-6s %d' % (a, b, n))

    # ---- 核心：复核=否 就是误判 ----
    no = [r for r in rows if r['v2'] == '否']
    yes = [r for r in rows if r['v2'] == '是']

    print('\n=== 3. 复核=「否」= 认定误判：%d 行 ===' % len(no))

    def has_trace(r):
        return bool(r['rl']) or bool(r['an'])

    with_trace = [r for r in no if has_trace(r)]
    no_trace = [r for r in no if not has_trace(r)]
    print('  ├ AI 侧有违规痕迹（才是真误判）: %d 行' % len(with_trace))
    print('  └ AI 侧本来就无痕迹（不算误判）: %d 行' % len(no_trace))
    print('  ├ 「误判内容」已填写: %d 行' % sum(1 for r in no if r['wrong']))
    print('  └ 「误判内容」为空:   %d 行' % sum(1 for r in no if not r['wrong']))

    print('\n=== 4. 复核=「是」的行里，「误判内容」是否也填了（列名语义验证）===')
    yes_filled = [r for r in yes if r['wrong']]
    print('  复核=是 共 %d 行，其中「误判内容」非空 %d 行' % (len(yes), len(yes_filled)))
    if yes_filled:
        print('  ⚠ 说明该列并非只记误判，也记了正常命中的原文。样例：')
        for r in yes_filled[:3]:
            print('     %s %-5s 「%s」' % (r['date'], r['host'], r['wrong'][:70]))

    print('\n=== 5. 复核=否 逐行清单（%d 行）===' % len(no))
    for r in sorted(no, key=lambda x: x['date']):
        tag = 'A_仍按0计' if '按 0 计' in r['rl'] else ('C_已撤销' if '已撤销' in r['rl']
              else ('B_仅标注' if r['an'] else 'D_无痕迹'))
        print('  %s %-5s %-8s 总分=%-6s' % (r['date'], r['host'], tag, r['total'] or '·'))
        print('      误判内容: %s' % (r['wrong'][:150] or '(空)'))

    print('\n=== 6. 复核=否 且 AI 有痕迹 = 真误判 %d 行，按主播 ===' % len(with_trace))
    for k, v in Counter(r['host'] for r in with_trace).most_common():
        print('  %-6s %d' % (k, v))

    print('\n=== 7. 复核=否 但 AI 无痕迹 %d 行（这 %d 行 AI 本来就判不违规，不存在"误判"）==='
          % (len(no_trace), len(no_trace)))
    for r in sorted(no_trace, key=lambda x: x['date'])[:10]:
        print('  %s %-5s 总分=%-6s 误判内容=%s' % (r['date'], r['host'], r['total'] or '·', r['wrong'][:40] or '(空)'))

    # 落盘
    out = os.path.join(HERE, '_bak', 'misjudge_by_v2.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, 'w', encoding='utf-8') as f:
        json.dump({'total': len(rows), 'v2_no': no, 'v2_yes_count': len(yes)},
                  f, ensure_ascii=False, indent=1)
    print('\n落盘: _bak/misjudge_by_v2.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
