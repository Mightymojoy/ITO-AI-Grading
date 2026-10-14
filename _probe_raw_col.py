# -*- coding: utf-8 -*-
"""
只读探针 · 查飞书「主播日报」表字段
目的：为「未记录 违规-综合评分」这一列的写回做准备，核实三件事 ——
  1) 该列在飞书里的**确切字段名**（空格 / 连字符是否逐字一致）
  2) 该列的**字段类型**（决定 API 写入时传 number 还是 string）
  3) 该列**历史是否已有值**（决定要不要回填）

安全边界：只发 GET（tables / fields / records），**不发任何写请求**（无 POST/PUT/DELETE 到 records）。
用法：python _probe_raw_col.py
"""
import io
import json
import os
import sys
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(HERE, '.env')
TARGET = '未记录 违规-综合评分'          # 老大口述的列名（待核实）
DAILY_TABLE_ID = 'tblQC7Jfzmxp6QJI'     # 主播日报

# 飞书多维表格字段类型码 → 可读名
TYPE_MAP = {
    1: '多行文本', 2: '数字', 3: '单选', 4: '多选', 5: '日期', 7: '复选框',
    11: '人员', 13: '电话号码', 15: '超链接', 17: '附件', 18: '单向关联', 19: '查找引用',
    20: '公式', 21: '双向关联', 22: '地理位置', 23: '群组',
    1001: '创建时间', 1002: '最后更新时间', 1003: '创建人', 1004: '修改人', 1005: '自动编号',
}

lines = []
def say(s=''):
    print(s)
    lines.append(str(s))

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

def http_json(url, method='GET', body=None, headers=None, timeout=30):
    h = {'Content-Type': 'application/json; charset=utf-8'}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()                      # 一次性收全
        return json.loads(raw.decode('utf-8'))  # 一次性解码

def dim(s):
    """把不可见/易混字符显形：空格、连字符、全角字符"""
    out = []
    for ch in s:
        if ch == ' ':
            out.append('·')          # 半角空格
        elif ch == '\u3000':
            out.append('□')          # 全角空格
        elif ch in ('-',):
            out.append('-')          # 半角连字符
        elif ch in ('\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015'):
            out.append('⁃')          # 其他连字符族
        else:
            out.append(ch)
    return ''.join(out)

def main():
    env = load_env(ENV_PATH)
    app_id = env.get('FEISHU_APP_ID', '')
    app_secret = env.get('FEISHU_APP_SECRET', '')
    base_token = env.get('FEISHU_BASE_TOKEN', '')
    say('凭证：APP_ID=%s...(%d)  BASE_TOKEN=%s...(%d)'
        % (app_id[:8], len(app_id), base_token[:6], len(base_token)))
    if not (app_id and app_secret and base_token):
        say('!! 凭证不全，终止'); return 2

    # ---- 1. 取 tenant_access_token ----
    r = http_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                  method='POST', body={'app_id': app_id, 'app_secret': app_secret})
    if r.get('code') != 0:
        say('!! 鉴权失败: %s' % r.get('msg')); return 2
    tok = r['tenant_access_token']
    auth = {'Authorization': 'Bearer ' + tok}
    say('鉴权 OK（token 长度 %d）' % len(tok))
    say()

    # ---- 2. 列出该多维表格的所有数据表 ----
    rt = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables?page_size=100'
                   % base_token, headers=auth)
    if rt.get('code') != 0:
        say('!! 取表列表失败: %s' % rt.get('msg')); return 2
    items = (rt.get('data') or {}).get('items') or []
    say('[2] 多维表格内共 %d 张表：' % len(items))
    for it in items:
        mark = '  ← 主播日报' if it.get('table_id') == DAILY_TABLE_ID else ''
        say('    %-24s %s%s' % (it.get('table_id'), it.get('name'), mark))
    say()

    # ---- 3. 取「主播日报」字段清单 ----
    rf = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/fields?page_size=200'
                   % (base_token, DAILY_TABLE_ID), headers=auth)
    if rf.get('code') != 0:
        say('!! 取字段失败: %s' % rf.get('msg')); return 2
    fields = (rf.get('data') or {}).get('items') or []
    say('[3] 「主播日报」共 %d 个字段：' % len(fields))
    for f in fields:
        t = f.get('type')
        say('    %-4s %-22s %s' % (t, TYPE_MAP.get(t, '未知'), f.get('field_name')))
    say()

    # ---- 4. 目标列核实 ----
    names = [f.get('field_name') or '' for f in fields]
    say('[4] 目标列核实：输入 = %r' % TARGET)
    say('    显形后     = %s' % dim(TARGET))
    hits_exact = [f for f in fields if (f.get('field_name') or '') == TARGET]
    hits_loose = [f for f in fields
                  if ('违规' in (f.get('field_name') or '')) or ('未记录' in (f.get('field_name') or ''))]
    if hits_exact:
        f = hits_exact[0]
        say('    ✅ 精确命中：%r  类型=%s'
            % (f.get('field_name'), TYPE_MAP.get(f.get('type'), f.get('type'))))
    else:
        say('    ❌ 无精确命中（逐字不一致）')
    if hits_loose:
        say('    宽松命中 %d 条（含「违规」或「未记录」）：' % len(hits_loose))
        for f in hits_loose:
            say('      %r  显形=%s  类型=%s  id=%s'
                % (f.get('field_name'), dim(f.get('field_name') or ''),
                   TYPE_MAP.get(f.get('type'), f.get('type')), f.get('field_id')))
    else:
        say('    宽松命中 0 条 —— 说明该列可能不在「主播日报」这张表')
    say()

    # ---- 5. 该列历史是否有值（抽样 200 条）----
    target_name = hits_exact[0].get('field_name') if hits_exact else (hits_loose[0].get('field_name') if hits_loose else None)
    rr = http_json('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=200'
                   % (base_token, DAILY_TABLE_ID), headers=auth)
    if rr.get('code') != 0:
        say('!! 取记录失败: %s' % rr.get('msg')); return 2
    recs = ((rr.get('data') or {}).get('items')) or []
    total = (rr.get('data') or {}).get('total')
    say('[5] 记录抽样：本页 %d 条，表内 total=%s' % (len(recs), total))
    if target_name:
        filled = 0
        shown = 0
        for rec in recs:
            v = (rec.get('fields') or {}).get(target_name)
            if v not in (None, '', []):
                filled += 1
                if shown < 5:
                    say('    有值：%s / %s → %r'
                        % ((rec.get('fields') or {}).get('主播'),
                           (rec.get('fields') or {}).get('日期'), v))
                    shown += 1
        say('    该列在本页 %d 条记录中【有值 %d 条 / 空 %d 条】'
            % (len(recs), filled, len(recs) - filled))
    say()

    # ---- 6. 「完整主播报告」里是否已带 rawTotal（决定回填数据源）----
    say('[6] 回填数据源探测 · 飞书「完整主播报告」里有没有 rawTotal：')
    rep_has = rep_json = rep_raw = 0
    raw_samples = []
    zero_n = 0
    month_hist = {}
    for rec in recs:
        f = rec.get('fields') or {}
        d = str(f.get('日期') or '')[:7]
        if d:
            month_hist[d] = month_hist.get(d, 0) + 1
        if str(f.get('综合评分') or '').strip() in ('0', '0.0'):
            zero_n += 1
        rep = f.get('完整主播报告')
        if isinstance(rep, list):                    # 飞书富文本可能返回数组
            rep = ''.join(seg.get('text', '') if isinstance(seg, dict) else str(seg) for seg in rep)
        if not rep:
            continue
        rep_has += 1
        try:
            j = json.loads(rep)
            rep_json += 1
        except Exception:
            continue
        rt = j.get('rawTotal')
        if isinstance(rt, (int, float)):
            rep_raw += 1
            if len(raw_samples) < 8:
                raw_samples.append((f.get('主播'), str(f.get('日期'))[:10],
                                    f.get('综合评分'), j.get('rawTotal'),
                                    j.get('rawGrade'), j.get('rawSrc')))
    say('    本页 %d 条中：有报告 %d 条 / 报告可解析 JSON %d 条 / 内含 rawTotal %d 条'
        % (len(recs), rep_has, rep_json, rep_raw))
    say('    「综合评分」= 0 的场次：%d 条' % zero_n)
    say('    月份分布：%s' % '  '.join('%s=%d' % (k, month_hist[k]) for k in sorted(month_hist)))
    if raw_samples:
        say('    样例（主播 / 日期 / 综合评分 / rawTotal / rawGrade / rawSrc）：')
        for s in raw_samples:
            say('      %s / %s / %s → %s (%s / %s)' % s)
    else:
        say('    ⚠️ 报告里没有 rawTotal ⇒ 回填数据源只能去评分端本地存档（localStorage）')
    say()

    # ---- 7. 回填可行性：判 0 的场次分别能走哪条路径 ----
    say('[7] 回填可行性（只统计「综合评分」= 0 的场次）：')
    n_exact = n_derived = n_blocked = n_norep = 0
    blocked_reason = {}
    derived_samples = []
    mod_shape = None
    for rec in recs:
        f = rec.get('fields') or {}
        if str(f.get('综合评分') or '').strip() not in ('0', '0.0', '0.00'):
            continue
        rep = f.get('完整主播报告')
        if isinstance(rep, list):
            rep = ''.join(seg.get('text', '') if isinstance(seg, dict) else str(seg) for seg in rep)
        if not rep:
            n_norep += 1
            blocked_reason['该场次无「完整主播报告」'] = blocked_reason.get('该场次无「完整主播报告」', 0) + 1
            continue
        try:
            j = json.loads(rep)
        except Exception:
            n_blocked += 1
            blocked_reason['报告不是合法 JSON'] = blocked_reason.get('报告不是合法 JSON', 0) + 1
            continue
        if isinstance(j.get('rawTotal'), (int, float)):
            n_exact += 1
            continue
        mods = j.get('mods') or []
        if mod_shape is None and mods and isinstance(mods[0], dict):
            mod_shape = sorted(mods[0].keys())
        sub = 0.0
        ok = False
        for m in mods:
            if isinstance(m, dict) and (m.get('weight') or 0) > 0 and isinstance(m.get('weighted'), (int, float)):
                sub += m['weighted']
                ok = True
        if ok:
            n_derived += 1
            if len(derived_samples) < 6:
                derived_samples.append((f.get('主播'), str(f.get('日期'))[:10], round(sub, 1)))
        else:
            n_blocked += 1
            blocked_reason['无 rawTotal 且无可反推的计权模块'] = blocked_reason.get('无 rawTotal 且无可反推的计权模块', 0) + 1

    say('    ① 有 rawTotal，可填「精确值」            ：%d 条' % n_exact)
    say('    ② 无 rawTotal 但模块可反推，可填「上限值」：%d 条' % n_derived)
    say('    ③ 拿不到（无报告）                       ：%d 条' % n_norep)
    say('    ④ 拿不到（报告在但数据不足）             ：%d 条' % n_blocked)
    say('    ⇒ 可回填合计 %d 条 / 判 0 场次共 %d 条' % (n_exact + n_derived, n_exact + n_derived + n_norep + n_blocked))
    if blocked_reason:
        say('    拿不到的原因分布：')
        for k in sorted(blocked_reason, key=lambda x: -blocked_reason[x]):
            say('      %s：%d 条' % (k, blocked_reason[k]))
    if mod_shape:
        say('    报告内 mods 元素的字段：%s' % ', '.join(mod_shape))
    if derived_samples:
        say('    反推样例（主播 / 日期 / 反推值=上限）：')
        for s in derived_samples:
            say('      %s / %s → %s' % s)
    say()
    say('== 探针结束（全程只读，未发送任何写请求）==')
    return 0

if __name__ == '__main__':
    try:
        code = main()
    except urllib.error.HTTPError as e:
        say('!! HTTP %s: %s' % (e.code, e.read()[:400]))
        code = 3
    except Exception as e:
        say('!! 异常: %s: %s' % (type(e).__name__, e))
        code = 4
    out = os.path.join(HERE, '_probe_raw_col.out.txt')
    try:
        with io.open(out, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
        print('\n[已写入] ' + out)
    except Exception as e:
        print('[写日志失败] %s' % e)
    sys.exit(code)
