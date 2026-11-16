# -*- coding: utf-8 -*-
"""「误判内容」列全量分类（只读飞书，不改任何数据）。

老大 11-16 要求：「飞书表中误判内容请仔细检索分类清楚」。
输出：
  ① 复核结论 × 分类 交叉表
  ② 触发词在两个结论下的分布（证明不能按词条一刀切）
  ③ 每行条目数分布 + 行内重复检测
  ④ 完整明细 CSV（按复核结论分组），供业务逐条核对
"""
import collections
import csv
import datetime
import json
import os
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, '_verify')


def env():
    e = {}
    for line in open(os.path.join(REPO, '.env'), encoding='utf-8', errors='replace'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            e[k.strip()] = v.strip()
    return e


def token(e):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        data=json.dumps({'app_id': e['FEISHU_APP_ID'], 'app_secret': e['FEISHU_APP_SECRET']}).encode(),
        method='POST', headers={'Content-Type': 'application/json'})
    return json.loads(op.open(req, timeout=60).read().decode())['tenant_access_token']


def fetch(e, tok):
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    H = {'Authorization': 'Bearer ' + tok}
    rows, pt = [], ''
    while True:
        u = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/tblQC7Jfzmxp6QJI'
             '/records?page_size=500&field_names=%s' % (
                 e['FEISHU_BASE_TOKEN'],
                 urllib.request.quote(json.dumps(['主播', '日期', '复核违规', '误判内容']))))
        if pt:
            u += '&page_token=' + pt
        j = json.loads(op.open(urllib.request.Request(u, headers=H), timeout=120).read().decode())
        if j.get('code') != 0:
            raise RuntimeError('%s %s' % (j.get('code'), j.get('msg')))
        d = j.get('data') or {}

        def txt(v):
            if v is None:
                return ''
            if isinstance(v, list):
                return ''.join(x.get('text', '') if isinstance(x, dict) else str(x) for x in v)
            if isinstance(v, dict):
                return v.get('text', '') or ''
            return str(v)

        for it in d.get('items') or []:
            f = it.get('fields') or {}
            rows.append({'rid': it.get('record_id'),
                         'host': txt(f.get('主播')).strip(),
                         'date': txt(f.get('日期')),
                         'rev': txt(f.get('复核违规')).strip(),
                         'raw': txt(f.get('误判内容'))})
        pt = d.get('page_token') or ''
        if not d.get('has_more'):
            break
    return rows


def dk(v):
    try:
        s = str(v).strip()
        if re.fullmatch(r'\d{12,13}', s):
            return datetime.datetime.fromtimestamp(int(s) / 1000).strftime('%Y-%m-%d')
        return s
    except Exception:
        return str(v)


def parse_items(raw):
    """把「误判内容」拆成条目：序号. 内容；紧跟的一行「原句」并入上一条。"""
    out = []
    for line in (raw or '').split('\n'):
        s = line.strip()
        if not s:
            continue
        m = re.match(r'^(\d+)\.\s*(.*)$', s)
        if m:
            out.append({'no': int(m.group(1)), 'text': m.group(2), 'quote': ''})
        elif out:
            out[-1]['quote'] = s.strip('「」　 ')
    for o in out:
        t = o['text']
        mm = re.search(r'触发词「([^」]{1,30})」', t)
        o['term'] = mm.group(1) if mm else ''
        mc = re.search(r'\[(S[12]-[0-9A-Za-z]+)\]', t)
        o['code'] = mc.group(1) if mc else ''
        mo = re.search(r'\[([^\]]*(?:字面|语义|S1|S2)[^\]]*)\]\s*([\d:]{4,8})?', t)
        o['channel'] = mo.group(1) if mo else ''
        o['ts'] = mo.group(2) if (mo and mo.group(2)) else ''
        # 分类名：剥掉规则编号、触发词、通道标记、×N 倍数、时间戳、撤销标记 ⇒ 只留纯中文分类
        nm = t
        nm = re.sub(r'触发词「[^」]*」', ' ', nm)
        nm = re.sub(r'\[[^\]]*\]', ' ', nm)
        nm = re.sub(r'×\s*\d+', ' ', nm)
        nm = re.sub(r'\d{1,2}:\d{2}(?::\d{2})?', ' ', nm)
        nm = re.sub(r'✗\s*已撤销（误判）', ' ', nm)
        nm = re.sub(r'[\s\u3000]+', ' ', nm).strip()
        o['cat'] = nm
    return out


def main():
    e = env()
    tok = token(e)
    rows = fetch(e, tok)
    print('日报表记录数 = %d' % len(rows))
    dist = collections.Counter(r['rev'] or '(空)' for r in rows)
    print('复核违规分布:', dict(dist))

    for r in rows:
        r['dk'] = dk(r['date'])
        r['items'] = parse_items(r['raw'])

    # ① 分类交叉表
    cat = collections.Counter()
    chan = collections.Counter()
    for r in rows:
        tag = r['rev'] or '空'
        for it in r['items']:
            cat[(tag, it['cat'] or '(未识别)')] += 1
            if it['channel']:
                chan[(tag, it['channel'])] += 1

    print('\n' + '=' * 74)
    print('① 复核结论 × 违规分类（条目数）')
    print('=' * 74)
    cats = sorted({k[1] for k in cat}, key=lambda c: -(cat[('否', c)] + cat[('是', c)]))
    print('%-30s %8s %8s' % ('分类', '复核=否', '复核=是'))
    print('-' * 50)
    for c in cats:
        a, b = cat[('否', c)], cat[('是', c)]
        if a + b == 0:
            continue
        print('%-30s %8d %8d' % (c[:28], a, b))

    print('\n' + '=' * 74)
    print('② 触发词在两个复核结论下的分布（证明不能按词条一刀切）')
    print('=' * 74)
    byt = collections.defaultdict(lambda: {'否': 0, '是': 0})
    for r in rows:
        tag = r['rev']
        if tag not in ('否', '是'):
            continue
        for it in r['items']:
            if it['term']:
                byt[it['term']][tag] += 1
    print('%-16s %8s %8s   %s' % ('触发词', '判误判', '判违规', '结论'))
    print('-' * 58)
    for k, v in sorted(byt.items(), key=lambda x: -(x[1]['否'] + x[1]['是']))[:18]:
        both = '两边都有 ← 只能按行判' if (v['否'] and v['是']) else ('只判误判' if v['否'] else '只判违规')
        print('%-16s %8d %8d   %s' % (k, v['否'], v['是'], both))
    both_cnt = sum(1 for v in byt.values() if v['否'] and v['是'])
    print('\n两个结论都出现过的触发词: %d / %d' % (both_cnt, len(byt)))

    # ③ 每行条目数 + 行内重复
    print('\n' + '=' * 74)
    print('③ 每行条目数与行内重复')
    print('=' * 74)
    per = collections.Counter()
    dup_rows = []
    for r in rows:
        n = len(r['items'])
        per[(r['rev'] or '空', n)] += 1
        terms = [it['term'] for it in r['items'] if it['term']]
        codes = [it['code'] for it in r['items'] if it['code']]
        dt = {t for t in terms if terms.count(t) > 1}
        dc = {c for c in codes if codes.count(c) > 1}
        if dt or dc:
            dup_rows.append((r, sorted(dt), sorted(dc)))
    print('复核=否 条目数分布:', {k[1]: v for k, v in sorted(per.items()) if k[0] == '否'})
    print('复核=是 条目数分布:', {k[1]: v for k, v in sorted(per.items()) if k[0] == '是'})
    print('行内出现重复触发词/编号的行数:', len(dup_rows))
    for r, dt, dc in dup_rows[:10]:
        print('   %-8s %s  重复触发词=%s 重复编号=%s' % (r['host'], r['dk'], dt, dc))

    # ④ 完整明细 CSV
    csv_path = os.path.join(OUT_DIR, '_review_classified.csv')
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['复核结论', '主播', '日期', '序号', '规则编号', '分类', '触发词', '通道', '时间戳', '原句', 'record_id'])
        order = {'否': 0, '': 1, '是': 2}
        for r in sorted(rows, key=lambda x: (order.get(x['rev'], 1), x['dk'], x['host'])):
            if not r['items']:
                w.writerow([r['rev'] or '(空)', r['host'], r['dk'], '', '', '(未填误判内容)', '', '', '', '', r['rid']])
                continue
            for it in r['items']:
                w.writerow([r['rev'] or '(空)', r['host'], r['dk'], it['no'], it['code'], it['cat'],
                            it['term'], it['channel'], it['ts'], it['quote'], r['rid']])
    print('\n明细 CSV 已落盘:', csv_path)

    raw_path = os.path.join(OUT_DIR, '_review_raw.json')
    json.dump([{k: v for k, v in r.items() if k != 'items'} | {'items': r['items']} for r in rows],
              open(raw_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('原始 JSON 已落盘:', raw_path)

    # 汇总
    print('\n' + '=' * 74)
    print('汇总')
    print('=' * 74)
    for tag in ('否', '是', '空'):
        sub = [r for r in rows if (r['rev'] or '空') == tag]
        withitems = [r for r in sub if r['items']]
        n_items = sum(len(r['items']) for r in sub)
        print('复核=%-3s 行数 %3d  其中有误判内容 %3d  条目合计 %4d' % (tag, len(sub), len(withitems), n_items))
    return 0


if __name__ == '__main__':
    sys.exit(main())
