# -*- coding: utf-8 -*-
"""
v4.11.63 推送后「仓库内容逐字节核对」。
铁律：远端基线一律现查，不硬编码；走环境代理（直连 api.github.com 常 10060 超时）。
"""
import base64
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(errors='replace')
OWNER, REPO = 'Mightymojoy', 'ITO-AI-Grading'
REPO_DIR = r'C:\Users\QwQ\WorkBuddy\2026-08-28-11-01-39\ITO-AI-Grading'
OP = urllib.request.build_opener()          # 走环境代理

FILES = ['api/feishu-read.js', 'api/feishu-sync.js', 'v4/v4-shell.js', 'v4/index.html']

PASS, FAIL = [], []


def chk(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print('%s %-52s %s' % ('  OK ' if cond else ' FAIL', name, detail))


def api(path, tries=4):
    url = 'https://api.github.com' + path
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers={
            'User-Agent': 'ito-agent', 'Accept': 'application/vnd.github+json',
            'Cache-Control': 'no-cache',
        })
        try:
            r = OP.open(req, timeout=90)
            return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            last = '%s %s' % (type(e).__name__, e)
            print('    (第 %d 次失败：%s，重试)' % (i + 1, last[:70]))
            time.sleep(1.5)
    raise RuntimeError('API 失败 ' + path + ' : ' + str(last))


def local_md5(p):
    b = open(REPO_DIR + '\\' + p.replace('/', '\\'), 'rb').read()
    return hashlib.md5(b).hexdigest(), len(b)


print('=== 1. 远端 master 与 tree ===')
ref = api('/repos/%s/%s/git/ref/heads/master' % (OWNER, REPO))
sha = ref['object']['sha']
cm = api('/repos/%s/%s/git/commits/%s' % (OWNER, REPO, sha))
print('  远端 master =', sha)
print('  远端 tree   =', cm['tree']['sha'])
print('  远端首行    =', cm['message'].splitlines()[0][:80])
chk('1.1 master 指向本次推送提交', sha.startswith('16ac42e7'), sha[:12])
chk('1.2 tree 与本地 HEAD 一致', cm['tree']['sha'] == 'a79514f219f785fade01e4bc1723c5ec7fb31d46',
    cm['tree']['sha'][:12])

print()
print('=== 2. 远端四个文件逐字节比对 ===')
tree = api('/repos/%s/%s/git/trees/%s?recursive=1' % (OWNER, REPO, cm['tree']['sha']))
bymap = {x['path']: x['sha'] for x in tree.get('tree', []) if x['type'] == 'blob'}
for f in FILES:
    lmd5, lsize = local_md5(f)
    if f not in bymap:
        chk('2.%s 远端存在' % f, False, '不在 tree 中')
        continue
    blob = api('/repos/%s/%s/git/blobs/%s' % (OWNER, REPO, bymap[f]))
    raw = base64.b64decode(blob['content'])
    rmd5 = hashlib.md5(raw).hexdigest()
    chk('2.x %-20s 逐字节一致' % f, rmd5 == lmd5 and len(raw) == lsize,
        'local %d B / remote %d B %s' % (lsize, len(raw), 'md5同' if rmd5 == lmd5 else 'md5异'))

print()
print('=== 3. 远端 v4-shell.js 版本号 ===')
shell = base64.b64decode(api('/repos/%s/%s/git/blobs/%s' % (OWNER, REPO, bymap['v4/v4-shell.js']))['content']).decode('utf-8')
html = base64.b64decode(api('/repos/%s/%s/git/blobs/%s' % (OWNER, REPO, bymap['v4/index.html']))['content']).decode('utf-8')
import re
m = re.search(r"var V4_VERSION = '([^']+)'", shell)
chk('3.1 V4_VERSION = v4.11.63', m and m.group(1) == 'v4.11.63', m.group(1) if m else 'N/A')
chk('3.2 index.html 含 4.11.63', '4.11.63' in html, 'count=%d' % html.count('4.11.63'))
# 4.11.62 允许且只允许出现在「页脚更新日志」的历史说明里；四处版本号锚点必须是 4.11.63
_anchors = {
    'brandVer': re.search(r'id="brandVer"[^>]*>v?([\d.]+)<', html),
    'pageBadge': re.search(r'id="pageBadge"[^>]*>v?([\d.]+)<', html),
    'footVer': re.search(r'id="footVer"[^>]*>v?([\d.]+)<', html),
    'script': re.search(r'v4-shell\.js\?v=([\d.]+)', html),
}
_bad = [k for k, m in _anchors.items() if not m or m.group(1) != '4.11.63']
chk('3.3 四处版本锚点均为 4.11.63', not _bad, 'bad=' + str(_bad))
# 旧版本号只能出现在更新日志段落（同一行含「起：」）
_old_lines = [l for l in html.split('\n') if '4.11.62' in l]
chk('3.4 4.11.62 仅存于更新日志说明', all('起：' in l or '更新日志' in l for l in _old_lines),
    '出现行数=%d' % len(_old_lines))

print()
print('=== 4. 远端接口代码含本次修复标志 ===')
read_js = base64.b64decode(api('/repos/%s/%s/git/blobs/%s' % (OWNER, REPO, bymap['api/feishu-read.js']))['content']).decode('utf-8')
sync_js = base64.b64decode(api('/repos/%s/%s/git/blobs/%s' % (OWNER, REPO, bymap['api/feishu-sync.js']))['content']).decode('utf-8')
chk('4.1 read: 含 1254045 兜底', '1254045' in read_js)
chk('4.2 read: 含 omit 参数', 'omitSet' in read_js)
chk('4.3 sync: 含全量分页', 'page_token' in sync_js and 'records?page_size=500' in sync_js,
    'page_size=200 残留=%d' % sync_js.count('page_size=200'))
# 语义判据：错误分支必须 throw；且不存在 `if(r.code !== 0) return []` 这种把错误吞成空数组的写法
_lr = sync_js.split('async function listRecords')[1]
_lr = _lr[:1200]
chk('4.4 sync: 错误分支抛错而非吞空',
    "throw new Error('拉取记录失败" in _lr and 'code !== 0) return []' not in _lr.replace(' ', ''),
    'throw=%s' % ("throw new Error('拉取记录失败" in _lr))

print()
print('===== 合计 %d PASS / %d FAIL =====' % (len(PASS), len(FAIL)))
if FAIL:
    print('FAILED:', FAIL)
sys.exit(0 if not FAIL else 1)
