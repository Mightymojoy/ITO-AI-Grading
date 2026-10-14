# -*- coding: utf-8 -*-
"""
v4.11.37 版本号落地：v4-shell.js 常量 + v4/index.html（徽标 3 处 + ?v= 5 处 + 功能说明 1 条）
铁律：禁止盲 replace_all —— 每一处都点名替换 + 计数断言（必须恰好 1 次），改完回读。
"""
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OLD = '4.11.36'
NEW = '4.11.37'
errors = []

def apply(path, reps):
    full = os.path.join(HERE, path)
    s = io.open(full, encoding='utf-8').read()
    for old, new, label in reps:
        if s.count(old) == 0:
            print('  skip（已应用） %s' % label)
            continue
        n = s.count(old)
        if n != 1:
            errors.append('[%s] %s 命中 %d 次（要求恰好 1 次）' % (path, label, n))
            continue
        s = s.replace(old, new)
        print('  ok  %-28s %s' % (label, old[:60].replace('\n', ' ')))
    io.open(full, 'w', encoding='utf-8', newline='\n').write(s)
    return s

print('[1] v4/v4-shell.js')
apply('v4/v4-shell.js', [
    ("var V4_VERSION = 'v4.11.36';", "var V4_VERSION = 'v4.11.37';", 'V4_VERSION 常量'),
    ("    version: '4.11.36',", "    version: '4.11.37',", 'V4RAW 诊断入口版本'),
])

print('[2] v4/index.html')
apply('v4/index.html', [
    ('<span id="brandVer">v4.11.36</span>', '<span id="brandVer">v4.11.37</span>', '徽标 brandVer'),
    ('id="pageBadge" data-page-node-id="9z31D7FDy8F5dHke5ZyDqg">v4.11.36<',
     'id="pageBadge" data-page-node-id="9z31D7FDy8F5dHke5ZyDqg">v4.11.37<', '徽标 pageBadge'),
    ('<span id="footVer">v4.11.36</span>', '<span id="footVer">v4.11.37</span>', '徽标 footVer'),
    ('src="app-core.js?v=4.11.36"', 'src="app-core.js?v=4.11.37"', '?v= app-core'),
    ('src="semantic-core.js?v=4.11.36"', 'src="semantic-core.js?v=4.11.37"', '?v= semantic-core'),
    ('src="violation-scan.js?v=4.11.36"', 'src="violation-scan.js?v=4.11.37"', '?v= violation-scan'),
    ('src="v4-shell.js?v=4.11.36"', 'src="v4-shell.js?v=4.11.37"', '?v= v4-shell'),
    ('src="workflow.js?v=4.11.36"', 'src="workflow.js?v=4.11.37"', '?v= workflow'),
    ('来源标记高对比显示））',
     '来源标记高对比显示 · v4.11.37 起：被判 0 分场次的「不计违规项综合评分」正式回写飞书独立列'
     '「未记录 违规-综合评分」（带「（精确）／（上限值）」口径标记；非判 0 场次留空；不改变本场 0 分判定））',
     '功能说明新增一条'),
])

print('[3] 回读断言')
shell = io.open(os.path.join(HERE, 'v4/v4-shell.js'), encoding='utf-8').read()
html = io.open(os.path.join(HERE, 'v4/index.html'), encoding='utf-8').read()
checks = [
    ('v4-shell.js  V4_VERSION = v4.11.37',
     "var V4_VERSION = 'v4.11.37';" in shell),
    ('v4-shell.js  V4RAW.version = 4.11.37',
     "    version: '4.11.37'," in shell),
    ('v4-shell.js  V4RAW_FMT 未被动（仍 4.11.35）',
     "var V4RAW_FMT = '4.11.35';" in shell),
    ('v4-shell.js  新增 v4.11.37 回写块存在',
     'window.V4RAWCOL' in shell and "var LS_OFF = 'v4rawcol_enabled';" in shell),
    ('v4-shell.js  飞书列名逐字正确',
     "field: '未记录 违规-综合评分'," in shell),
    # 旧文案：原句「不写回任何评分字段、不进飞书。</div>」应已消失；
    # 文件里仍允许出现 3 处「不进飞书」—— 均在讲「__ 前缀键写不进飞书」的注释里，
    # 以及本块注释对原句的引用，属合法保留（2026-10-14 实测 3 处，逐条目视核对过）。
    ('v4-shell.js  旧文案已消失（剩 3 处均为合法注释）',
     '不写回任何评分字段、不进飞书。</div>' not in shell and shell.count('不进飞书') == 3),
    ('v4-shell.js  新文案「另存于飞书独立列」已就位',
     '本值另存于飞书独立列' in shell),
    # 功能说明里的「v4.11.36 起：…」是历史沿革条目，必须保留 ⇒ 允许残留 1 处
    ('index.html   残留 v4.11.36 仅 1 处（历史沿革，保留）',
     html.count('4.11.36') == 1 and 'v4.11.36 起：被判 0 分的场次' in html),
    ('index.html   v4.11.37 出现 9 次（3 徽标 + 5 戳 + 1 说明）',
     html.count('4.11.37') == 9),
    ('index.html   规则库戳未被误改（仍 3.1.1）',
     'violation-rules.js?v=3.1.1' in html),
    ('index.html   v3 引擎戳未被误改（仍 4.10.3）',
     'standard.js?v=4.10.3' in html),
]
for label, ok in checks:
    print('  %s  %s' % ('[PASS]' if ok else '[FAIL]', label))
    if not ok:
        errors.append(label)
print('  index.html 中 4.11.37 实际出现次数 = %d' % html.count('4.11.37'))

print()
if errors:
    print('!! 失败 %d 项：' % len(errors))
    for e in errors:
        print('   - ' + e)
    sys.exit(1)
print('== 全部通过 ==')
