# -*- coding: utf-8 -*-
"""
_probe_daily_now.py —— 只读探针：拉飞书「主播日报」全量，与 15:0x 的旧快照逐行对比

起因：v4.11.40 回填演练（15:29）里 10-13 的「综合评分」与 `_bak/_fs_daily_now.json`（15:0x 导出）对不上
      （演练：毕政扬 64.5 / 曲姝锜 53 / 王金鸽 67；旧快照：毕政扬 53 / 曲姝锜 57 / 王金鸽 61.5）。
      必须弄清是「表被改过」还是「两个脚本读的不是同一个字段」。

安全：**只发 GET**，不发任何 POST/PUT/PATCH/DELETE。
"""
import io, json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TABLE_ID = 'tblQC7Jfzmxp6QJI'
COL = '未记录 违规-综合评分'


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


def main():
    env = load_env(os.path.join(HERE, '.env'))
    auth = http_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                     method='POST', body={'app_id': env['FEISHU_APP_ID'],
                                          'app_secret': env['FEISHU_APP_SECRET']})
    if auth.get('code') != 0:
        print('!! 鉴权失败: ' + str(auth.get('msg'))); return 2
    token = auth['tenant_access_token']
    hdr = {'Authorization': 'Bearer ' + token}
    base = env['FEISHU_BASE_TOKEN']

    # 字段清单（看看到底有几列跟"评分"相关）
    rf = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/fields?page_size=200'
                   % (base, TABLE_ID), headers=hdr)
    fields = (rf.get('data') or {}).get('items') or []
    print('列清单（%d 列）——含「评分」二字的：' % len(fields))
    for f in fields:
        if '评分' in (f.get('field_name') or '') or '综合' in (f.get('field_name') or ''):
            print('   %-28s type=%s  field_id=%s' % (f.get('field_name'), f.get('type'), f.get('field_id')))

    # 全量记录
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

    rows = []
    for rec in recs:
        f = rec.get('fields') or {}
        def txt(v):
            if isinstance(v, list):
                return ''.join(s.get('text', '') if isinstance(s, dict) else str(s) for s in v)
            return '' if v is None else str(v)
        rows.append({'record_id': rec.get('record_id'), '主播': txt(f.get('主播')),
                     '日期': txt(f.get('日期'))[:10], '综合评分': txt(f.get('综合评分')),
                     '综合评分(数值)': txt(f.get('综合评分(数值)')), COL: txt(f.get(COL))})

    out = os.path.join(HERE, '_bak', '_fs_daily_now2.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, 'w', encoding='utf-8') as fp:
        json.dump({'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'rows': rows}, fp, ensure_ascii=False, indent=1)
    print('当前快照 → %s' % out)

    # ---- 与旧快照对比 ----
    old_p = os.path.join(HERE, '_bak', '_fs_daily_now.json')
    old_rows = []
    if os.path.exists(old_p):
        od = json.load(io.open(old_p, encoding='utf-8'))
        old_rows = od if isinstance(od, list) else (od.get('rows') or [])
        print('旧快照 → %s（%d 行）' % (old_p, len(old_rows)))

    def key(r):
        return (r.get('主播') or '', (r.get('日期') or '')[:10])

    om = {}
    for r in old_rows:
        om[key(r)] = r
    diff = []
    for r in rows:
        o = om.get(key(r))
        if not o:
            diff.append(('新增行', r)) if False else diff.append(('新增行', r))
        elif str(o.get('综合评分')) != str(r.get('综合评分')):
            diff.append(('综合评分变了', r, o))
    print('\n===== 与旧快照的差异（按 主播+日期 匹配）=====')
    print('  变化条数：%d' % len(diff))
    for x in diff[:20]:
        if x[0] == '新增行':
            r = x[1]
            print('  + %s  %s  综合评分=%s' % (r['主播'], r['日期'], r['综合评分']))
        else:
            r, o = x[1], x[2]
            print('  ~ %s %s  综合评分 %s → %s' % (r['主播'], r['日期'], o.get('综合评分'), r['综合评分']))

    print('\n===== 2026-10-13 全部行（按表内顺序）=====')
    n = 0
    for r in rows:
        if r['日期'] == '2026-10-13':
            n += 1
            print('  %2d. %-6s 综合评分=%-6s 数值列=%-6s 本列=%r'
                  % (n, r['主播'], r['综合评分'], r['综合评分(数值)'], r[COL]))
    print('  共 %d 行' % n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
