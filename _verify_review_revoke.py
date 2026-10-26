# -*- coding: utf-8 -*-
"""
_verify_review_revoke.py —— 只读回验：16 行补分是否真的落地
逐条 GET 回读，核 4 件事：
  ① 「综合评分」== 计划里的目标值（且不再是 0）
  ② 「误判内容」含本次留痕（✅ 人工复核判定「不违规」）
  ③ 「复核违规」仍是「否」（没有被误改成别的）
  ④ 全表「仍按 0 计」的行数变化（盘面）
安全：只发 GET。
"""
import io
import json
import os
import sys
import urllib.request

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

    plan_txt = io.open(os.path.join(HERE, '_apply_review_revoke.plan.txt'), encoding='utf-8').read()
    # 从演练清单恢复"期望值"
    expect = {}
    for line in plan_txt.splitlines():
        if '总分 0 →' in line:
            parts = line.strip().split('.', 1)
            if len(parts) < 2:
                continue
            body = parts[1]
            toks = body.split()
            # 形如: 王金鸽 2026-10-12 总分 0 → 50 （违规项分 50（精确））
            try:
                host, date = toks[0], toks[1]
                arrow = toks.index('→')
                want = toks[arrow + 1]
                expect[(date, host)] = want
            except Exception:
                continue

    bykey = {}
    for rec in recs:
        f = rec.get('fields') or {}
        host = txt(f.get('主播')).strip()
        dv = f.get('日期')
        # 日期是 DateTime；标准日期公式列更省事
        sd = txt(f.get('标准日期')).strip()[:10]
        if not sd:
            try:
                n = int(dv)
                import datetime
                if n > 1e12:
                    n = n / 1000.0
                sd = datetime.datetime.fromtimestamp(n + 8 * 3600, datetime.timezone.utc).strftime('%Y-%m-%d')
            except Exception:
                sd = ''
        bykey[(sd, host)] = {
            'total': txt(f.get('综合评分')).strip(),
            'raw': txt(f.get('未记录 违规-综合评分')).strip(),
            'v2': txt(f.get('复核违规')).strip(),
            'wrong': txt(f.get('误判内容')).strip(),
            'rl': txt(f.get('命中平台红线 —— 本场总分按 0 计')).strip(),
        }

    print('=== 逐条回验（表内 %d 条记录）===' % len(recs))
    print('  %-11s %-6s %-8s %-8s %-6s %-8s %s' % ('日期', '主播', '现值', '期望', '复核', '留痕', '结果'))
    ok = bad = 0
    for (date, host), want in sorted(expect.items()):
        cur = bykey.get((date, host))
        if not cur:
            print('  %-11s %-6s  表内找不到该行' % (date, host))
            bad += 1
            continue
        got = cur['total']
        num_ok = (got == want)
        v2_ok = (cur['v2'] == '否')
        note_ok = ('人工复核判定' in cur['wrong'])
        allok = num_ok and v2_ok and note_ok
        if allok:
            ok += 1
        else:
            bad += 1
        print('  %-11s %-6s %-8s %-8s %-6s %-8s %s%s%s'
              % (date, host, got, want, cur['v2'] or '·',
                 '有' if note_ok else '无',
                 '✓' if allok else '✗',
                 '' if num_ok else ' 分不符',
                 '' if v2_ok else ' 复核列被改'))
    print()
    print('  ⇒ 通过 %d / %d；异常 %d' % (ok, len(expect), bad))

    # 盘面：复核=否 且 仍按0计
    no = []
    for rec in recs:
        f = rec.get('fields') or {}
        if txt(f.get('复核违规')).strip() != '否':
            continue
        host = txt(f.get('主播')).strip()
        rl = txt(f.get('命中平台红线 —— 本场总分按 0 计')).strip()
        an = txt(f.get('已标注（不判 0 分）')).strip()
        tot = txt(f.get('综合评分')).strip()
        no.append({'host': host, 'rl': rl, 'an': an, 'total': tot})
    zero_now = [x for x in no if '按 0 计' in x['rl']]
    print()
    print('=== 盘面（复核=否 共 %d 行）===' % len(no))
    print('  仍「按 0 计」标签的行   : %d' % len(zero_now))
    print('  其中总分确实还是 0 的行 : %d' % sum(1 for x in zero_now if x['total'] in ('0', '0.0', '0.00')))
    print('  总分已非 0 的行         : %d' % sum(1 for x in no if x['total'] not in ('0', '0.0', '0.00', '')))
    return 0 if bad == 0 else 6


if __name__ == '__main__':
    sys.exit(main())
