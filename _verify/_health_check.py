# -*- coding: utf-8 -*-
"""
工作台健康体检（A 方案 · 预警侧）。

回答一个问题：**今天工作台会不会出问题？还有多少天余量？**
不改任何数据，只读线上接口（前端真实通路）+ 飞书字段定义，输出风险等级。

判定口径（阈值全部来自实测，不是拍的）：
  1. 行数 vs 单次上限 1200（接口硬上限，触顶保留最新、丢弃最早）
     - >=1200 触顶      ⇒ CRIT
     - >=85%  (>=1020)  ⇒ WARN（留约 2 周处置窗口）
  2. 耗时 vs 前端超时（daily/history 摘要 90s、history 含报告 120s）
     - >=80%  ⇒ WARN ；>=100% ⇒ CRIT
  3. 失败（ok!=true / HTTP!=200）⇒ CRIT
  4. 增长率：用「本次数据的日期跨度」现算 行/天 ⇒ 换算距触顶天数（外推，报告里显式标注）

退出码：0=全部 OK ｜ 1=有 WARN ｜ 2=有 CRIT
用法：
  python _verify/_health_check.py                # 只看报告
  python _verify/_health_check.py --json=out.json  # 另存机器可读结果（供任务计划判断/推送）
"""
import collections
import datetime
import json
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 铁律：飞书/线上接口必绕平台代理

DEPLOYED = 'https://ito-ai-grading.vercel.app/api/feishu-read'
LIMIT_MAX = 1200                     # 与 v4-shell.js 的 LIMIT_BY_KEY 同口径
TIMEOUTS = {'daily': 90.0, 'history': 90.0, 'week': 90.0, 'month': 90.0, 'history_report': 120.0}
TABLES = [('daily', '主播日报'), ('history', '历史评分'), ('week', '周总结'), ('month', '月总结')]

ROWS_OK, ROWS_WARN = 0.85, 1.00
DUR_WARN, DUR_CRIT = 0.80, 1.00

LEVEL = {'OK': 0, 'WARN': 1, 'CRIT': 2}
found = []          # [(level, table, msg)]


def post(body, timeout=180, tries=3):
    last = None
    for i in range(tries):
        req = urllib.request.Request(
            DEPLOYED, data=json.dumps(body).encode(), method='POST',
            headers={'Content-Type': 'application/json', 'Cache-Control': 'no-cache',
                     'User-Agent': 'ito-health'})
        t0 = time.time()
        try:
            r = OP.open(req, timeout=timeout)
            raw = r.read()
            return time.time() - t0, r.status, json.loads(raw.decode('utf-8')), len(raw)
        except urllib.error.HTTPError as e:
            return time.time() - t0, e.code, {'_httpErr': e.read()[:200].decode('utf-8', 'replace')}, 0
        except Exception as e:
            last = '%s %s' % (type(e).__name__, e)
            time.sleep(2)
    return None, None, {'_err': last}, 0


def note(lv, table, msg):
    found.append((lv, table, msg))


def growth_of(rows):
    """从数据自身算增长率：最早→最晚日期跨度 + 行数。返回 (行/天, 跨度天数, 最早, 最晚)。"""
    ds = []
    for r in rows:
        v = r.get('标准日期') or r.get('日期') or r.get('日报') or ''
        s = str(v)
        if len(s) >= 8 and s[4] == '-':
            try:
                y, m, d = s[:10].split('-')
                ds.append(datetime.date(int(y), int(m), int(d)))
            except Exception:
                pass
    if len(ds) < 2:
        return None, None, None, None
    d0, d1 = min(ds), max(ds)
    span = (d1 - d0).days + 1
    if span <= 0:
        return None, None, d0, d1
    return len(rows) / float(span), span, d0, d1


print('=' * 82)
print('工作台健康体检  %s' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
print('=' * 82)
print('%-10s %6s %6s %8s %9s %s' % ('表', '行数', '上限占比', '耗时', '超时占比', '判定'))
print('-' * 82)

report = {'ts': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'tables': {}, 'findings': []}

for key, label in TABLES:
    dt, code, j, size = post({'action': 'records', 'key': key, 'limit': LIMIT_MAX,
                              'omit': ['完整主播报告']})
    if j.get('ok') is not True:
        print('%-10s %6s %6s %8s %9s %s' % (label, '-', '-', '-', '-', 'CRIT 取数失败'))
        note('CRIT', label, '取数失败 HTTP=%s %s' % (code, str(j)[:140]))
        continue
    rows = j.get('rows') or []
    n = len(rows)
    total_all = j.get('total_all')
    limited = bool(j.get('limited'))
    tmo = TIMEOUTS.get(key, 90.0)
    rp = n / float(LIMIT_MAX)
    dp = (dt or 0) / tmo

    lv = 'OK'
    if limited or rp >= ROWS_WARN:
        lv = 'WARN'
    if rp >= ROWS_OK * 1.18:          # 远超上限才算触顶级（limited 已单列判断）
        lv = 'CRIT'
    if dp >= DUR_WARN:
        lv = max([lv, 'WARN'], key=lambda x: LEVEL[x])
    if dp >= DUR_CRIT:
        lv = 'CRIT'

    print('%-10s %6d %6.1f%% %7.1fs %8.0f%% %s' % (label, n, rp * 100, dt or -1, dp * 100, lv))

    rate, span, d0, d1 = growth_of(rows)
    rec = {'rows': n, 'total_all': total_all, 'limited': limited, 'sec': round(dt or -1, 1),
           'limit': LIMIT_MAX, 'level': lv}
    if rate:
        days = max(0, int((LIMIT_MAX - n) / rate)) if rate > 0 else None
        rec.update({'rate_per_day': round(rate, 2), 'span_days': span,
                    'first': str(d0), 'last': str(d1), 'days_to_limit': days})
        print('%-10s 增长率 %.2f 行/日（%s~%s 共 %d 天，实测）%s'
              % ('', rate, d0, d1, span,
                 (' ⇒ 距 1200 行上限约 %d 天（线性外推，非实测）' % days) if days is not None else ''))
    if limited:
        note('WARN', label, '已触顶截断：本次 %d 条 / 表内 %s 条，更早数据未加载' % (n, total_all))
    elif rp >= ROWS_WARN:
        note('WARN', label, '行数已达上限 %.0f%%（%d/%d）%s'
             % (rp * 100, n, LIMIT_MAX,
                ('，约 %d 天后触顶' % rec['days_to_limit']) if rec.get('days_to_limit') else ''))
    if dp >= DUR_WARN:
        note('WARN' if dp < DUR_CRIT else 'CRIT', label,
             '耗时 %.1fs / 超时 %.0fs = %.0f%%' % (dt or -1, tmo, dp * 100))
    report['tables'][label] = rec
    print()

# 历史页第二批（含完整报告）：单独一批，超时 120s，是整页最重的一步
dt, code, j, size = post({'action': 'records', 'key': 'history', 'limit': LIMIT_MAX})
if j.get('ok') is True:
    dp = (dt or 0) / TIMEOUTS['history_report']
    lv = 'OK' if dp < DUR_WARN else ('WARN' if dp < DUR_CRIT else 'CRIT')
    print('%-10s %6d %6s %7.1fs %8.0f%% %s' % ('历史-含报告', len(j.get('rows') or []), '-',
                                               dt or -1, dp * 100, lv))
    print('%-10s 体积 %d KB（这一步决定历史页展开能不能看）' % ('', size // 1024))
    if dp >= DUR_WARN:
        note(lv, '历史-含报告', '耗时 %.1fs / 超时 %.0fs = %.0f%%' % (dt or -1,
             TIMEOUTS['history_report'], dp * 100))
    report['tables']['历史-含报告'] = {'rows': len(j.get('rows') or []), 'sec': round(dt or -1, 1),
                                     'kb': size // 1024, 'level': lv}
else:
    print('%-10s 取数失败 %s' % ('历史-含报告', str(j)[:120]))
    note('CRIT', '历史-含报告', '取数失败')

print()
print('=' * 82)
worst = max([LEVEL[l] for l, _, _ in found], default=0)
verdict = {0: 'OK   一切正常', 1: 'WARN 有余量但需留意', 2: 'CRIT 已到临界，需立刻处置'}[worst]
print('总判定：%s' % verdict)
if found:
    print('明细：')
    for lv, tb, msg in sorted(found, key=lambda x: -LEVEL[x[0]]):
        print('  [%-4s] %-12s %s' % (lv, tb, msg))
else:
    print('  （无任何告警项）')
print('=' * 82)

report['level'] = ['OK', 'WARN', 'CRIT'][worst]
report['findings'] = [{'level': l, 'table': t, 'msg': m} for l, t, m in found]

for a in sys.argv[1:]:
    if a.startswith('--json='):
        path = a.split('=', 1)[1]
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print('已写 %s' % path)

sys.exit(worst)
