# -*- coding: utf-8 -*-
"""
回填「未记录 违规-综合评分」列（飞书「主播日报」表）

数据源：飞书该表自带的「完整主播报告」字段 = v4DetailSnapshot() 的 JSON
  ⇒ 不必去浏览器 localStorage 挖；飞书自己就存着算这个数所需的一切。
覆盖口径（老大 2026-10-14 拍板）：
  ① 只填「综合评分 = 0」的场次（其余留空 —— 非判 0 时该值恒等于综合评分，写了是噪音）
  ② 有 rawTotal  → `xx（精确）`
  ③ 无 rawTotal，但有红旗处数 → `xx（精确）`  ← v4.11.38 升级：Σ加权 − min(12,处数×4)，与原公式同式
  ④ 无 rawTotal 且无红旗处数 → `xx（上限值）`（兜底，理论上不会走到）
  ⑤ 两者都没有 → 跳过（不编数）

  ⚠️ ③ 的关键：红旗处数（信息准确性）自 extraV 4.11.22 起就存在 `det.extra.bl.errs`
     里，109/109 条报告都有 ⇒ 老记录也能**精确**算回原分，不再退化成「上限值」。
     已用 45 条独立样本逐条闭合验证，复现脚本 = `_probe_raw_exact.py`。
安全边界（项目铁律）：
  - **默认 dry-run**：只读 + 计算 + 出清单，绝不写
  - 真写必须显式加 `--apply`
  - 真写前先把 151 条原始记录导出到 `_bak/rawcol-backfill-<时间>/`
  - 写前用 field_id 校验列仍在且未被改名（改名 ⇒ 立刻停）
  - 该列**已有值**的记录默认跳过（防覆盖人工修正）
  - 逐条写、任何一条失败立刻停并报告（不静默跳过）

用法:
  python _backfill_rawcol.py            # 演练（默认）
  python _backfill_rawcol.py --apply    # 真写
"""
import io
import json
import math
import os
import sys
import time
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
TABLE_ID = 'tblQC7Jfzmxp6QJI'          # 主播日报
FIELD_ID = 'fldfcibJNi'                # 未记录 违规-综合评分（2026-10-14 探针实测）
FIELD_NAME = '未记录 违规-综合评分'
APPLY = '--apply' in sys.argv
STAMP = time.strftime('%Y%m%d-%H%M%S')
BACKUP_DIR = os.path.join(HERE, '_bak', 'rawcol-backfill-' + STAMP)
PLAN_PATH = os.path.join(HERE, '_backfill_rawcol.plan.txt')

log_lines = []


def say(s=''):
    print(s)
    log_lines.append(str(s))


def js_round(x):
    """与 JS Math.round 语义一致（Python 的 round 是银行家舍入，round(2.5)=2 ⇒ 不能用）"""
    return math.floor(x + 0.5) if x >= 0 else -math.floor(-x + 0.5)


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


def blk_of(j):
    """复刻前端 v4RawBlk()（v4.11.38）：信息准确性红旗处数。
    三处来源同源，按可信度取第一个拿到；**取不到就返回 None，绝不猜数**。
      ① det.rawBlk        ②（运行时）r.baseline.errors        ③ det.extra.bl.errs ← 老存档也有
    """
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
    """复刻前端 v4RawScore()（v4.11.38）。返回 (值, 是否精确) 或 None。绝不猜数。
    与 app-core.js:574-581 同式：
        total = Σ(score × weight / 100) − min(12, 红旗处数 × 4)   （<0 截为 0）
    """
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
                s += float(m['weighted'])
                has = True
        if not has:
            return None                      # 无从反推 ⇒ 不显示、不写
        if pen is not None:
            t, exact = s - pen, True         # v4.11.38：精确复算（老记录也能拿真值）
        else:
            t, exact = s, False              # 兜底：上限值
    tot = js_round(t * 10) / 10
    if tot < 0:
        tot = 0
    return tot, exact


def report_text(rec):
    v = (rec.get('fields') or {}).get('完整主播报告')
    if isinstance(v, list):
        v = ''.join(seg.get('text', '') if isinstance(seg, dict) else str(seg) for seg in v)
    return v or ''


def fmt_num(x):
    """2.0 → '2'；68.5 → '68.5'（与前端 String(total) 同表现）"""
    if x == int(x):
        return str(int(x))
    return str(x)


def fetch_all(token, base):
    out, page_token = [], ''
    while True:
        url = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=200'
               % (base, TABLE_ID))
        if page_token:
            url += '&page_token=' + page_token
        r = http_json(url, headers={'Authorization': 'Bearer ' + token})
        if r.get('code') != 0:
            raise RuntimeError('拉取记录失败: ' + str(r.get('msg')))
        d = r.get('data') or {}
        out.extend(d.get('items') or [])
        if not d.get('has_more'):
            break
        page_token = d.get('page_token') or ''
        if not page_token:
            break
    return out


def main():
    env = load_env(os.path.join(HERE, '.env'))
    app_id, app_secret = env.get('FEISHU_APP_ID', ''), env.get('FEISHU_APP_SECRET', '')
    base = env.get('FEISHU_BASE_TOKEN', '')
    if not (app_id and app_secret and base):
        say('!! 凭证不全'); return 2

    auth = http_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                     method='POST', body={'app_id': app_id, 'app_secret': app_secret})
    if auth.get('code') != 0:
        say('!! 鉴权失败: ' + str(auth.get('msg'))); return 2
    token = auth['tenant_access_token']
    hdr = {'Authorization': 'Bearer ' + token}
    say('模式：%s' % ('★ 真写（--apply）' if APPLY else '演练（dry-run，不写任何数据）'))
    say('鉴权 OK')

    # ---- ① 列存在性 + 未被改名（改名 ⇒ 立刻停）----
    rf = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/fields?page_size=200'
                   % (base, TABLE_ID), headers=hdr)
    fields = (rf.get('data') or {}).get('items') or []
    hit = [f for f in fields if f.get('field_id') == FIELD_ID]
    if not hit:
        say('!! 找不到 field_id=%s ⇒ 列可能被删除，停止' % FIELD_ID); return 3
    if (hit[0].get('field_name') or '') != FIELD_NAME:
        say('!! 列名已变：期望 %r，实际 %r ⇒ 停止（防写错列）'
            % (FIELD_NAME, hit[0].get('field_name'))); return 3
    say('列校验 OK：%r（type=%s）' % (FIELD_NAME, hit[0].get('type')))

    # ---- ② 拉全量 + 备份 ----
    recs = fetch_all(token, base)
    say('表内记录 %d 条' % len(recs))
    os.makedirs(BACKUP_DIR, exist_ok=True)
    bak = os.path.join(BACKUP_DIR, 'daily-records.before.json')
    with io.open(bak, 'w', encoding='utf-8') as f:
        json.dump(recs, f, ensure_ascii=False, indent=1)
    say('已备份 → %s（%d B）' % (bak, os.path.getsize(bak)))

    # ---- ③ 计算计划 ----
    plan, skip_filled, skip_notzero, skip_nodata = [], 0, 0, 0
    for rec in recs:
        f = rec.get('fields') or {}
        host = str(f.get('主播') or '')
        date = str(f.get('日期') or '')[:10]
        total = str(f.get('综合评分') or '').strip()
        cur = str(f.get('未记录 违规-综合评分') or '').strip()
        if cur:
            skip_filled += 1
            continue
        if total not in ('0', '0.0', '0.00'):
            skip_notzero += 1
            continue
        rep = report_text(rec)
        if not rep:
            skip_nodata += 1
            plan.append({'id': rec.get('record_id'), 'host': host, 'date': date,
                         'total': total, 'text': None, 'reason': '该场次无「完整主播报告」'})
            continue
        try:
            j = json.loads(rep)
        except Exception as e:
            skip_nodata += 1
            plan.append({'id': rec.get('record_id'), 'host': host, 'date': date,
                         'total': total, 'text': None, 'reason': '报告不是合法 JSON: %s' % e})
            continue
        rs = raw_score(j)
        if not rs:
            skip_nodata += 1
            plan.append({'id': rec.get('record_id'), 'host': host, 'date': date,
                         'total': total, 'text': None, 'reason': '无 rawTotal 且无可反推的计权模块'})
            continue
        val, exact = rs
        text = fmt_num(val) + ('（精确）' if exact else '（上限值）')
        plan.append({'id': rec.get('record_id'), 'host': host, 'date': date,
                     'total': total, 'text': text, 'reason': ''})

    writable = [p for p in plan if p['text']]
    unwritable = [p for p in plan if not p['text']]
    n_exact = len([p for p in writable if p['text'].endswith('（精确）')])
    n_der = len(writable) - n_exact

    say()
    say('===== 回填计划 =====')
    say('  判 0 场次合计            ：%d 条' % (len(plan)))
    say('  ① 可写 · 精确值          ：%d 条（含 v4.11.38 精确复算的老记录）' % n_exact)
    say('  ② 可写 · 反推上限值      ：%d 条（兜底口径）' % n_der)
    say('  ③ 跳过 · 无可用数据      ：%d 条' % len(unwritable))
    say('  跳过 · 非判 0（留空）    ：%d 条' % skip_notzero)
    say('  跳过 · 该列已有值        ：%d 条' % skip_filled)
    say()
    say('  —— 完整清单（%d 条待写）——' % len(writable))
    for i, p in enumerate(writable, 1):
        say('  %3d. %s / %s  综合评分=%s → %s' % (i, p['host'], p['date'], p['total'], p['text']))
    if unwritable:
        say()
        say('  —— 无法回填（%d 条，保持空白，不编数）——' % len(unwritable))
        for i, p in enumerate(unwritable, 1):
            say('  %3d. %s / %s  ← %s' % (i, p['host'], p['date'], p['reason']))

    with io.open(PLAN_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(log_lines) + '\n')
    say()
    say('清单已写入 → ' + PLAN_PATH)

    if not APPLY:
        say()
        say('== 演练结束，未发送任何写请求。确认清单无误后加 --apply 真写 ==')
        return 0

    # ---- ④ 真写（逐条；失败即停）----
    say()
    say('===== 开始真写 %d 条 =====' % len(writable))
    ok = 0
    for i, p in enumerate(writable, 1):
        body = {'fields': {FIELD_NAME: p['text']}}
        try:
            r = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records/%s'
                          % (base, TABLE_ID, p['id']), method='PUT', body=body, headers=hdr)
        except urllib.error.HTTPError as e:
            say('!! 第 %d 条 HTTP %s: %s ⇒ 停止' % (i, e.code, e.read()[:200])); return 4
        if r.get('code') != 0:
            say('!! 第 %d 条写入失败: %s ⇒ 停止（已写 %d 条）' % (i, r.get('msg'), ok)); return 4
        ok += 1
        if ok % 10 == 0 or ok == len(writable):
            say('  已写 %d/%d（最近：%s / %s → %s）' % (ok, len(writable), p['host'], p['date'], p['text']))
    say()
    say('== 真写完成：%d 条成功 ==' % ok)
    say('回滚：原始记录已备份在 ' + bak)
    return 0


if __name__ == '__main__':
    try:
        code = main()
    except Exception as e:
        say('!! 异常: %s: %s' % (type(e).__name__, e))
        code = 5
    sys.exit(code)
