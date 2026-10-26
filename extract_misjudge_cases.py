# -*- coding: utf-8 -*-
"""
extract_misjudge_cases.py —— 从飞书「主播日报」抽取「人工判为误判」的样本，结构化成规则调优用例库

口径（关键）：
  误判样本 = 「初审违规=否」或「复核违规=否」 且 AI 侧有痕迹（按0计/已撤销/已标注）
  ⚠️ 「误判内容」列初审=是 的行也填了（是正常命中原文），必须联表取，不能单列统计

输出：_misjudge_cases.json（结构化）+ 控制台按词条分组打印原文
安全：只发 GET。
"""
import io, json, os, re, sys, datetime, urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TABLE_ID = 'tblQC7Jfzmxp6QJI'


def load_env(p):
    d = {}
    with io.open(p, encoding='utf-8', errors='replace') as f:
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


def txt(v):
    if isinstance(v, list):
        return ''.join(s.get('text', '') if isinstance(s, dict) else str(s) for s in v)
    if isinstance(v, bool):
        return '是' if v else '否'
    return '' if v is None else str(v)


def date_of(v):
    if v is None:
        return ''
    if isinstance(v, list):
        v = v[0] if v else None
        if isinstance(v, dict):
            v = v.get('value') or v.get('text')
    try:
        n = int(v)
    except Exception:
        return str(v)[:10]
    if n > 1e12:
        n = n / 1000.0
    return datetime.datetime.fromtimestamp(n + 8 * 3600, datetime.timezone.utc).strftime('%Y-%m-%d')


def parse_items(s):
    """把「误判内容」文本切成条目：[{code,name,term,channel,time,quote,raw}]"""
    out = []
    if not s:
        return out
    for seg in re.split(r'\n(?=\d+\.\s)', s):
        seg = seg.strip()
        if not seg:
            continue
        seg = re.sub(r'^\d+\.\s*', '', seg)
        lines = [x.strip() for x in seg.split('\n') if x.strip()]
        head = lines[0] if lines else ''
        quote = ' / '.join(lines[1:]) if len(lines) > 1 else ''
        m = re.search(r'\[(S[12]-\d+[A-Za-z]?)\]', head)
        code = m.group(1) if m else ''
        # 词条名：去掉编号后、到全角空格或 [ 之前
        h2 = re.sub(r'^\d+\.\s*', '', head)
        h2 = re.sub(r'^\[S[12]-\d+[A-Za-z]?\]\s*', '', h2)
        name = re.split(r'[\u3000\[]', h2)[0].strip()[:30]
        mt = re.search(r'触发词「([^」]{1,24})」', head)
        term = mt.group(1) if mt else ''
        ch = ''
        for k in ('语义（整场归0）', '字面（整场归0）', 'C列标注项', '语义', '字面'):
            if k in head:
                ch = k
                break
        mtime = re.search(r'(\d{2}:\d{2}:\d{2})', head)
        out.append({'code': code, 'name': name, 'term': term, 'channel': ch,
                    'time': mtime.group(1) if mtime else '', 'quote': quote, 'raw': seg})
    return out


def main():
    env = load_env(os.path.join(HERE, '.env'))
    auth = http_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
                     method='POST', body={'app_id': env['FEISHU_APP_ID'],
                                          'app_secret': env['FEISHU_APP_SECRET']})
    hdr = {'Authorization': 'Bearer ' + auth['tenant_access_token']}
    base = env['FEISHU_BASE_TOKEN']
    recs, pt = [], ''
    while True:
        u = ('https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records?page_size=200'
             % (base, TABLE_ID)) + (('&page_token=' + pt) if pt else '')
        r = http_json(u, headers=hdr)
        d = r.get('data') or {}
        recs.extend(d.get('items') or [])
        if not d.get('has_more'):
            break
        pt = d.get('page_token') or ''
        if not pt:
            break

    cases, pending = [], []
    for rec in recs:
        f = rec.get('fields') or {}
        v1 = txt(f.get('初审违规')).strip()
        v2 = txt(f.get('复核违规')).strip()
        rl = txt(f.get('命中平台红线 —— 本场总分按 0 计')).strip()
        an = txt(f.get('已标注（不判 0 分）')).strip()
        has_trace = ('按 0 计' in rl) or ('已撤销' in rl) or bool(an)
        row = {'rid': rec.get('record_id'), 'host': txt(f.get('主播')).strip(),
               'date': date_of(f.get('日期')), 'room': txt(f.get('直播间')).strip(),
               'v1': v1, 'v2': v2, 'total': txt(f.get('综合评分')).strip(),
               'redline': rl.split('\n')[0][:60], 'annot': an.split('\n')[0][:40],
               'raw_text': txt(f.get('误判内容')).strip()}
        if has_trace and v1 == '否':
            row['items'] = parse_items(row['raw_text'])
            cases.append(row)
        elif has_trace and v1 == '':
            pending.append(row)

    # 按词条聚合
    by_code = defaultdict(list)
    by_term = defaultdict(list)
    for c in cases:
        for it in c['items']:
            key = it['code'] or it['name'] or '(未解析)'
            by_code[key].append((c, it))
            if it['term']:
                by_term[it['term']].append((c, it))

    print('=== 误判样本：%d 场 / %d 条命中 ===' % (len(cases), sum(len(c['items']) for c in cases)))
    print('=== 待复核（AI 判过但没人填初审）：%d 场 ===\n' % len(pending))

    print('########## 按词条分组：原文语境（用于判断为什么错） ##########')
    for key in sorted(by_code, key=lambda k: -len(by_code[k])):
        arr = by_code[key]
        print('\n───── %s  （%d 处）─────' % (key, len(arr)))
        for c, it in arr:
            print('  [%s %s] %s%s' % (c['date'], c['host'],
                                      ('通道=%s ' % it['channel']) if it['channel'] else '',
                                      ('词=%s ' % it['term']) if it['term'] else ''))
            print('      %s' % (it['quote'][:220] or '(无原文)'))

    print('\n\n########## 按主播 ##########')
    for k, v in Counter(c['host'] for c in cases).most_common():
        print('  %-8s %d' % (k, v))

    out = os.path.join(HERE, '_bak', '_misjudge_cases.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, 'w', encoding='utf-8') as fp:
        json.dump({'generated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                   'rule': '初审违规=否 且 AI 有违规痕迹',
                   'cases': cases,
                   'pending_review_count': len(pending)}, fp, ensure_ascii=False, indent=1)
    print('\n样本库已存 → %s' % out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
