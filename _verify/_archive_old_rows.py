# -*- coding: utf-8 -*-
"""
旧行归档（B 方案 · 治本侧）。

为什么需要它：飞书「主播日报」41 个字段里 7 个是公式列、按**全表重算**，
所以取数耗时由「表里有多少行」决定，不由「取多少行」决定
（2026-11-10 实测：取 50 行 34.8s、取 443 行 20.5s；对照表 周总结 137 行 6.7s、月总结 63 行 5.6s）。
而接口单次上限 1200 行，触顶后保留最新、丢弃最早 ⇒ 表越大越慢、越容易静默丢数据。
把旧行搬走后主表变小，两个问题同时缓解。

安全设计（铁律 6）：
  · 默认**演练**，只打印将要删什么，不动飞书；
  · 落地必须显式 --apply；
  · 落地前**先备份**（完整 JSON + CSV 落 _bak/archive-<时间戳>/），备份写完并回读校验通过才继续；
  · 双闸门：① 待归档行数必须 >0；② 待归档占比 >60% 时拒绝执行（判据写错的自毁保护），
    确实要删这么多需再加 --force；
  · 分批删除、每批 50 条、逐批回报，任一批失败立即停并保留已备份数据。

用法：
  python _verify/_archive_old_rows.py                          # 演练：按 3 个月为界，看会删什么
  python _verify/_archive_old_rows.py --keep-months=6          # 演练：保留 6 个月
  python _verify/_archive_old_rows.py --cutoff=2026-10-01      # 演练：指定分界日（含之前的都归档）
  python _verify/_archive_old_rows.py --keep-months=3 --apply  # 真正落地（会先备份）
"""
import argparse
import csv
import datetime
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))

DEPLOYED = 'https://ito-ai-grading.vercel.app/api/feishu-read'
LIMIT_MAX = 1200
TABLES = {'daily': ('tblQC7Jfzmxp6QJI', '主播日报'), 'history': ('tblkN1e6yCtXl5bG', '历史评分')}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser()
ap.add_argument('--keep-months', type=int, default=3, help='保留最近几个月（默认 3）')
ap.add_argument('--cutoff', default='', help='直接指定分界日 YYYY-MM-DD（优先级高于 --keep-months）')
ap.add_argument('--table', default='both', choices=['daily', 'history', 'both'])
ap.add_argument('--apply', action='store_true', help='真正删除（默认只演练）')
ap.add_argument('--force', action='store_true', help='待归档占比 >60% 时仍需执行')
args = ap.parse_args()

# ---- 计算分界日 ----
if args.cutoff:
    cutoff = datetime.date(*map(int, args.cutoff.split('-')))
else:
    today = datetime.date.today()
    m = today.month - args.keep_months
    y = today.year
    while m <= 0:
        m += 12
        y -= 1
    day = min(today.day, 28)
    cutoff = datetime.date(y, m, day)

print('=' * 80)
print('旧行归档  %s' % ('【落地模式】' if args.apply else '【演练模式 · 不改飞书】'))
print('分界日 = %s（早于该日期的行将被归档）' % cutoff)
print('=' * 80)

ENV = {}
for line in open(os.path.join(ROOT, '.env'), encoding='utf-8', errors='replace'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        ENV[k.strip()] = v.strip()
BASE_TOKEN = ENV['FEISHU_BASE_TOKEN']


def post(url, body, headers=None, timeout=180, tries=3):
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                     headers=dict({'Content-Type': 'application/json',
                                                   'User-Agent': 'ito-archive'}, **(headers or {})))
        try:
            return json.loads(OP.open(req, timeout=timeout).read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return {'_http': e.code, '_body': e.read()[:300].decode('utf-8', 'replace')}
        except Exception as e:
            last = '%s %s' % (type(e).__name__, e)
            time.sleep(2)
    return {'_err': last}


def row_date(r):
    v = r.get('标准日期') or r.get('日期') or r.get('日报') or ''
    s = str(v)[:10]
    try:
        y, m, d = s.split('-')
        return datetime.date(int(y), int(m), int(d))
    except Exception:
        return None


keys = ['daily', 'history'] if args.table == 'both' else [args.table]
ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
bakdir = os.path.join(ROOT, '_bak', 'archive-%s' % ts)
plan = {}

for key in keys:
    tid, label = TABLES[key]
    print()
    print('--- %s (%s) ---' % (label, tid))
    j = post(DEPLOYED, {'action': 'records', 'key': key, 'limit': LIMIT_MAX})
    if j.get('ok') is not True:
        print('  !! 取数失败，跳过：%s' % str(j)[:160])
        plan[key] = None
        continue
    rows = j.get('rows') or []
    total_all = j.get('total_all')
    print('  表内共 %s 行，本次取回 %d 行%s'
          % (total_all, len(rows), '（已触顶，更早的行本次没取到 —— 请先把 limit 上限处理好）'
             if j.get('limited') else ''))
    old, undated = [], []
    for r in rows:
        d = row_date(r)
        if d is None:
            undated.append(r)
        elif d < cutoff:
            old.append(r)
    print('  早于 %s 的：%d 行   无日期（不会被动）：%d 行' % (cutoff, len(old), len(undated)))
    if old:
        bymonth = {}
        for r in old:
            k2 = str(row_date(r))[:7]
            bymonth[k2] = bymonth.get(k2, 0) + 1
        print('  按月：%s' % ', '.join('%s=%d' % (m, bymonth[m]) for m in sorted(bymonth)))
        sample = old[:8]
        for r in sample:
            print('    · %s  %s  %s' % (row_date(r), r.get('主播') or '-',
                                        (r.get('综合评分') or r.get('历史总分') or '-')))
        if len(old) > len(sample):
            print('    … 其余 %d 行同批处理' % (len(old) - len(sample)))
    plan[key] = {'label': label, 'tid': tid, 'rows': rows, 'old': old,
                 'total_all': total_all, 'limited': bool(j.get('limited'))}

# ---- 汇总与闸门 ----
todo = [(k, v) for k, v in plan.items() if v and v['old']]
print()
print('=' * 80)
if not todo:
    print('结论：没有需要归档的行（分界日之前无数据）。什么都没做。')
    sys.exit(0)

grand = sum(len(v['old']) for _, v in todo)
print('待归档合计 %d 行' % grand)
for k, v in todo:
    pct = 100.0 * len(v['old']) / max(1, len(v['rows']))
    print('  %-8s %d/%d 行 (%.0f%%)' % (v['label'], len(v['old']), len(v['rows']), pct))
    if pct > 60 and not args.force:
        print('  !! %s 待归档占比 %.0f%% > 60%%，疑似分界日写错。已中止（确认无误请加 --force）'
              % (v['label'], pct))
        sys.exit(3)

if not args.apply:
    print()
    print('【演练结束】以上内容**未**从飞书删除。确认无误后加 --apply 落地（会先备份）。')
    sys.exit(0)

# ---- 备份（落地前必须先成功）----
os.makedirs(bakdir, exist_ok=True)
for k, v in todo:
    fjson = os.path.join(bakdir, '%s_archived.json' % k)
    with open(fjson, 'w', encoding='utf-8') as f:
        json.dump({'table': k, 'table_id': v['tid'], 'cutoff': str(cutoff),
                   'archived_at': ts, 'count': len(v['old']), 'rows': v['old']},
                  f, ensure_ascii=False, indent=1)
    # 回读校验：能解析且行数一致，才认为备份可用
    with open(fjson, encoding='utf-8') as f:
        back = json.load(f)
    if back.get('count') != len(v['old']) or len(back.get('rows') or []) != len(v['old']):
        print('  !! 备份回读校验失败：%s（%s/%s）—— 中止，未删除任何行'
              % (fjson, back.get('count'), len(v['old'])))
        sys.exit(4)
    fcsv = os.path.join(bakdir, '%s_archived.csv' % k)
    cols = sorted({c for r in v['old'] for c in r.keys()})
    with open(fcsv, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in v['old']:
            w.writerow({c: r.get(c, '') for c in cols})
    print('  备份 OK：%s（%d 行）+ %s' % (os.path.basename(fjson), len(v['old']),
                                        os.path.basename(fcsv)))

# ---- 删除 ----
TOKEN = post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
             {'app_id': ENV['FEISHU_APP_ID'], 'app_secret': ENV['FEISHU_APP_SECRET']}
             ).get('tenant_access_token')
if not TOKEN:
    print('  !! 拿不到飞书 token，中止（备份已留，未删除）')
    sys.exit(5)
H = {'Authorization': 'Bearer ' + TOKEN}

print()
print('开始删除…')
total_deleted = 0
for k, v in todo:
    ids = [r.get('__record_id') for r in v['old'] if r.get('__record_id')]
    if len(ids) != len(v['old']):
        print('  !! %s 有 %d 行缺 record_id，无法精确删除 ⇒ 跳过该表（未删任何行）'
              % (v['label'], len(v['old']) - len(ids)))
        continue
    url = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records/batch_delete'
           % (BASE_TOKEN, v['tid']))
    okn = 0
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        res = post(url, {'records': chunk}, H)
        if res.get('code') != 0:
            print('  !! %s 第 %d 批删除失败 code=%s msg=%s —— 停止，已删 %d 行'
                  % (v['label'], i // 50 + 1, res.get('code'), str(res.get('msg'))[:120], okn))
            break
        okn += len(chunk)
        print('     %s 已删 %d/%d' % (v['label'], okn, len(ids)))
        time.sleep(0.4)          # 飞书限流：分批之间留间隔
    total_deleted += okn

print()
print('=' * 80)
print('删除完成：共 %d 行。备份目录：%s' % (total_deleted, bakdir))
print('回灌方式：把 %s 里的 JSON 用 batch_create 写回即可（record_id 有保留）。' % bakdir)
print('=' * 80)
