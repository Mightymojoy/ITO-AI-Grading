# -*- coding: utf-8 -*-
"""
只读核实：「未记录 违规-综合评分」列在飞书里当前的真实填写状态。

背景：`_backfill_rawcol.py --apply` 首次执行时进程被 SIGTERM 中断，
      stdout 是块缓冲 ⇒ 输出全丢 ⇒ **不知道写了多少条**。
      本脚本只发 GET，用来把真实状态查清楚（绝不发任何写请求）。

用法：
  python _check_rawcol_state.py
"""
import io
import json
import os
import sys
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
TABLE_ID = 'tblQC7Jfzmxp6QJI'
FIELD_ID = 'fldfcibJNi'
FIELD_NAME = '未记录 违规-综合评分'


def load_env(path):
    env = {}
    if not os.path.exists(path):
        return env
    for line in io.open(path, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def http_get(url, token, timeout=45):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    env = load_env(os.path.join(HERE, '.env'))
    app_id = env.get('FEISHU_APP_ID', '')
    app_secret = env.get('FEISHU_APP_SECRET', '')
    base = env.get('FEISHU_BASE_TOKEN', '')
    if not (app_id and app_secret and base):
        print('!! 凭证不全')
        return 2

    body = json.dumps({'app_id': app_id, 'app_secret': app_secret}).encode('utf-8')
    req = urllib.request.Request(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=45) as r:
        auth = json.loads(r.read().decode('utf-8'))
    if auth.get('code') != 0:
        print('!! 鉴权失败: %s' % auth.get('msg'))
        return 2
    token = auth['tenant_access_token']
    print('鉴权 OK（只读模式，本脚本不发任何 POST/PUT/PATCH/DELETE）')
    print()

    # 列定义
    rf = http_get('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/fields?page_size=200'
                  % (base, TABLE_ID), token)
    fields = (rf.get('data') or {}).get('items') or []
    hit = [f for f in fields if f.get('field_id') == FIELD_ID]
    if hit:
        print('列校验 OK：%r（type=%s）' % (hit[0].get('field_name'), hit[0].get('type')))
    else:
        print('!! 找不到 field_id=%s' % FIELD_ID)
    print()

    # 全量记录
    recs, page_token = [], ''
    while True:
        url = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=200'
               % (base, TABLE_ID))
        if page_token:
            url += '&page_token=' + page_token
        d = http_get(url, token)
        data = d.get('data') or {}
        recs.extend(data.get('items') or [])
        page_token = data.get('page_token') or ''
        if not page_token:
            break

    print('表内记录 %d 条' % len(recs))
    print()

    filled, empty, malformed = [], [], []
    for rec in recs:
        f = rec.get('fields') or {}
        host, date = f.get('主播'), f.get('日期')
        try:
            total = float(f.get('综合评分'))
        except (TypeError, ValueError):
            total = None
        v = f.get(FIELD_NAME)
        if isinstance(v, list):
            v = ''.join(str(x.get('text', x)) if isinstance(x, dict) else str(x) for x in v)
        if v is None or str(v).strip() == '':
            empty.append((host, date, total))
        else:
            s = str(v)
            if '（精确）' in s or '（上限值）' in s:
                filled.append((host, date, total, s))
            else:
                malformed.append((host, date, total, s))

    print('=' * 70)
    print('① 该列【已有值】：%d 条' % len(filled))
    print('=' * 70)
    for h, d, t, v in filled:
        print('   %-8s %-12s 综合评分=%-7s → %s' % (h, d, t, v))
    print()
    if malformed:
        print('=' * 70)
        print('② ⚠️ 有值但格式不带口径标记：%d 条（需人工看）' % len(malformed))
        print('=' * 70)
        for h, d, t, v in malformed:
            print('   %-8s %-12s 综合评分=%-7s → %r' % (h, d, t, v))
        print()
    print('=' * 70)
    print('③ 该列【仍为空】：%d 条' % len(empty))
    print('=' * 70)
    judged0 = [x for x in empty if x[2] == 0]
    notzero = [x for x in empty if x[2] is not None and x[2] != 0]
    unknown = [x for x in empty if x[2] is None]
    print('   其中综合评分=0（本应已回填）  ：%d 条' % len(judged0))
    for h, d, t in judged0:
        print('      · %-8s %-12s' % (h, d))
    print('   其中综合评分≠0（口径 A 留空）  ：%d 条' % len(notzero))
    print('   其中综合评分读不到            ：%d 条' % len(unknown))
    print()
    print('=' * 70)
    print('④ 汇总')
    print('=' * 70)
    print('   总记录 %d ＝ 已有值 %d ＋ 空 %d'
          % (len(recs), len(filled), len(empty)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
