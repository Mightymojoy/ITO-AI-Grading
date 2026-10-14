# -*- coding: utf-8 -*-
"""
_apply_v41139.py —— v4.11.39 落地

需求（老大 2026-10-14）：
  工作台「飞书数据表 · 主播日报」里，「未记录 违规-综合评分」列现在被追加到表格**最右侧**
  （因为 v4FsCols 的设计是「固定列在前 + 数据中多出的列追加到末尾」），
  要求把它固定放在「综合评分」列**之后**，两列并排对比。

改法：只改 v4-shell.js 的 v4FsCols（**不动 app-core.js**，符合铁律 1）
  新增 V4_FS_AFTER 映射表：`{ '未记录 违规-综合评分': '综合评分' }`
  额外列若命中映射 ⇒ splice 到锚点后一位；否则照旧 push 到末尾。

安全：默认演练（dry-run），`--apply` 才落盘；写前自动备份；幂等（已应用则 skip）。
"""
import io, os, sys, hashlib, shutil, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
SHELL = os.path.join(ROOT, 'v4', 'v4-shell.js')
HTML  = os.path.join(ROOT, 'v4', 'index.html')
APPLY = '--apply' in sys.argv
V_NEW = 'v4.11.39'
V_OLD = 'v4.11.38'

# ---------------------------------------------------------------- 替换项

OLD_COLS = """// 飞书「主播日报」标准列序（与截图/多维表格完全对齐）
// 固定列在前，数据中多出的列追加在后（避免本地与飞书两侧列序漂移）
function v4FsCols(rows, fixed){
  if(!rows || !rows.length) return fixed.slice();
  var extra = {};
  rows.forEach(function(r){ Object.keys(r).forEach(function(k){ if(k.charAt(0)!=='_' && fixed.indexOf(k) < 0) extra[k] = 1; }); });
  return fixed.concat(Object.keys(extra));
}"""

NEW_COLS = """// 飞书「主播日报」标准列序（与截图/多维表格完全对齐）
// 固定列在前，数据中多出的列追加在后（避免本地与飞书两侧列序漂移）
// v4.11.39：个别额外列有**指定落位** —— 紧跟某个固定列之后，而不是被追加到最右侧。
//   老大 2026-10-14 指定：「未记录 违规-综合评分」紧跟「综合评分」（两列要能并排对比）。
//   ⚠️ 「综合评分」**不是首列**（前面还有日期/主播/直播间）⇒ 必须用 indexOf 求锚点下标，禁写死列号。
//   ⚠️ 若将来有多列锚定同一锚点，后插入的会排到前面 ⇒ 需改倒序/分组插入（当前只有一条映射）。
var V4_FS_AFTER = { '未记录 违规-综合评分': '综合评分' };
function v4FsCols(rows, fixed){
  if(!rows || !rows.length) return fixed.slice();
  var extra = {};
  rows.forEach(function(r){ Object.keys(r).forEach(function(k){ if(k.charAt(0)!=='_' && fixed.indexOf(k) < 0) extra[k] = 1; }); });
  var out = fixed.slice();
  Object.keys(extra).forEach(function(k){
    var anchor = V4_FS_AFTER[k];
    var at = anchor ? out.indexOf(anchor) : -1;
    if(at >= 0) out.splice(at + 1, 0, k);   // 指定落位：锚点后一位
    else out.push(k);                       // 其余额外列仍追加到末尾
  });
  return out;
}"""

OLD_TAIL = '实测 45 条独立样本逐条闭合））'
NEW_TAIL = ('实测 45 条独立样本逐条闭合 · v4.11.39 起：「未记录 违规-综合评分」列固定紧跟'
            '「综合评分」列之后展示（此前被追加到表格最右侧，不便于并排对比））')

REPL = [
    # (文件, 说明, 期望命中次数, 旧, 新)
    (SHELL, 'V4_VERSION -> v4.11.39', 1,
     "var V4_VERSION = '%s';" % V_OLD,
     "var V4_VERSION = '%s';" % V_NEW),

    (SHELL, 'v4FsCols: 额外列支持指定落位（新列紧跟综合评分）', 1,
     OLD_COLS, NEW_COLS),

    (HTML, '徽标 3 处 -> v4.11.39', 3,
     '>%s</span>' % V_OLD,
     '>%s</span>' % V_NEW),

    (HTML, '脚本 ?v= 5 处 -> 4.11.39', 5,
     '?v=%s' % V_OLD[1:],          # ⚠️ 缓存戳**不带 v 前缀**："?v=4.11.38"（不是 "?v=v4.11.38"）
     '?v=%s' % V_NEW[1:]),

    (HTML, '功能说明追加 v4.11.39 沿革', 1,
     OLD_TAIL, NEW_TAIL),
]


def md5lf(b):
    return hashlib.md5(b.replace(b'\r\n', b'\n')).hexdigest()


def read(p):
    return io.open(p, encoding='utf-8', newline='').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


def main():
    print('=' * 78)
    print('v4.11.39 落地：工作台「未记录 违规-综合评分」列固定紧跟「综合评分」之后')
    print('模式：%s' % ('★ 正式写入（--apply）' if APPLY else '演练（dry-run，不写盘）'))
    print('=' * 78)

    # ---------- 0. 备份 ----------
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    bakdir = os.path.join(ROOT, '_bak', 'colorder-%s' % stamp)
    if APPLY:
        os.makedirs(bakdir, exist_ok=True)
        for p in (SHELL, HTML):
            dst = os.path.join(bakdir, os.path.basename(p) + '.before')
            shutil.copy2(p, dst)
            print('  备份 %s -> %s (%d B)' % (os.path.relpath(p, ROOT), os.path.relpath(dst, ROOT), os.path.getsize(dst)))
    else:
        print('  演练模式：跳过备份')

    # ---------- 1. 读 ----------
    buf = {}
    for p in (SHELL, HTML):
        s = read(p)
        buf[p] = s
        print('  读入 %-22s %8d B  md5LF=%s' % (os.path.relpath(p, ROOT), len(s.encode('utf-8')), md5lf(s.encode('utf-8'))[:12]))

    # ---------- 2. 替换（先全部试算，全绿才落盘） ----------
    print()
    print('--- 替换（点名 + 计数断言）---')
    plan = []
    for path, label, n_exp, old, new in REPL:
        s = buf[path]
        n = s.count(old)
        already = (n == 0 and new in s)
        if already:
            print('  skip（已应用） %s' % label)
            plan.append(None)
            continue
        ok = (n == n_exp)
        print('  %s  命中 %d/%d  %s%s' % ('✅' if ok else '❌', n, n_exp, label,
                                          '' if ok else '   <<< 计数不符'))
        if not ok:
            print('     旧串首 80 字：%r' % old[:80])
        plan.append((path, label, old, new) if ok else None)

    # plan 里的 None = 未命中替换；需分辨「已应用 skip」与「计数不符」
    ok_all = True
    for item, (path, label, n_exp, old, new) in zip(plan, REPL):
        if item is None:
            # 判定是「已应用」还是「计数不符」
            s = buf[path]
            if not (s.count(old) == 0 and new in s):
                ok_all = False
    if not ok_all:
        print()
        print('❌ 有替换项计数不符，中止（未写盘）')
        return 1

    # 应用
    for item in plan:
        if item is None:
            continue
        path, label, old, new = item
        buf[path] = buf[path].replace(old, new)

    # ---------- 3. 回读断言 ----------
    print()
    print('--- 回读断言 ---')
    shell = buf[SHELL]
    html = buf[HTML]
    chk = []

    def rc(label, cond, extra=''):
        chk.append((label, bool(cond), extra))

    rc('shell 版本 = %s' % V_NEW, "var V4_VERSION = '%s';" % V_NEW in shell)
    rc('V4_FS_AFTER 映射已建', "var V4_FS_AFTER = { '未记录 违规-综合评分': '综合评分' };" in shell)
    rc('插入逻辑走 splice(at + 1, 0, k)', 'out.splice(at + 1, 0, k);' in shell)
    rc('未命中映射仍 push 到末尾', 'else out.push(k);' in shell)
    rc('旧「fixed.concat」写法已消失', 'return fixed.concat(Object.keys(extra));' not in shell)
    rc('固定列定义未被改动（13 列）',
       "var V4_FS_DAILY_COLS = ['日期','主播','直播间','综合评分','产品知识能力'" in shell)
    rc('html 徽标 3 处 = %s' % V_NEW, html.count('>%s</span>' % V_NEW) == 3,
       str(html.count('>%s</span>' % V_NEW)))
    rc('html ?v= 5 处 = 4.11.39', html.count('?v=4.11.39') == 5, str(html.count('?v=4.11.39')))
    # 旧版本号残留：只允许功能说明里的历史沿革 1 处
    rc('html 残留 4.11.38 = 1 处（历史沿革，必须保留）', html.count(V_OLD) == 1, str(html.count(V_OLD)))
    rc('html 沿革含 v4.11.39 说明', 'v4.11.39 起：「未记录 违规-综合评分」列固定紧跟' in html)
    rc('规则库戳未动 ?v=3.1.1', 'violation-rules.js?v=3.1.1' in html)
    rc('v3 引擎戳未动 ?v=4.10.3', 'standard.js?v=4.10.3' in html)

    fails = 0
    for label, ok, extra in chk:
        print('  %s %s%s' % ('✅' if ok else '❌', label, ('   [' + extra + ']') if extra else ''))
        if not ok:
            fails += 1

    if fails:
        print()
        print('❌ %d 条回读断言未通过，中止（未写盘）' % fails)
        return 1

    # ---------- 4. 落盘 ----------
    if APPLY:
        print()
        print('--- 落盘 ---')
        for p in (SHELL, HTML):
            write(p, buf[p])
            nb = open(p, 'rb').read()
            print('  写入 %-22s %8d B  md5LF=%s' % (os.path.relpath(p, ROOT), len(nb), md5lf(nb)))
    else:
        print()
        print('演练完成（未写盘）。确认无误后加 --apply 落地。')

    print()
    print('=' * 78)
    print('结果：%s' % ('✅ 已落地' if APPLY else '✅ 演练全绿'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
