# -*- coding: utf-8 -*-
"""
压测日报取数（前端真实参数），统计失败率并原样打印每次失败的响应体与响应头。
判定铁律：失败要区分「超时 / HTTP 5xx / 200 空体 / ok=false」，不能一律叫「失败」。
"""
import json
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(errors='replace')
OP = urllib.request.build_opener()
BASE = 'https://ito-ai-grading.vercel.app/api/feishu-read'
BODY = {'action': 'records', 'key': 'daily', 'limit': 1200, 'omit': ['完整主播报告'], 'stop_at': 1}
N = int(sys.argv[1]) if len(sys.argv) > 1 else 10

ok = 0
kinds = {}
detail = []

for i in range(N):
    hdr = {'Content-Type': 'application/json', 'Cache-Control': 'no-cache',
           'User-Agent': 'ito-agent', 'Origin': 'https://ito-ai-grading.vercel.app'}
    req = urllib.request.Request(BASE, data=json.dumps(BODY).encode(), method='POST', headers=hdr)
    t0 = time.time()
    kind = None
    extra = ''
    try:
        r = OP.open(req, timeout=180)
        raw = r.read()
        dt = time.time() - t0
        vh = {k.lower(): v for k, v in r.headers.items() if k.lower().startswith('x-vercel') or k.lower() in ('content-type', 'content-length')}
        if len(raw) == 0:
            kind = 'HTTP%d 空体' % r.status
        else:
            try:
                j = json.loads(raw.decode('utf-8'))
                if j.get('ok'):
                    kind = 'OK'
                    ok += 1
                    extra = '%d 行 %d KB' % (len(j.get('rows') or []), len(raw) / 1024)
                else:
                    kind = 'ok=false'
                    extra = str(j)[:200]
            except Exception as e:
                kind = 'JSON解析失败'
                extra = raw[:200].decode('utf-8', 'replace')
        if kind != 'OK':
            extra += ' | hdr=' + json.dumps(vh, ensure_ascii=False)[:300]
    except urllib.error.HTTPError as e:
        dt = time.time() - t0
        try:
            b = e.read()
        except Exception:
            b = b''
        vh = {k.lower(): v for k, v in e.headers.items() if k.lower().startswith('x-vercel') or k.lower() in ('content-type', 'content-length')}
        kind = 'HTTP %d' % e.code
        extra = 'body=%r | hdr=%s' % (b[:300].decode('utf-8', 'replace'), json.dumps(vh, ensure_ascii=False)[:300])
    except Exception as e:
        dt = time.time() - t0
        kind = type(e).__name__
        extra = str(e)[:200]
    kinds[kind] = kinds.get(kind, 0) + 1
    line = '  #%-2d %6.1fs %-14s %s' % (i + 1, dt, kind, extra[:220])
    print(line)
    detail.append({'i': i + 1, 'dt': round(dt, 1), 'kind': kind, 'extra': extra})
    if i < N - 1:
        time.sleep(2)

print()
print('===== 汇总 %d 次：成功 %d / 失败 %d（%.0f%%）=====' % (N, ok, N - ok, (N - ok) * 100.0 / N))
for k, v in sorted(kinds.items(), key=lambda x: -x[1]):
    print('  %-16s %d 次' % (k, v))
fails = [d for d in detail if d['kind'] != 'OK']
if fails:
    print()
    print('  失败明细：')
    for f in fails:
        print('    #%d %.1fs %s' % (f['i'], f['dt'], f['kind']))
        print('       ' + f['extra'][:400])
