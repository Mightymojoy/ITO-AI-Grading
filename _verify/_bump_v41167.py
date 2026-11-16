# -*- coding: utf-8 -*-
"""v4.11.67 版本号与缓存戳升级（app-core/semantic-core 内容已变，必须破缓存）。"""
import hashlib
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REPO = 'C:/Users/QwQ/WorkBuddy/2026-08-28-11-01-39/ITO-AI-Grading'
NEW = '4.11.67'
OLD = '4.11.66'

# ---------- 1. v4-shell.js：V4_VERSION ----------
p = REPO + '/v4/v4-shell.js'
s = open(p, encoding='utf-8', newline='').read()
a = "var V4_VERSION = 'v4.%s';" % OLD
b = "var V4_VERSION = 'v4.%s';" % NEW
print('shell V4_VERSION 锚点出现:', s.count(a))
s = s.replace(a, b)
open(p, 'w', encoding='utf-8', newline='').write(s)

# ---------- 2. semantic-core.js：块版本 _v ----------
p = REPO + '/v4/semantic-core.js'
s = open(p, encoding='utf-8', newline='').read()
old_line = "    _v: '4.10.5'   // 4.10.5（2026-11-03）：n1/n2 豁免扩充（耐用性描述·销量变体·定价政策）+ 安抚口语跨分类复用；扣分公式与 -4/处 口径未变"
new_line = ("    _v: '4.11.67'   // 4.11.67（2026-11-16）：recompute 归一基数 /100 → W_SUM（修与 runGrading 的失配，实测偏差均值 6.34）；"
            "\n                    //   硬参数错误改由 c1 整块归零承担，取消 -4/处 扣分（阀 v4hardparam_c1zero）")
print('semantic _v 锚点出现:', s.count(old_line))
s = s.replace(old_line, new_line)
open(p, 'w', encoding='utf-8', newline='').write(s)

# ---------- 3. app-core.js：顶部口径备注 ----------
p = REPO + '/v4/app-core.js'
s = open(p, encoding='utf-8', newline='').read()
mark = "// v4.11：保留评分公式，入口由 workflow.js 统一调度。"
note = ("// v4.11.67（2026-11-16 老大拍板）：硬性参数讲错 ⇒ 产品理解能力 c1 整块归零（权重 25/90 全扣），\n"
        "//   同时取消原「每处 -4、封顶 -12」的全局红旗扣分。回退阀 localStorage.v4hardparam_c1zero='0'。\n"
        "// v4.11：保留评分公式，入口由 workflow.js 统一调度。")
if note not in s:
    print('app-core 顶部备注插入:', s.count(mark), '处锚点')
    s = s.replace(mark, note, 1)
    open(p, 'w', encoding='utf-8', newline='').write(s)
else:
    print('app-core 顶部备注已存在，跳过')

# ---------- 4. index.html：四处徽标 + 两个 script 缓存戳 ----------
p = REPO + '/v4/index.html'
h = open(p, encoding='utf-8', newline='').read()
reps = [
    ('<span id="brandVer">v%s</span>' % OLD, '<span id="brandVer">v%s</span>' % NEW),
    ('id="pageBadge" data-page-node-id="9z31D7FDy8F5dHke5ZyDqg">v%s</span>' % OLD,
     'id="pageBadge" data-page-node-id="9z31D7FDy8F5dHke5ZyDqg">v%s</span>' % NEW),
    ('<span id="footVer">v%s</span>' % OLD, '<span id="footVer">v%s</span>' % NEW),
    ('<script src="v4-shell.js?v=%s"></script>' % OLD, '<script src="v4-shell.js?v=%s"></script>' % NEW),
    # ⚠️ 关键：app-core / semantic-core 内容已改，缓存戳不动＝用户继续用旧缓存
    ('<script src="app-core.js?v=4.11.50"></script>', '<script src="app-core.js?v=%s"></script>' % NEW),
    ('<script src="semantic-core.js?v=4.10.5"></script>', '<script src="semantic-core.js?v=%s"></script>' % NEW),
]
for x, y in reps:
    c = h.count(x)
    print('  替换 x%d : %s' % (c, x[:64]))
    h = h.replace(x, y)
open(p, 'w', encoding='utf-8', newline='').write(h)

# ---------- 复核 ----------
print('\n===== 复核 =====')
for f in ['v4/v4-shell.js', 'v4/index.html', 'v4/app-core.js', 'v4/semantic-core.js']:
    d = open(REPO + '/' + f, 'rb').read()
    print('%-24s %7d  %s' % (f, len(d), hashlib.md5(d).hexdigest()))

hh = open(REPO + '/v4/index.html', encoding='utf-8').read()
for k in ['brandVer', 'pageBadge', 'footVer']:
    m = re.search(r'id="' + k + r'"[^>]*>v?([\d.]+)<', hh)
    print('  %-10s = %s' % (k, m.group(1) if m else 'N/A'))
print('  v4-shell.js?v=', re.search(r'v4-shell\.js\?v=([\d.]+)', hh).group(1))
print('  app-core.js?v=', re.search(r'app-core\.js\?v=([\d.]+)', hh).group(1))
print('  semantic-core.js?v=', re.search(r'semantic-core\.js\?v=([\d.]+)', hh).group(1))
print('  旧 %s 残留（应只在更新日志）: %d' % (OLD, hh.count(OLD)))
