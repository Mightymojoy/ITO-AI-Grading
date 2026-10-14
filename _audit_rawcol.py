# -*- coding: utf-8 -*-
"""
_audit_rawcol.py —— 只读审计：已写入的「未记录 违规-综合评分」值现在还对不对？

起因：15:29 的回填演练发现 10-13 的「综合评分」与 15:0x 的快照对不上（程都兰 0→69、毕政扬 53→64.5 …）
      ⇒ 表在动（有场次被重新评分）。若重评发生在回填之后，飞书里那一格就是**过期值**。
      必须先量出"79 条已有值里有多少条已经过期"，再决定怎么写。

判据（对每条"已有值"的记录）：
  ① 无「完整主播报告」            → 无法复核（列出）
  ② 报告里算不出值                → 无法复核（列出）
  ③ 复算值 == 当前列值            → ✅ 一致（未过期）
  ④ 复算值 != 当前列值            → 🔴 过期（列出 现值 → 应为）
同时标注：该条**现在**是否还处于「整场归零」（综合评分 == 0）。

安全：**只发 GET**，不发任何写请求。
"""
import io, json, math, os, sys, urllib.request

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


def js_round(x):
    return math.floor(x + 0.5) if x >= 0 else -math.floor(-x + 0.5)


def fmt_num(x):
    return str(int(x)) if x == int(x) else str(x)


def txt(v):
    if isinstance(v, list):
        return ''.join(s.get('text', '') if isinstance(s, dict) else str(s) for s in v)
    return '' if v is None else str(v)


def blk_of(j):
    v = j.get('rawBlk')
    if isinstance(v, bool):
        v = None
    if isinstance(v, (int, float)):
        return int(v)
    b = j.get('baseline')
    if isinstance(b, dict):
        e = b.get('errors')
        if isinstance(e, (int, float)) and not isinstance(e, bool):
            return int(e)
    ex = j.get('extra')
    if isinstance(ex, dict):
        bl = ex.get('bl')
        if isinstance(bl, dict):
            e = bl.get('errs')
            if isinstance(e, (int, float)) and not isinstance(e, bool):
                return int(e)
    return None


def raw_score(j):
    rt = j.get('rawTotal')
    if isinstance(rt, bool):
        rt = None
    blk = blk_of(j)
    pen = min(12, blk * 4) if blk is not None else None
    if isinstance(rt, (int, float)):
        t, exact = float(rt), True
    else:
        mods = j.get('mods') or j.get('modules') or []
        s, has = 0.0, False
        for m in mods:
            if not isinstance(m, dict):
                continue
            if (m.get('weight') or 0) > 0 and isinstance(m.get('weighted'), (int, float)) \
                    and not isinstance(m.get('weighted'), bool):
                s += float(m['weighted']); has = True
        if not has:
            return None
        t, exact = (s - pen, True) if pen is not None else (s, False)
    tot = js_round(t * 10) / 10
    if tot < 0:
        tot = 0
    return tot, exact


def main():
    env = load_env(os.path.join(HERE, '.env'))
    auth = http_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                     method='POST', body={'app_id': env['FEISHU_APP_ID'],
                                          'app_secret': env['FEISHU_APP_SECRET']})
    if auth.get('code') != 0:
        print('!! 鉴权失败'); return 2
    hdr = {'Authorization': 'Bearer ' + auth['tenant_access_token']}
    base = env['FEISHU_BASE_TOKEN']

    recs, pt = [], ''
    while True:
        u = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=200'
             % (base, TABLE_ID)) + (('&page_token=' + pt) if pt else '')
        r = http_json(u, headers=hdr)
        if r.get('code') != 0:
            print('!! 拉取失败: %s' % r.get('msg')); return 2
        d = r.get('data') or {}
        recs.extend(d.get('items') or [])
        if not d.get('has_more'):
            break
        pt = d.get('page_token') or ''
        if not pt:
            break

    filled = ok = stale = noreport = nocalc = 0
    stale_list, noreport_list = [], []
    zero_now = 0
    for rec in recs:
        f = rec.get('fields') or {}
        cur = txt(f.get(COL)).strip()
        if not cur:
            continue
        filled += 1
        host, date = txt(f.get('主播')), txt(f.get('日期'))[:10]
        total = txt(f.get('综合评分')).strip()
        is_zero = total in ('0', '0.0', '0.00')
        if is_zero:
            zero_now += 1
        rep = txt(f.get('完整主播报告'))
        if not rep:
            noreport += 1
            noreport_list.append((host, date, cur, total, '无报告'))
            continue
        try:
            j = json.loads(rep)
        except Exception:
            noreport += 1
            noreport_list.append((host, date, cur, total, '报告非 JSON'))
            continue
        rs = raw_score(j)
        if rs is None:
            nocalc += 1
            noreport_list.append((host, date, cur, total, '报告里无可反推模块'))
            continue
        v, e = rs
        want = fmt_num(v) + ('（精确）' if e else '（上限值）')
        if want == cur:
            ok += 1
        else:
            stale += 1
            stale_list.append((host, date, cur, want, total))

    print('表内记录 %d 条；该列【已有值】%d 条' % (len(recs), filled))
    print('  其中现在仍「综合评分 == 0」（整场归零）的：%d 条' % zero_now)
    print()
    print('===== 审计结果 =====')
    print('  ✅ 复核一致（未过期）      ：%d 条' % ok)
    print('  🔴 复算不符（**已过期**）  ：%d 条' % stale)
    print('  ⚪ 无报告 / 算不出（待定） ：%d 条' % (noreport + nocalc))
    print()
    if stale_list:
        print('  —— 🔴 已过期清单（现值 → 按当前报告应为）——')
        for i, (h, d, c, w, t) in enumerate(stale_list, 1):
            print('  %3d. %-6s %s  现值=%-14s 应为=%-14s （当前综合评分=%s）' % (i, h, d, c, w, t))
    if noreport_list:
        print()
        print('  —— ⚪ 无法复核清单（%d 条）——' % len(noreport_list))
        for i, (h, d, c, t, why) in enumerate(noreport_list, 1):
            print('  %3d. %-6s %s  现值=%-14s 综合评分=%-6s ← %s' % (i, h, d, c, t, why))

    out = os.path.join(HERE, '_bak', '_audit_rawcol.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, 'w', encoding='utf-8') as fp:
        json.dump({'filled': filled, 'ok': ok, 'stale': stale, 'noreport': noreport,
                   'nocalc': nocalc, 'stale_list': stale_list,
                   'noreport_list': noreport_list}, fp, ensure_ascii=False, indent=1)
    print()
    print('明细 → %s' % out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
