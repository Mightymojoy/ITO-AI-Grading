# -*- coding: utf-8 -*-
"""
只读导出：把飞书「主播日报」表的**真实行**导成 JSON，供列序验证脚本注入使用。

为什么需要它：
  v4.11.39 要验的是「未记录 违规-综合评分」在**工作台表格里的落位」。
  最有说服力的验证 = 用**真实飞书行**（字段名与值都是真的）去渲染，而不是自造样例。
  工作台本地那份 data/daily.js 是 09-23 的静态快照（不含该列），拿不到。

安全：只发 GET（鉴权 + fields + records），**不发任何写请求**。
输出：_bak/_fs_daily_now.json（不进仓库提交；含真实业务数据，仅本地验用）

用法：python _dump_fs_daily.py
"""
import io
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TABLE_ID = 'tblQC7Jfzmxp6QJI'          # 主播日报
OUT = os.path.join(HERE, '_bak', '_fs_daily_now.json')


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


def flat(v):
    """飞书富文本字段可能是 [{text:...}] 数组 ⇒ 拍平成字符串（与前端取值口径一致）。"""
    if isinstance(v, list):
        return ''.join(str(x.get('text', x)) if isinstance(x, dict) else str(x) for x in v)
    return v


def main():
    env = load_env(os.path.join(HERE, '.env'))
    app_id, app_secret, base = env.get('FEISHU_APP_ID', ''), env.get('FEISHU_APP_SECRET', ''), env.get('FEISHU_BASE_TOKEN', '')
    if not (app_id and app_secret and base):
        print('!! 凭证不全（.env 缺 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BASE_TOKEN）')
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
    print('鉴权 OK（只读，不发任何写请求）')

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

    rows = []
    for rec in recs:
        f = rec.get('fields') or {}
        row = {}
        for k, v in f.items():
            v = flat(v)
            if isinstance(v, (int, float, str)) and not isinstance(v, bool):
                row[k] = v
            elif isinstance(v, bool):
                row[k] = v
            else:
                row[k] = json.dumps(v, ensure_ascii=False)
        rows.append(row)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8', newline='') as fh:
        json.dump({'table_id': TABLE_ID, 'count': len(rows), 'rows': rows}, fh, ensure_ascii=False, indent=1)

    keys = sorted({k for r in rows for k in r.keys()})
    newcol = [k for k in keys if '未记录' in k]
    filled = [r for r in rows if str(r.get(newcol[0], '')).strip()] if newcol else []
    print('导出 %d 条 → %s' % (len(rows), os.path.relpath(OUT, HERE)))
    print('字段名 %d 个；含「未记录」的列：%s' % (len(keys), newcol))
    print('该列有值的行数：%d' % len(filled))
    return 0


if __name__ == '__main__':
    sys.exit(main())
