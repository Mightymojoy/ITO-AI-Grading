# -*- coding: utf-8 -*-
"""
build_misjudge_fixtures.py —— 从飞书拉两套回归语料（只读）

  ① neg.json  —— 「应不判」（误判样本）：初审违规=否 且 AI 有痕迹 → 取「误判内容」里的引文
  ② pos.json  —— 「应仍判」（真违规）：初审违规=是 且 误判内容有值 → 取引文

⚠️ 「误判内容」列初审=**是**的行也填了内容（正常命中原文）⇒ 两套都必须联表取，
   **绝不能**只按列名取（那会把真违规当误判，把口径做反）。
安全：只发 GET。
"""
import io, json, os, re, sys, datetime, urllib.request

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
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            detail = ''
            try:
                detail = e.read().decode('utf-8', 'replace')[:300]
            except Exception:
                pass
            last = 'HTTP %s %s | url=%s | body=%s' % (e.code, detail, url[:160], str(body)[:120])
            time.sleep(1.2 * (attempt + 1))
        except Exception as e:
            last = '%s | url=%s' % (e, url[:160])
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(last or 'http_json failed')


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
        h2 = re.sub(r'^\[S[12]-\d+[A-Za-z]?\]\s*', '', head)
        name = re.split(r'[\u3000\[]', h2)[0].strip()[:30]
        mt = re.search(r'触发词「([^」]{1,24})」', head)
        ch = ''
        for k in ('语义（整场归0）', '字面（整场归0）', 'C列标注项'):
            if k in head:
                ch = k
                break
        out.append({'code': (m.group(1) if m else ''), 'name': name,
                    'term': (mt.group(1) if mt else ''), 'channel': ch, 'quote': quote})
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

    neg, pos = [], []
    for rec in recs:
        f = rec.get('fields') or {}
        v1 = txt(f.get('初审违规')).strip()
        rl = txt(f.get('命中平台红线 —— 本场总分按 0 计')).strip()
        an = txt(f.get('已标注（不判 0 分）')).strip()
        has_trace = ('按 0 计' in rl) or ('已撤销' in rl) or bool(an)
        if not has_trace:
            continue
        raw = txt(f.get('误判内容')).strip()
        items = parse_items(raw)
        row = {'host': txt(f.get('主播')).strip(), 'date': date_of(f.get('日期')),
               'v1': v1, 'items': items}
        if v1 == '否':
            neg.append(row)
        elif v1 == '是':
            pos.append(row)

    def flatten(rows, label):
        segs, seen = [], set()
        for r in rows:
            for it in r['items']:
                q = it['quote']
                # 引文去掉分句连接符与括号，取最长一段做扫描输入
                cand = [x.strip().strip('「」') for x in q.split(' / ') if x.strip()]
                cand = [c for c in cand if len(c) >= 4]
                if not cand:
                    continue
                text = max(cand, key=len)
                key = (it['code'], it['term'], text)
                if key in seen:
                    continue
                seen.add(key)
                segs.append({'code': it['code'], 'term': it['term'], 'name': it['name'],
                             'channel': it['channel'], 'text': text,
                             'from': '%s %s' % (r['date'], r['host'])})
        print('  %s: %d 场 → %d 条唯一引文' % (label, len(rows), len(segs)))
        return segs

    print('=== 抽取 ===')
    neg_segs = flatten(neg, '应不判（初审=否）')
    pos_segs = flatten(pos, '应仍判（初审=是）')

    outdir = os.path.join(HERE, '_bak', 'misjudge-fix-20261026')
    os.makedirs(outdir, exist_ok=True)
    for name, segs in (('neg.json', neg_segs), ('pos.json', pos_segs)):
        p = os.path.join(outdir, name)
        with io.open(p, 'w', encoding='utf-8') as fp:
            json.dump(segs, fp, ensure_ascii=False, indent=1)
        print('  → %s' % p)
    return 0


if __name__ == '__main__':
    sys.exit(main())
