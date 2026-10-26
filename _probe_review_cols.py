# -*- coding: utf-8 -*-
"""
_probe_review_cols.py —— 只读探针：查飞书「主播日报」表新增的「复核」相关列
安全：只发 GET。
"""
import io, json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TABLE_ID = 'tblQC7Jfzmxp6QJI'


def load_env(path):
    d = {}
    with io.open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            d[k.strip()] = v.strip().strip('"').strip("'")
    return d


def http_json(url, method='GET', body=None, headers=None, timeout=60):
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
        return 'true' if v else 'false'
    return '' if v is None else str(v)


def main():
    env = load_env(os.path.join(HERE, '.env'))
    auth = http_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                     method='POST', body={'app_id': env['FEISHU_APP_ID'],
                                          'app_secret': env['FEISHU_APP_SECRET']})
    if auth.get('code') != 0:
        print('!! 鉴权失败: ' + str(auth.get('msg'))); return 2
    hdr = {'Authorization': 'Bearer ' + auth['tenant_access_token']}
    base = env['FEISHU_BASE_TOKEN']

    rf = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/fields?page_size=200'
                   % (base, TABLE_ID), headers=hdr)
    fields = (rf.get('data') or {}).get('items') or []
    print('=== 主播日报 字段清单（共 %d 列，按返回顺序）===' % len(fields))
    for i, f in enumerate(fields, 1):
        nm = f.get('field_name') or ''
        print('%3d. type=%-2s id=%-14s %s' % (i, f.get('type'), f.get('field_id'), nm))

    print('\n=== 疑似「复核/误判/判定」相关列 ===')
    hits = []
    for f in fields:
        nm = f.get('field_name') or ''
        if any(k in nm for k in ('复核', '误判', '判定', '复审', '纠正')):
            hits.append(f)
            print('  * %-30s type=%s  field_id=%s' % (nm, f.get('type'), f.get('field_id')))
    if not hits:
        print('  （无）')

    recs, pt = [], ''
    while True:
        u = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=200'
             % (base, TABLE_ID)) + (('&page_token=' + pt) if pt else '')
        r = http_json(u, headers=hdr)
        if r.get('code') != 0:
            print('!! 拉取失败: ' + str(r.get('msg'))); return 2
        d = r.get('data') or {}
        recs.extend(d.get('items') or [])
        if not d.get('has_more'):
            break
        pt = d.get('page_token') or ''
        if not pt:
            break
    print('\n表内记录 %d 条' % len(recs))

    # keys 并集
    keys = set()
    for rec in recs:
        keys.update((rec.get('fields') or {}).keys())
    print('records 中出现过的字段名 %d 个' % len(keys))
    print('  复核类在 records 里的出现情况：')
    for f in hits:
        nm = f.get('field_name')
        n = sum(1 for rec in recs if nm in (rec.get('fields') or {}))
        print('    %-30s 出现在 %d/%d 行' % (nm, n, len(recs)))

    # 逐列值分布
    for f in hits:
        nm = f.get('field_name')
        vals = {}
        for rec in recs:
            v = (rec.get('fields') or {}).get(nm)
            s = txt(v)
            vals[s] = vals.get(s, 0) + 1
        print('\n--- 「%s」值分布 ---' % nm)
        for k, c in sorted(vals.items(), key=lambda x: -x[1])[:12]:
            show = k if len(k) <= 60 else k[:60] + '…'
            print('    %5d × %r' % (c, show))

    # 抽最近 8 行看全貌
    def dtxt(v):
        return txt(v)[:10]

    recs_sorted = sorted(recs, key=lambda r: dtxt((r.get('fields') or {}).get('日期')), reverse=True)
    print('\n=== 最新 8 行的复核相关字段 ===')
    for rec in recs_sorted[:8]:
        f = rec.get('fields') or {}
        print('  %s %-6s' % (dtxt(f.get('日期')), txt(f.get('主播'))))
        for f2 in hits:
            nm = f2.get('field_name')
            print('      %-24s = %r' % (nm, txt(f.get(nm))[:80]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
