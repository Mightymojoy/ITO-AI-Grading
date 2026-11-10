# -*- coding: utf-8 -*-
"""往 v4/index.html 更新日志追加 v4.11.65 条目（追加到 footVer 那个 div 末尾，不动历史条目）。"""
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

P = 'v4/index.html'
ANCHOR = '不再拿 2026-10-20 的静态文件充数。</div>'
ENTRY = (
    '<br><b>v4.11.65（2026-11-10）修「历史评分页看不到飞书全员记录」——'
    '两处跨闭包引用失效 + 路由缺分支</b>：v4.11.62 把历史页改成「摘要先回、报告后台补」两批取数，'
    '但第二批写在了另一个闭包里，直接写裸 <code>fetchCloud(...)</code>、裸 <code>V4CLOUD.limit</code> '
    '⇒ 每次执行必抛 <code>ReferenceError</code>，被上层的 <code>.catch</code> 吞掉后 <code>return null</code>，'
    '上层据此判定「飞书暂无全员记录，仅显示本机存档」⇒ 摘要明明已经取到 563 条，页面仍然是空的'
    '（实测：手动触发后控制台先后打出「云端历史评分摘要 563 条」与「云端拉取失败：fetchCloud is not defined」）。'
    '同时 <code>v4Navigate</code> 只处理 dashboard / settings / feishu / trend / problem，'
    '<b>没有 history / golden / cases</b>，而启动脚本里的 <code>v4ArchRender(\'history\')</code> 又早于'
    '「云端包装器」安装（包装器在本文件靠后才执行）⇒ 启动那次渲染不带云端拉取、之后切到历史页也不再渲染 '
    '⇒ 页面永远停在初始文案「暂无存档记录——完成一次评分后自动归档」，且<b>全程零网络请求</b>。'
    '处置：① 云端取数入口暴露为 <code>window.v4CloudFetch</code>，第二批改走它，并对入口缺失做显式降级'
    '（不再静默吞异常）；② <code>v4Navigate</code> 补 history / golden / cases 三页重渲染'
    '（云端拉取仍由 8 秒防抖 + 60 秒 TTL 管住，不会打爆飞书限流）；'
    '③ <code>V4CLOUD.limit</code> 改走 <code>window.V4CLOUD</code>。'
    '⚠️ 口径说明：v4.11.62 注释里写「云端合并从未成功过」是对的 —— 那条是「前端 20 秒超时」造成的旧因；'
    '本次这两条是 v4.11.62 改造时新引进的，两者叠加才会出现「修了还是空」。</div>'
)

s = open(P, encoding='utf-8', newline='').read()
if 'v4.11.65（2026-11-10）' in s:
    print('已存在 v4.11.65 条目，跳过')
    sys.exit(0)
n = s.count(ANCHOR)
if n != 1:
    print('锚点次数异常:', n)
    sys.exit(1)
s = s.replace(ANCHOR, ENTRY, 1)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('追加完成；v4.11.65 出现次数 =', s.count('4.11.65'), ' 文件大小 =', len(s.encode('utf-8')))
