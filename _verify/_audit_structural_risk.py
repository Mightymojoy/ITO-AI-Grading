# -*- coding: utf-8 -*-
"""
结构性风险体检：回答「不改数据源表，工作台后续会不会出问题」。

取证：
  A. 三张在用表的真实体量（行数 / 日期分布 / 增长速率）—— 走线上端点（前端真实通路）
  B. 字段类型分布（公式字段个数）—— 走飞书直连 GET /fields（线上端点只回列名，不给 type）
  C. 耗时随行数伸缩 —— 同一端点、不同 limit，各测 2 次取中位
铁律：耗时/条数一律现测；线性外推必须显式标注「外推，非实测」。
"""
import collections
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 铁律：飞书必绕平台代理
DEPLOYED = 'https://ito-ai-grading.vercel.app/api/feishu-read'
ENV = {}
for _line in open('.env', encoding='utf-8', errors='replace'):
    _line = _line.strip()
    if '=' in _line and not _line.startswith('#'):
        _k, _v = _line.split('=', 1)
        ENV[_k.strip()] = _v.strip()

TABLES = {
    'daily': ('tblQC7Jfzmxp6QJI', '主播日报'),
    'history': ('tblkN1e6yCtXl5bG', '历史评分'),
    'week': ('tbljvCsgMJF9efok', '周总结'),
    'month': ('tbl6LQrwRgnHcumu', '月总结'),
}


def post_json(url, body, headers=None, timeout=180, tries=3, tag=''):
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                     headers=dict({'Content-Type': 'application/json',
                                                   'User-Agent': 'ito-agent'}, **(headers or {})))
        t0 = time.time()
        try:
            r = OP.open(req, timeout=timeout)
            raw = r.read()
            return time.time() - t0, json.loads(raw.decode('utf-8')), len(raw)
        except urllib.error.HTTPError as e:
            return time.time() - t0, {'_http': e.code, '_body': e.read()[:300].decode('utf-8', 'replace')}, 0
        except Exception as e:
            last = '%s %s' % (type(e).__name__, e)
            time.sleep(2)
    return None, {'_err': last}, 0


def get_json(url, headers=None, timeout=120, tries=3):
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers=dict({'User-Agent': 'ito-agent'}, **(headers or {})))
        try:
            return json.loads(OP.open(req, timeout=timeout).read().decode('utf-8'))
        except Exception as e:
            last = '%s %s' % (type(e).__name__, e)
            time.sleep(2)
    return {'_err': last}


# ---------------- 飞书 token ----------------
dt, tok, _ = post_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                       {'app_id': ENV['FEISHU_APP_ID'], 'app_secret': ENV['FEISHU_APP_SECRET']})
TOKEN = (tok or {}).get('tenant_access_token')
BASE_TOKEN = ENV['FEISHU_BASE_TOKEN']
print('飞书 token: %s   base: %s' % ('OK' if TOKEN else 'FAIL ' + str(tok)[:120], BASE_TOKEN))
if not TOKEN:
    sys.exit(1)
FH = {'Authorization': 'Bearer ' + TOKEN}

print()
print('=' * 84)
print('A. 体量（线上端点 = 前端真实通路；omit 与前端一致）')
print('=' * 84)
growth = {}
for key in ['daily', 'history']:
    tid, label = TABLES[key]
    ts = []
    for _ in range(2):
        dt, j, size = post_json(DEPLOYED, {'action': 'records', 'key': key, 'limit': 2000,
                                           'omit': ['完整主播报告']})
        ts.append((dt, j, size))
    ts.sort(key=lambda x: (x[0] is None, x[0]))
    dt, j, size = ts[len(ts) // 2]
    if j.get('ok') is not True:
        print('  %-8s 失败 %s' % (label, str(j)[:160]))
        continue
    rows = j.get('rows') or []
    total_all = j.get('total_all')
    print('  %-8s 本次实回=%-4d  total_all=%-5s  %.1fs  %dKB  limited=%r'
          % (label, len(rows), total_all, dt, size // 1024, j.get('limited')))
    # 日期分布（日期字段可能是毫秒 or 字符串）
    cnt = collections.Counter()
    for r in rows:
        v = r.get('日期') or r.get('标准日期')
        if isinstance(v, (int, float)):
            cnt[datetime.datetime.fromtimestamp(v / 1000).strftime('%Y-%m-%d')] += 1
        elif isinstance(v, str) and len(v) >= 8:
            cnt[v.strip()[:10]] += 1
    if cnt:
        ds = sorted(cnt)
        print('           最早=%s  最晚=%s  覆盖 %d 天' % (ds[0], ds[-1], len(ds)))
        last14 = [(d, cnt[d]) for d in ds[-14:]]
        print('           最近14个有数据日: %s' % ', '.join('%s(%d)' % x for x in last14))
        # 按月
        mon = collections.Counter(d[:7] for d in ds for _ in range(cnt[d]))
        print('           按月: %s' % ', '.join('%s=%d' % (m, mon[m]) for m in sorted(mon)))
        # 增长速率：用最早→最晚跨度算
        d0 = datetime.date(*map(int, ds[0].split('-')))
        d1 = datetime.date(*map(int, ds[-1].split('-')))
        span = max(1, (d1 - d0).days + 1)
        rate = len(rows) / float(span)
        growth[key] = (len(rows), rate, span, ds[0], ds[-1])
        print('           跨度 %d 天 ⇒ 均值 %.2f 行/日（实测，非外推）' % (span, rate))
    print()

print('=' * 84)
print('B. 字段类型分布（飞书直连 GET /fields）')
print('=' * 84)
TYPES = {1: '多行文本', 2: '数字', 3: '单选', 4: '多选', 5: '日期', 7: '复选框',
         11: '人员', 13: '电话', 15: '超链接', 17: '附件', 18: '单向关联', 19: '查找引用',
         20: '公式', 21: '双向关联', 22: '地理位置', 23: '群组', 1001: '创建时间',
         1002: '最后更新时间', 1003: '创建人', 1004: '修改人', 1005: '自动编号'}
formula_info = {}
for key in ['daily', 'history', 'week', 'month']:
    tid, label = TABLES[key]
    url = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/fields?page_size=200'
           % (BASE_TOKEN, tid))
    j = get_json(url, FH)
    if j.get('code') != 0:
        print('  %-8s 失败 code=%s msg=%s' % (label, j.get('code'), str(j.get('msg'))[:100]))
        continue
    items = (j.get('data') or {}).get('items') or []
    tc = collections.Counter(f.get('type') for f in items)
    heavy = tc.get(20, 0) + tc.get(19, 0) + tc.get(21, 0) + tc.get(18, 0)
    formula_info[key] = (len(items), tc.get(20, 0), heavy)
    print('  %-8s 字段=%-3d 其中 公式=%-2d  查找/关联=%-2d  合计耗算=%-2d (%.0f%%)'
          % (label, len(items), tc.get(20, 0), tc.get(19, 0) + tc.get(21, 0) + tc.get(18, 0),
             heavy, 100.0 * heavy / max(1, len(items))))
    print('           类型: %s' % ', '.join('%s×%d' % (TYPES.get(t, 'type%s' % t), c)
                                          for t, c in tc.most_common(10)))
    if tc.get(20):
        fnames = [f.get('field_name') for f in items if f.get('type') == 20]
        print('           公式列: %s' % ', '.join(fnames))

print()
print('=' * 84)
print('C. 耗时伸缩（线上端点 · daily · 各测2次取中位）')
print('=' * 84)
scal = []
for lim in [50, 200, 500, 2000]:
    ts = []
    for _ in range(2):
        dt, j, size = post_json(DEPLOYED, {'action': 'records', 'key': 'daily', 'limit': lim,
                                           'omit': ['完整主播报告']})
        n = len(j.get('rows') or []) if j.get('ok') is True else -1
        ts.append((dt, n, size))
    ts.sort(key=lambda x: (x[0] is None, x[0]))
    dt, n, size = ts[len(ts) // 2]
    scal.append((lim, n, dt, size))
    print('  limit=%-5d 实回 %-5d 行  %.1fs  %dKB' % (lim, n, dt or -1, size // 1024))

print()
print('=' * 84)
print('D. 结论用的原始数字（便于复核）')
print('=' * 84)
print('  前端超时: daily/history摘要 = 90s ；history含报告 = 120s')
for key, (n, rate, span, d0, d1) in growth.items():
    label = TABLES[key][1]
    print('  %-8s 现 %d 行，%.2f 行/日（%s~%s 共%d天）' % (label, n, rate, d0, d1, span))
    if rate > 0:
        # 线性外推（标注为非实测）
        for target in [90 * 0.8]:   # 撞到 80% 超时阈
            pass
        base = scal[0][2] if scal and scal[0][2] else None
