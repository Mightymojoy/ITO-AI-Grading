# -*- coding: utf-8 -*-
"""历史评分表重复行清理 —— 第一步：只出计划，不删除。

背景（2026-11-09 实测）：
  历史评分表 703 行，按「主播+日期」只有 560 个唯一组合，重复 69 组、多出 143 行。
  根因是 api/feishu-sync.js 的 listRecords 只拉 200 行且不翻页，
  而新记录追加在表尾 ⇒ upsert 的「先删旧行」从未命中 ⇒ 每评一次多一条（该文件已修）。

本脚本只做三件事：
  ① 全量拉取并**完整备份**（含全部字段 + record_id + 原始顺序）到 _bak/histdedup-<日期>/
  ② 按「主播 + 归一化日期」分组，每组保留**位置最靠后**的一条（= 最新一次评分）
  ③ 输出待删清单 + 风险提示（尤其「保留的是 0 分、却要删掉非 0 分」的情况）

用法：
  演练（默认）：python _verify/_plan_hist_dedup.py
  落地：       python _verify/_plan_hist_dedup.py --apply
"""
import json, os, re, sys, time, urllib.request, urllib.parse
from collections import OrderedDict, defaultdict

sys.stdout.reconfigure(errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TABLE = 'tblkN1e6yCtXl5bG'          # 历史评分
APPLY = '--apply' in sys.argv

# ---------- 凭证 ----------
env = {}
with open(os.path.join(ROOT, '.env'), encoding='utf-8', errors='replace') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 平台代理会让飞书返 400


def _post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    return json.loads(OP.open(req, timeout=120).read().decode())


def _get(path):
    req = urllib.request.Request('https://open.feishu.cn' + path)
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    return json.loads(OP.open(req, timeout=300).read().decode())


def _batch_delete(record_ids):
    """飞书批量删除：一次最多 500 条。单条删除 137 次会撞限流（~100 次/分/应用）。"""
    body = {'records': record_ids}
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        'https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records/batch_delete'
        % (env['FEISHU_BASE_TOKEN'], TABLE),
        data=data, method='POST',
        headers={'Authorization': 'Bearer ' + TOKEN,
                 'Content-Type': 'application/json; charset=utf-8',
                 'Content-Length': str(len(data))})
    return json.loads(OP.open(req, timeout=300).read().decode())


tok = _post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
            {'app_id': env['FEISHU_APP_ID'], 'app_secret': env['FEISHU_APP_SECRET']})
TOKEN = tok['tenant_access_token']

# ---------- ① 全量拉取（自己翻页，不依赖任何待改代码） ----------
print('=== ① 全量拉取（自己翻页，不依赖待改代码）===')
all_recs, page_token, page_no = [], '', 0
while True:
    p = '/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=500' % (env['FEISHU_BASE_TOKEN'], TABLE)
    if page_token:
        p += '&page_token=' + urllib.parse.quote(page_token)
    d = _get(p)
    if d.get('code') != 0:
        print('  拉取失败 code=%s %s' % (d.get('code'), d.get('msg')))
        sys.exit(2)
    data = d['data']
    page_no += 1
    all_recs.extend(data.get('items') or [])
    print('   第 %d 页 +%d 条，累计 %d' % (page_no, len(data.get('items') or []), len(all_recs)))
    if not data.get('has_more'):
        break
    page_token = data.get('page_token') or ''
    if not page_token:
        break
print('  合计 %d 条' % len(all_recs))

# ---------- ② 完整备份 ----------
stamp = time.strftime('%Y%m%d-%H%M%S')
bakdir = os.path.join(ROOT, '_bak', 'histdedup-' + stamp)
os.makedirs(bakdir, exist_ok=True)
bak = os.path.join(bakdir, 'history_full.json')
with open(bak, 'w', encoding='utf-8') as f:
    json.dump({'table': TABLE, 'at': time.strftime('%Y-%m-%d %H:%M:%S'),
               'count': len(all_recs), 'order': 'feishu 原始返回顺序（表尾=最新）',
               'items': all_recs}, f, ensure_ascii=False, indent=1)
print('\n=== ② 已完整备份 ===')
print('  %s  (%d 条, %.1f KB)' % (bak, len(all_recs), os.path.getsize(bak) / 1024.0))


# ---------- ③ 分组 ----------
def norm_date(v):
    """归一化日期：'2026-8-18' / '2026-08-18' 视为同一天；非法值原样返回小写标记。"""
    s = str(v or '').strip()[:10]
    m = re.match(r'^(\d{4})\D(\d{1,2})\D(\d{1,2})', s)
    if not m:
        return ''
    return '%04d-%02d-%02d' % (int(m.group(1)), int(m.group(2)), int(m.group(3)))


def total_of(fields):
    v = str(fields.get('总分') or '').strip()
    try:
        return float(v)
    except Exception:
        return None


groups = OrderedDict()
for idx, rec in enumerate(all_recs):
    f = rec.get('fields') or {}
    host = str(f.get('主播') or '').strip()
    nd = norm_date(f.get('日期'))
    if not host or not nd:
        continue
    groups.setdefault((host, nd), []).append((idx, rec))

dups = OrderedDict((k, v) for k, v in groups.items() if len(v) > 1)
extra = sum(len(v) - 1 for v in dups.values())
print('\n=== ③ 分组结果 ===')
print('  唯一（主播+归一化日期）组合：%d' % len(groups))
print('  重复组：%d 组' % len(dups))
print('  多出的行（待删）：%d 行' % extra)


def has_report(fields):
    r = fields.get('完整主播报告')
    return isinstance(r, str) and len(r) > 20


plan, risky = [], []
for (host, nd), lst in dups.items():
    keep_idx, keep_rec = lst[-1]                 # 位置最靠后 = 最新一次写入
    kf = keep_rec.get('fields') or {}
    k_total = total_of(kf)
    others = [r for i, r in lst[:-1]]
    # 风险判定：保留的那条是 0/空分，但被删的行里有非 0 分 ⇒ 可能误删真实分数
    o_totals = [total_of(r.get('fields') or {}) for r in others]
    good_deleted = [t for t in o_totals if t not in (None, 0.0)]
    if (k_total in (None, 0.0)) and good_deleted:
        risky.append((host, nd, k_total, good_deleted, keep_rec['record_id']))
    plan.append({
        'host': host, 'date': nd,
        'raw_dates': sorted(set(str((r.get('fields') or {}).get('日期') or '') for i, r in lst)),
        'keep': {'record_id': keep_rec['record_id'], 'total': k_total,
                 'has_report': has_report(kf),
                 'raw': str(kf.get('日期') or '')},
        'drop': [{'record_id': r['record_id'],
                  'total': total_of(r.get('fields') or {}),
                  'has_report': has_report(r.get('fields') or {}),
                  'raw': str((r.get('fields') or {}).get('日期') or '')} for r in others]
    })

plan_file = os.path.join(bakdir, 'dedup_plan.json')
with open(plan_file, 'w', encoding='utf-8') as f:
    json.dump({'dups': len(dups), 'extra': extra, 'plan': plan, 'risky': risky},
              f, ensure_ascii=False, indent=1)
print('  计划已写入：%s' % plan_file)

print('\n=== 重复最多的 15 组（保留最后一条）===')
for p in sorted(plan, key=lambda x: -len(x['drop']))[:15]:
    print('  %-8s %s  共%d条 → 保留 total=%s(报告:%s)  删%d条  待删总分=%s'
          % (p['host'], p['date'], len(p['drop']) + 1,
             p['keep']['total'], '有' if p['keep']['has_report'] else '无',
             len(p['drop']),
             [d['total'] for d in p['drop']][:8]))
    if len(p['raw_dates']) > 1:
        print('       ⚠️ 同组日期格式不一：%s' % p['raw_dates'])

print('\n=== 风险检查：「保留的是 0/空分，却要删掉非 0 分」===')
if risky:
    print('  ⚠️ 共 %d 组，需人工确认（默认不动这几组）：' % len(risky))
    for host, nd, k, gd, rid in risky[:20]:
        print('    %-8s %s  保留 total=%s  将删掉的好分=%s' % (host, nd, k, gd))
else:
    print('  无。所有组的「保留项」要么有分、要么全组都是 0 分。')

# ---------- ④ 落地（默认不删） ----------
if not APPLY:
    print('\n=== 演练结束，未删除任何记录 ===')
    print('  确认无误后执行：python _verify/_plan_hist_dedup.py --apply')
    print('  预计 %d 行 → %d 行' % (len(all_recs), len(all_recs) - extra + len(risky)))
    sys.exit(0)

print('\n=== ④ 开始删除（跳过风险组）===')
risky_keys = set((h, d) for h, d, _k, _g, _r in risky)
skip_n = sum(len(v) - 1 for k, v in dups.items() if k in risky_keys)
to_del = []
for p in plan:
    if (p['host'], p['date']) in risky_keys:
        continue
    for d in p['drop']:
        to_del.append((p['host'], p['date'], d['record_id']))

print('  计划删除 %d 行，跳过风险组 %d 行（共 %d 条重复中的 %d 条）'
      % (len(to_del), skip_n, extra, len(to_del) + skip_n))

ok, ng = 0, 0
delete_log = []
BATCH = 100
for bi in range(0, len(to_del), BATCH):
    chunk = to_del[bi:bi + BATCH]
    ids = [x[2] for x in chunk]
    try:
        r = _batch_delete(ids)
        if r.get('code') == 0:
            recs = (r.get('data') or {}).get('records') or []
            # batches 里逐条带 code，可用于确认哪些真的删掉了
            bmap = {}
            for b in recs:
                bmap[b.get('record_id')] = b
            for h, d, rid in chunk:
                b = bmap.get(rid, {})
                good = (b.get('deleted') is True) or (b.get('code') in (0, None))
                if good:
                    ok += 1
                else:
                    ng += 1
                delete_log.append({'record_id': rid, 'host': h, 'date': d,
                                   'ok': bool(good), 'batch_code': r.get('code')})
        else:
            ng += len(chunk)
            for h, d, rid in chunk:
                delete_log.append({'record_id': rid, 'host': h, 'date': d,
                                   'ok': False, 'code': r.get('code'), 'msg': r.get('msg')})
            print('    批次失败 code=%s %s' % (r.get('code'), r.get('msg')))
    except Exception as e:
        ng += len(chunk)
        for h, d, rid in chunk:
            delete_log.append({'record_id': rid, 'host': h, 'date': d, 'ok': False, 'error': str(e)})
        print('    批次异常: %s' % e)
    print('    进度 %d/%d（成功 %d 失败 %d）' % (min(bi + BATCH, len(to_del)), len(to_del), ok, ng))
    time.sleep(1.2)

log_file = os.path.join(bakdir, 'delete_log.json')
with open(log_file, 'w', encoding='utf-8') as f:
    json.dump({'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'attempted': len(to_del),
               'ok': ok, 'failed': ng, 'items': delete_log}, f, ensure_ascii=False, indent=1)
print('\n  删除完成：成功 %d / 失败 %d' % (ok, ng))
print('  删除日志：%s' % log_file)

# ---------- ⑤ 复验 ----------
print('\n=== ⑤ 复验（重新全量拉取）===')
time.sleep(3)
after, pt = [], ''
while True:
    p = '/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=500' % (env['FEISHU_BASE_TOKEN'], TABLE)
    if pt:
        p += '&page_token=' + urllib.parse.quote(pt)
    d = _get(p)
    data = d['data']
    after.extend(data.get('items') or [])
    if not data.get('has_more'):
        break
    pt = data.get('page_token') or ''
    if not pt:
        break
g2 = defaultdict(list)
for rec in after:
    f = rec.get('fields') or {}
    g2[(str(f.get('主播') or '').strip(), norm_date(f.get('日期')))].append(rec)
dup2 = sum(1 for k, v in g2.items() if len(v) > 1)
print('  删除前 %d 行 → 删除后 %d 行' % (len(all_recs), len(after)))
print('  重复组：%d → %d' % (len(dups), dup2))
print('  预期剩余重复组 = 跳过的风险组数 %d' % len(risky_keys))
print('  RESULT: %s' % ('PASS' if dup2 <= len(risky_keys) else 'FAIL'))
