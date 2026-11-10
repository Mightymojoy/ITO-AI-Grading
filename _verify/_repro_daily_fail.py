# -*- coding: utf-8 -*-
"""
复现日报页取数失败：连续打 + 并发场景，记录每次的 HTTP 状态与**完整错误体**。
铁律：错误体必须原样打印，不截断成「失败」两个字。
"""
import json
import sys
import time
import urllib.error
import urllib.request
import threading

sys.stdout.reconfigure(errors='replace')
OP = urllib.request.build_opener()
BASE = 'https://ito-ai-grading.vercel.app/api/feishu-read'
DAILY = {'action': 'records', 'key': 'daily', 'limit': 1200,
         'omit': ['完整主播报告'], 'stop_at': 1}
TALK = {'action': 'records', 'table_id': 'tblORA9bSl8M63EO', 'limit': 1200}


def call(body, timeout=300, origin=None):
    hdr = {'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'ito-agent'}
    if origin:
        hdr['Origin'] = origin
        hdr['Referer'] = origin + '/v4/index.html'
    req = urllib.request.Request(BASE, data=json.dumps(body).encode(), method='POST', headers=hdr)
    t0 = time.time()
    try:
        r = OP.open(req, timeout=timeout)
        raw = r.read()
        dt = time.time() - t0
        try:
            j = json.loads(raw.decode('utf-8'))
        except Exception:
            j = None
        return {'dt': dt, 'status': r.status, 'bytes': len(raw), 'json': j,
                'raw': raw[:400].decode('utf-8', 'replace')}
    except urllib.error.HTTPError as e:
        dt = time.time() - t0
        body_raw = e.read()
        try:
            j = json.loads(body_raw.decode('utf-8'))
        except Exception:
            j = None
        return {'dt': dt, 'status': e.code, 'bytes': len(body_raw), 'json': j,
                'raw': body_raw[:600].decode('utf-8', 'replace')}
    except Exception as e:
        return {'dt': time.time() - t0, 'status': None, 'bytes': 0, 'json': None,
                'raw': '%s %s' % (type(e).__name__, e)}


def show(tag, r):
    st = r['status']
    if r['json'] and r['json'].get('ok'):
        j = r['json']
        rows = j.get('rows') or []
        ds = sorted({str(x.get('日期') or '')[:10] for x in rows if x.get('日期')})
        print('  %-10s %6.1fs HTTP=%s %3d 行 %6.1f KB  最新=%s' %
              (tag, r['dt'], st, len(rows), r['bytes'] / 1024.0, ds[-1] if ds else '-'))
    else:
        print('  %-10s %6.1fs HTTP=%s %6.1f KB  ❌ 原始响应：' %
              (tag, r['dt'], st, r['bytes'] / 1024.0))
        print('      %r' % r['raw'][:500])


print('=== 阶段1：连续 5 次 daily（带浏览器 Origin 头，模拟真实页面）===')
fails = 0
for i in range(5):
    r = call(DAILY, origin='https://ito-ai-grading.vercel.app')
    show('第%d次' % (i + 1), r)
    if not (r['json'] and r['json'].get('ok')):
        fails += 1
    time.sleep(1)
print('  ⇒ 失败 %d/5' % fails)

print()
print('=== 阶段2：先并发 4 个话术表 + 同时打 daily（日报页真实并发）===')
res = {}


def worker(name, body):
    res[name] = call(body)


ths = []
for n, b in [('talk1', TALK), ('talk2', TALK), ('talk3', TALK), ('talk4', TALK), ('daily', DAILY)]:
    t = threading.Thread(target=worker, args=(n, b))
    ths.append(t)
t0 = time.time()
for t in ths:
    t.start()
for t in ths:
    t.join()
print('  并发总墙钟 %.1fs' % (time.time() - t0))
for n in ['talk1', 'talk2', 'talk3', 'talk4', 'daily']:
    show(n, res[n])

print()
print('=== 阶段3：不带 omit 的第 6 个端点行为（确认是否 omit 引发）===')
r = call({'action': 'records', 'key': 'daily', 'limit': 20})
show('无omit', r)
