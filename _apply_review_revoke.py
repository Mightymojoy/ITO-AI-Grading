# -*- coding: utf-8 -*-
"""
_apply_review_revoke.py —— 把「人工复核判定误判」的场次分数补回（飞书「主播日报」表）

背景（老大 2026-10-26 14:4x 明确）：
  · 复核违规 =「是」⇒ 没有误判
  · 复核违规 =「否」⇒ 看「误判内容」确认误判了哪些 ⇒ 分数要补回
  · 复核 = 空 ⇒ 未复核

本脚本处理「复核=否 + AI 有违规痕迹 + 仍按 0 计」的 16 行：
  「综合评分」0 → 「未记录 违规-综合评分」的真值（来自存档 rawTotal / 精确复算）
  并在「误判内容」末尾追加撤销留痕（不动原文）

⚠️ 为什么直连飞书、不走工作台撤销按钮：
  实测老大浏览器 localStorage 的 `grading_detail_v1` 只剩 10 条（08-18~10-20 其他人的），
  这 16 场存档**已不存在** ⇒ 工作台历史详情里本来就看不到它们，撤销按钮无从点起。
  所以飞书是这 16 场的唯一数据源，直接改飞书不会造成"工作台与飞书不一致"。

安全边界（项目铁律）：
  - **默认 dry-run**：只读 + 出清单，绝不写
  - 真写必须显式 `--apply`
  - 真写前把全表记录导出到 `_bak/review-revoke-<时间>/`
  - 写前用 field_id 校验两列仍在且未改名（改名 ⇒ 立刻停）
  - 只动计划内 record_id，逐条写、任何一条失败立刻停
  - 已非 0 分的行默认跳过（防重复补分）
  - `--only-safe` ：只补「v3.1.3 重判后已无任何该判项」的行（其余只列不改）

用法：
  python _apply_review_revoke.py                  # 演练
  python _apply_review_revoke.py --only-safe      # 演练（只看安全子集）
  python _apply_review_revoke.py --apply          # 真写全部
  python _apply_review_revoke.py --apply --only-safe
"""
import io
import json
import os
import sys
import time
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
TABLE_ID = 'tblQC7Jfzmxp6QJI'
STAMP = time.strftime('%Y%m%d-%H%M%S')
APPLY = '--apply' in sys.argv
ONLY_SAFE = '--only-safe' in sys.argv
BACKUP_DIR = os.path.join(HERE, '_bak', 'review-revoke-' + STAMP)
PLAN_PATH = os.path.join(HERE, '_apply_review_revoke.plan.txt')

# 列定义（2026-10-26 GET /fields 实测）
F_TOTAL = {'id': 'fldGUbSWmz', 'name': '综合评分'}
F_WRONG = {'id': 'fldNXVyxNm', 'name': '误判内容'}
F_RAW = {'id': 'fldfcibJNi', 'name': '未记录 违规-综合评分'}

log_lines = []


def say(s=''):
    print(s)
    log_lines.append(str(s))


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


def http_json(url, method='GET', body=None, headers=None, timeout=90):
    h = {'Content-Type': 'application/json; charset=utf-8'}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def txt(v):
    if isinstance(v, list):
        return ''.join(s.get('text', '') if isinstance(s, dict) else str(s) for s in v)
    return '' if v is None else str(v)


def fmt_num(x):
    """50.0 → '50'；49.5 → '49.5'（与前端 String(total) 同表现）"""
    if x is None:
        return ''
    f = float(x)
    if f == int(f):
        return str(int(f))
    return str(f)


def parse_raw_value(raw_text):
    """从「未记录 违规-综合评分」的文本里取数值，如 '50（精确）' → 50.0"""
    s = str(raw_text or '').strip()
    if not s:
        return None, ''
    num_part = s.split('（')[0].split('(')[0].strip()
    try:
        return float(num_part), s
    except Exception:
        return None, s


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
        say('!! 凭证不全')
        return 2

    auth = http_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                     method='POST', body={'app_id': app_id, 'app_secret': app_secret})
    if auth.get('code') != 0:
        say('!! 鉴权失败: ' + str(auth.get('msg')))
        return 2
    token = auth['tenant_access_token']
    hdr = {'Authorization': 'Bearer ' + token}
    say('模式：%s%s' % ('★ 真写（--apply）' if APPLY else '演练（dry-run，不写任何数据）',
                       '｜仅安全子集 --only-safe' if ONLY_SAFE else ''))
    say('鉴权 OK')

    # ---- ① 列校验 ----
    rf = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/fields?page_size=200'
                   % (base, TABLE_ID), headers=hdr)
    fields = (rf.get('data') or {}).get('items') or []
    byid = {f.get('field_id'): f for f in fields}
    for spec in (F_TOTAL, F_WRONG, F_RAW):
        f = byid.get(spec['id'])
        if not f:
            say('!! 找不到 field_id=%s（%s）⇒ 列可能被删除，停止' % (spec['id'], spec['name']))
            return 3
        if (f.get('field_name') or '') != spec['name']:
            say('!! 列名已变：期望 %r，实际 %r ⇒ 停止（防写错列）'
                % (spec['name'], f.get('field_name')))
            return 3
        say('列校验 OK：%r（field_id=%s type=%s）' % (spec['name'], spec['id'], f.get('type')))

    # ---- ② 拉全量 + 备份 ----
    recs = fetch_all(token, base)
    say('表内记录 %d 条' % len(recs))
    os.makedirs(BACKUP_DIR, exist_ok=True)
    bak = os.path.join(BACKUP_DIR, 'daily-records.before.json')
    with io.open(bak, 'w', encoding='utf-8') as f:
        json.dump(recs, f, ensure_ascii=False, indent=1)
    say('已备份 → %s（%d B）' % (bak, os.path.getsize(bak)))

    # ---- ③ 组装计划（数据源：repair_inputs 的 zero16 + rejudge 的重判结论）----
    inp = json.load(io.open(os.path.join(HERE, '_bak', 'repair_inputs.json'), encoding='utf-8'))
    rj = json.load(io.open(os.path.join(HERE, '_bak', 'rejudge_v313.json'), encoding='utf-8'))
    rj_map = {}
    for r in rj['groups']['zero16']:
        rj_map[(r['date'], r['host'])] = r

    rec_by_rid = {r.get('record_id'): r for r in recs}
    plan, skipped = [], []

    for row in inp['zero16']:
        rid = row['rid']
        key = (row['date'], row['host'])
        rjr = rj_map.get(key, {})
        rec = rec_by_rid.get(rid)
        if not rec:
            skipped.append({'host': row['host'], 'date': row['date'], 'why': '表里找不到该 record_id'})
            continue
        f = rec.get('fields') or {}
        cur_total = txt(f.get('综合评分')).strip()
        cur_raw = txt(f.get('未记录 违规-综合评分')).strip()
        cur_wrong = txt(f.get('误判内容')).strip()
        cur_v2 = txt(f.get('复核违规')).strip()

        if cur_v2 != '否':
            skipped.append({'host': row['host'], 'date': row['date'],
                            'why': '复核列当前=%r（期望「否」），跳过' % cur_v2})
            continue
        if cur_total not in ('0', '0.0', '0.00'):
            skipped.append({'host': row['host'], 'date': row['date'],
                            'why': '总分当前=%r 已非 0（可能已补过），跳过' % cur_total})
            continue
        val, raw_text = parse_raw_value(cur_raw)
        if val is None:
            skipped.append({'host': row['host'], 'date': row['date'],
                            'why': '「未记录 违规-综合评分」取不到数值：%r' % cur_raw})
            continue

        still_zero = bool(rjr.get('stillZero'))
        safe = (not still_zero) and bool(rjr.get('ok'))

        stamp = time.strftime('%Y-%m-%d %H:%M')
        note = '\n---\n✅ 人工复核判定「不违规」（复核违规=否）· 红线判罚已撤销 · %s\n' \
               '总分已按「未记录 违规-综合评分」回填为 %s。%s' % (
                   stamp, fmt_num(val),
                   '' if safe else '\n⚠️ 注：现行规则对该场仍有命中项，重新评分时会再次判 0（撤销属人工优先）。')
        new_wrong = (cur_wrong + note) if cur_wrong else note.strip()

        plan.append({
            'rid': rid, 'host': row['host'], 'date': row['date'],
            'cur_total': cur_total, 'new_total': fmt_num(val),
            'cur_raw': cur_raw, 'wrong_append': new_wrong,
            'still_zero': still_zero, 'safe': safe,
        })

    # ---- ④ 汇总 ----
    safe_list = [p for p in plan if p['safe']]
    risky_list = [p for p in plan if not p['safe']]
    target = safe_list if ONLY_SAFE else plan

    say()
    say('===== 补分计划 =====')
    say('  复核=否 且 仍按 0 计 且 未补过 ：%d 条' % len(plan))
    say('    ├ ✅ v3.1.3 重判后已无该判项（安全）：%d 条' % len(safe_list))
    say('    └ ⚠️ 重判后仍有该判项（人工优先）  ：%d 条' % len(risky_list))
    say('  本轮%s目标                      ：%d 条'
        % ('（--only-safe）' if ONLY_SAFE else '', len(target)))
    say('  跳过                            ：%d 条' % len(skipped))
    say()
    say('  —— 待补分明细 ——')
    for i, p in enumerate(target, 1):
        say('  %3d. %-6s %s   总分 %s → %s   （违规项分 %s）%s'
            % (i, p['host'], p['date'], p['cur_total'], p['new_total'], p['cur_raw'],
               '' if p['safe'] else '  ⚠️规则仍判'))
    if risky_list and ONLY_SAFE:
        say()
        say('  —— 本轮不动的「规则仍判」场次（%d 条，加 --apply 不带 --only-safe 才会写）——'
            % len(risky_list))
        for i, p in enumerate(risky_list, 1):
            say('  %3d. %-6s %s   总分 %s → %s   （违规项分 %s）'
                % (i, p['host'], p['date'], p['cur_total'], p['new_total'], p['cur_raw']))
    if skipped:
        say()
        say('  —— 跳过（%d 条）——' % len(skipped))
        for i, s in enumerate(skipped, 1):
            say('  %3d. %-6s %s  ← %s' % (i, s['host'], s['date'], s['why']))

    with io.open(PLAN_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(log_lines) + '\n')
    say()
    say('清单已写入 → ' + PLAN_PATH)

    if not APPLY:
        say()
        say('== 演练结束，未发送任何写请求。确认清单无误后加 --apply 真写 ==')
        return 0

    # ---- ⑤ 真写（逐条；失败即停）----
    say()
    say('===== 开始真写 %d 条 =====' % len(target))
    ok = 0
    for i, p in enumerate(target, 1):
        body = {'fields': {F_TOTAL['name']: p['new_total'], F_WRONG['name']: p['wrong_append']}}
        try:
            r = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records/%s'
                          % (base, TABLE_ID, p['rid']), method='PUT', body=body, headers=hdr)
        except urllib.error.HTTPError as e:
            say('!! 第 %d 条 HTTP %s: %s ⇒ 停止' % (i, e.code, e.read()[:300]))
            return 4
        if r.get('code') != 0:
            say('!! 第 %d 条写入失败: %s ⇒ 停止（已写 %d 条）'
                % (i, str(r.get('msg')) + ' code=' + str(r.get('code')), ok))
            return 4
        ok += 1
        say('  已写 %d/%d：%s %s  %s → %s' % (ok, len(target), p['host'], p['date'], p['cur_total'], p['new_total']))
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
