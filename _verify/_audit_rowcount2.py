# -*- coding: utf-8 -*-
"""
对账（修正版）：日期字段 type=5 返回毫秒时间戳，必须按毫秒转换，不能当字符串解析。
铁律：写断言前先确认字段真实类型（走 /fields），不凭字段名叫「日期」就当字符串。
"""
import collections
import datetime
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.stdout.reconfigure(errors='replace')
OPF = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 飞书：绕代理
OPP = urllib.request.build_opener()                                  # Vercel：走代理
env = {}
for line in open('.env', encoding='utf-8', errors='replace'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
BT = env['FEISHU_BASE_TOKEN']
DAILY = 'tblQC7Jfzmxp6QJI'

body = json.dumps({'app_id': env['FEISHU_APP_ID'], 'app_secret': env['FEISHU_APP_SECRET']}).encode()
req = urllib.request.Request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                             data=body, headers={'Content-Type': 'application/json'}, method='POST')
TOK = json.loads(OPF.open(req, timeout=60).read().decode())['tenant_access_token']


def norm_date(v):
    """type=5 日期字段：毫秒 int / 也可能是 str。统一成 YYYY-MM-DD。"""
    if v is None or v == '':
        return ''
    if isinstance(v, (int, float)):
        try:
            return datetime.datetime.fromtimestamp(v / 1000.0).strftime('%Y-%m-%d')
        except Exception:
            return ''
    s = str(v).strip()
    if s.isdigit() and len(s) >= 12:          # 毫秒时间戳以字符串形式出现
        try:
            return datetime.datetime.fromtimestamp(int(s) / 1000.0).strftime('%Y-%m-%d')
        except Exception:
            return ''
    m = __import__('re').match(r'^(\d{4})\D(\d{1,2})\D(\d{1,2})', s[:10])
    return '%04d-%02d-%02d' % (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else ''


def pull_all(table, fields=None, tagon=''):
    out, pt, pages = [], '', 0
    while True:
        q = '/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=500' % (BT, table)
        if pt:
            q += '&page_token=' + urllib.parse.quote(pt)
        if fields:
            q += '&field_names=' + urllib.parse.quote(json.dumps(fields, ensure_ascii=False))
        rq = urllib.request.Request('https://open.feishu.cn' + q)
        rq.add_header('Authorization', 'Bearer ' + TOK)
        t0 = time.time()
        raw = OPF.open(rq, timeout=300).read()
        d = json.loads(raw.decode('utf-8'))['data']
        pages += 1
        out += d.get('items') or []
        print('    %s第%d页 %5.1fs 行=%d has_more=%s %7.1f KB'
              % (tagon, pages, time.time() - t0, len(d.get('items') or []),
                 d.get('has_more'), len(raw) / 1024.0))
        if not d.get('has_more'):
            break
        pt = d.get('page_token') or ''
        if not pt:
            break
    return out


print('=== 1. 直连飞书：主播日报全量（含「日期」「标准日期」两列原始值样本）===')
rows = pull_all(DAILY, tagon='')
print('  ⇒ 飞书真实行数 =', len(rows))
print('  首条「日期」原始值:', repr((rows[0]['fields'] or {}).get('日期')), ' 类型:', type((rows[0]['fields'] or {}).get('日期')).__name__)
print('  首条「标准日期」原始值:', repr((rows[0]['fields'] or {}).get('标准日期')))
print()

byday = collections.defaultdict(set)
bad = 0
for it in rows:
    f = it['fields'] or {}
    d = norm_date(f.get('日期'))
    h = str(f.get('主播') or '').strip()
    if not d:
        bad += 1
    else:
        byday[d].add(h)
days = sorted(byday)
print('  日期跨度: %s ~ %s  共 %d 天' % (days[0], days[-1], len(days)) if days else '  日期全空！')
print('  无法解析日期的行:', bad)
print()
print('  最近 16 天每天主播数：')
for d in days[-16:]:
    print('    %s  %2d 人  %s' % (d, len(byday[d]), '  << 11-08 (旧最新)' if d == '2026-11-08' else ''))
print()
print('  整段缺失日期（首末日之间）：')
start = datetime.date(*map(int, days[0].split('-')))
end = datetime.date(*map(int, days[-1].split('-')))
gaps, cur = [], start
while cur <= end:
    s = cur.isoformat()
    if s not in byday:
        gaps.append((s, cur.strftime('%a')))
    cur += datetime.timedelta(days=1)
print('    共 %d 天缺失: %s' % (len(gaps), ', '.join('%s(%s)' % g for g in gaps)))

print()
print('=== 2. 接口返回（对比飞书真实 443）===')
BASE = 'https://ito-ai-grading.vercel.app/api/feishu-read'


def api(b):
    rq = urllib.request.Request(BASE, data=json.dumps(b).encode(), method='POST',
                                headers={'Content-Type': 'application/json', 'Cache-Control': 'no-cache',
                                         'User-Agent': 'ito-agent'})
    t0 = time.time()
    try:
        raw = OPP.open(rq, timeout=300).read()
        return time.time() - t0, json.loads(raw.decode('utf-8')), len(raw)
    except urllib.error.HTTPError as e:
        return time.time() - t0, {'__http': e.code, '__body': e.read()[:400].decode('utf-8', 'replace')}, 0


for tag, b in [('带omit+stop_at', {'action': 'records', 'key': 'daily', 'limit': 1200, 'omit': ['完整主播报告'], 'stop_at': 1}),
               ('带omit 无stop', {'action': 'records', 'key': 'daily', 'limit': 1200, 'omit': ['完整主播报告']})]:
    dt, j, size = api(b)
    if j.get('ok'):
        rr = j.get('rows') or []
        ds = sorted({norm_date(x.get('日期')) for x in rr if norm_date(x.get('日期'))})
        print('  %-16s %5.1fs 行=%d total_all=%s limited=%s 日期=%s~%s %6.1f KB'
              % (tag, dt, len(rr), j.get('total_all'), j.get('limited'),
                 ds[0] if ds else '-', ds[-1] if ds else '-', size / 1024.0))
    else:
        print('  %-16s %5.1fs ❌ %s' % (tag, dt, str(j)[:260]))
