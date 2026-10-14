# -*- coding: utf-8 -*-
"""
_apply_v41138.py —— v4.11.38 落地脚本

本轮唯一语义变更：
  「不计违规项综合评分」的**存量记录**不再退化成「反推上限值」——
  因为发现 `det.extra.bl.errs`（extraV 4.11.22 起就有）= 信息准确性红旗处数，
  补上 min(12, 处数×4) 之后，反推值 == app-core.js:574-581 的原公式值（精确）。
  实测 45 条独立样本逐条闭合（38 非判 0 + 7 带 rawTotal），见 _probe_raw_exact.py。

安全设计：
  * 幂等：已应用过的替换 skip（不报错）
  * 每处替换断言「恰好命中 N 次」，命中数不符则整体不写、退出 1
  * 全部替换在内存里做完，最后回读断言，再落盘
  * 落盘前自动备份到 _bak/v41138/
"""
import hashlib
import os
import shutil
import sys
import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
BAKDIR = os.path.join(ROOT, '_bak', 'v41138')

SHELL = os.path.join(ROOT, 'v4', 'v4-shell.js')
HTML = os.path.join(ROOT, 'v4', 'index.html')
API = os.path.join(ROOT, 'api', 'feishu-fill.js')

# ---------------------------------------------------------------- 替换表
# (文件, 说明, 期望命中次数, old, new)
REPL = []

REPL.append((SHELL, '版本号 → v4.11.38', 1,
             "var V4_VERSION = 'v4.11.37';",
             "var V4_VERSION = 'v4.11.38';"))

REPL.append((SHELL, '头部注释：取数两条路 → 三条路', 1,
             """// 取数两条路（精确优先，绝不拿反推值冒充精确值）：
//   ① 精确：`r.__redline.rawTotal`（v4.11.34 起在 redlineApply 入口捕获）→ 存档 det.rawTotal
//      配套 det.rawPen / det.rawBlk（v4.11.35 起）＝ 那一笔信息准确性红旗，用于账目式拆解
//   ② 反推：Σ det.mods[weight>0].weighted（用于 v4.11.34 之前的**存量记录**，无 rawTotal 可取）
//      ⚠️ 反推值 = 原总分 + 信息准确性扣分（每处 −4、封顶 −12）⇒ 是**上限**，必须带「反推上限值」标记。""",
             """// 取数三条路（v4.11.38 起；精确优先，绝不拿反推值冒充精确值）：
//   ① 原始留存：`r.__redline.rawTotal`（v4.11.34 起在 redlineApply 入口捕获）→ 存档 det.rawTotal
//      配套 det.rawPen / det.rawBlk（v4.11.35 起）＝ 那一笔信息准确性红旗，用于账目式拆解
//   ② 精确复算（v4.11.38 新增）：Σ mods[weight>0].weighted − min(12, 处数×4)，处数取 v4RawBlk()
//      ⚠️ 关键：处数在 `det.extra.bl.errs` 里**自 extraV 4.11.22 起就一直在**（109/109 条实测都有）
//         ⇒ v4.11.34 之前的老记录也能把原分**精确**算回来，不必退化成「上限值」。
//         实测 45 条独立样本逐条闭合（38 条非判 0 的飞书「综合评分」＋ 7 条带 rawTotal 的判 0 场次），
//         复现脚本 = 仓库根 `_probe_raw_exact.py`（只读本地备份，输出 `_probe_raw_exact.out.txt`）。
//   ③ 反推上限（最后兜底）：Σ mods[weight>0].weighted —— 连处数都取不到时才用；
//      ⚠️ 它 = 原总分 + 那笔 0～12 分 ⇒ 是**上限**，必须带「反推上限值」标记。"""))

REPL.append((SHELL, '文件头注释：补 v4.11.38 一行', 1,
             """//   v4.11.37 起：本值会以「78.5（精确）／55.5（上限值）」的形式**另存**于飞书独立列
//     「未记录 违规-综合评分」（见文件末尾 v4.11.37 块）；「综合评分」列仍为 0，判定不变。""",
             """//   v4.11.37 起：本值会以「78.5（精确）／55.5（上限值）」的形式**另存**于飞书独立列
//     「未记录 违规-综合评分」（见文件末尾 v4.11.37 块）；「综合评分」列仍为 0，判定不变。
//   v4.11.38 起：老记录也能精确复算（见下 ② 路）⇒ 「（上限值）」标记实际几乎不再出现，
//     仅在「既无原分留存、又取不到红旗处数」时兜底。"""))

REPL.append((SHELL, 'v4RawScore：新增处数取值 + 精确复算', 1,
             """// 入参可以是运行时结果 r，也可以是存档记录 det
function v4RawScore(x){
  try{
    if(!x) return null;
    var t = null, exact = false;
    if(x.__redline && typeof x.__redline.rawTotal === 'number'){ t = x.__redline.rawTotal; exact = true; }
    else if(typeof x.rawTotal === 'number'){ t = x.rawTotal; exact = true; }
    if(t == null){
      var mods = x.mods || x.modules || [], sum = 0, has = false;
      for(var i=0;i<mods.length;i++){
        var m = mods[i]; if(!m) continue;
        // ⚠️ 必须是 number 才累加：写成 `!= null` 的话，脏数据里 weighted='x' 会走字符串拼接
        //    （0 + 'x' = '0x'）⇒ Math.round('0x'*10) = NaN ⇒ 界面显示成空，比不显示更糟。
        if((m.weight || 0) > 0 && typeof m.weighted === 'number'){ sum += m.weighted; has = true; }
      }
      if(!has) return null;          // 无计权模块 ⇒ 无从反推，宁可不显示
      t = sum;
    }
    var tot = Math.round(t * 10) / 10;
    if(tot < 0) tot = 0;
    return { total: tot, exact: exact, grade: v4RawGrade(tot) };
  }catch(e){ return null; }
}""",
             """// ---- v4.11.38：「信息准确性红旗处数」取值 —— 把「反推上限」修正成「精确复算」的关键 ----
//   三处来源**同源**（app-core.js:497 `bl.errors` → :665 `r.baseline.errors` → 存档 det.rawBlk /
//   det.extra.bl.errs），按可信度排序取第一个拿到的：
//     ① det.rawBlk        —— v4.11.35 起与 rawTotal 同批沉淀（最权威）
//     ② r.baseline.errors —— 运行时结果对象上就有（当场报告走这条）
//     ③ det.extra.bl.errs —— extraV 4.11.22 起就有，**老存档也能拿到**（本回升级的主角）
//   ⚠️ 三者在同一场评分里是同一次计算的产物，已用 45 条独立样本逐条闭合验证（见 _probe_raw_exact.py）。
function v4RawBlk(x){
  try{
    if(!x) return null;
    if(typeof x.rawBlk === 'number') return x.rawBlk;
    if(x.baseline && typeof x.baseline.errors === 'number') return x.baseline.errors;
    var ex = x.extra;
    if(ex && ex.bl && typeof ex.bl.errs === 'number') return ex.bl.errs;
    return null;                     // 取不到 ⇒ 调用方退回「上限值」口径，绝不猜一个数
  }catch(e){ return null; }
}
// 那笔扣分：每处 −4、封顶 −12（与 app-core.js:579 同式，一字不差）
function v4RawPen(blk){ return (typeof blk === 'number') ? Math.min(12, blk * 4) : null; }
// 入参可以是运行时结果 r，也可以是存档记录 det
// 返回：{total, exact, grade, via, blk, pen}
//   via = 'stored'  原分直接留存（rawTotal）
//       | 'rebuilt' 用「模块加权 − 红旗扣分」精确复算（v4.11.38）
//       | 'derived' 只有模块加权 ⇒ 上限值
function v4RawScore(x){
  try{
    if(!x) return null;
    var t = null, exact = false, via = null;
    var blk = v4RawBlk(x), pen = v4RawPen(blk);
    if(x.__redline && typeof x.__redline.rawTotal === 'number'){ t = x.__redline.rawTotal; exact = true; via = 'stored'; }
    else if(typeof x.rawTotal === 'number'){ t = x.rawTotal; exact = true; via = 'stored'; }
    if(t == null){
      var mods = x.mods || x.modules || [], sum = 0, has = false;
      for(var i=0;i<mods.length;i++){
        var m = mods[i]; if(!m) continue;
        // ⚠️ 必须是 number 才累加：写成 `!= null` 的话，脏数据里 weighted='x' 会走字符串拼接
        //    （0 + 'x' = '0x'）⇒ Math.round('0x'*10) = NaN ⇒ 界面显示成空，比不显示更糟。
        if((m.weight || 0) > 0 && typeof m.weighted === 'number'){ sum += m.weighted; has = true; }
      }
      if(!has) return null;          // 无计权模块 ⇒ 无从反推，宁可不显示
      if(pen !== null){ t = sum - pen; exact = true; via = 'rebuilt'; }   // v4.11.38：精确复算
      else            { t = sum;                      via = 'derived'; }   // 兜底：上限值
    }
    var tot = Math.round(t * 10) / 10;
    if(tot < 0) tot = 0;             // 与 app-core `if(total < 0) total = 0` 同口径
    return { total: tot, exact: exact, grade: v4RawGrade(tot), via: via, blk: blk, pen: pen };
  }catch(e){ return null; }
}"""))

REPL.append((SHELL, 'v4RawResultHTML：pen/blk 兜底 + rebuilt 取值说明', 1,
             """    var pen = (typeof src.rawPen === 'number') ? src.rawPen : null;
    var blk = (typeof src.rawBlk === 'number') ? src.rawBlk : null;
    var accLine = '';
    if(q.exact && pen !== null){
      accLine = '<div>账目：模块加权合计 <b>' + sumRaw + '</b>'
        + ' − 信息准确性红旗 <b>' + pen + '</b>'
        + (blk !== null ? '（<b>' + blk + '</b> 处 × −4，封顶 12）' : '')
        + ' = <b>' + q.total + '</b>'
        + ((sumRaw - pen < 0) ? '（已触底截为 0）' : '') + '</div>';
    }else if(q.exact){
      accLine = '<div>取值：<b>精确值</b>（本场评分时留存，未拆出信息准确性红旗明细）</div>';
    }else{
      accLine = '<div>取值：<b>上限值</b>（本记录未留存原分，按存档模块加权反推 —— 未扣信息准确性红旗 0～12 分，'
        + '所以真实值只会更低，不会更高）</div>';
    }""",
             """    // v4.11.38：q 里已带回 blk/pen（含从 det.extra.bl.errs 复算的那条路）⇒ 作为 src 字段的兜底
    var pen = (typeof src.rawPen === 'number') ? src.rawPen : ((q && typeof q.pen === 'number') ? q.pen : null);
    var blk = (typeof src.rawBlk === 'number') ? src.rawBlk : ((q && typeof q.blk === 'number') ? q.blk : null);
    var accLine = '';
    if(q.exact && pen !== null){
      accLine = '<div>账目：模块加权合计 <b>' + sumRaw + '</b>'
        + ' − 信息准确性红旗 <b>' + pen + '</b>'
        + (blk !== null ? '（<b>' + blk + '</b> 处 × −4，封顶 12）' : '')
        + ' = <b>' + q.total + '</b>'
        + ((sumRaw - pen < 0) ? '（已触底截为 0）' : '') + '</div>'
        + (q.via === 'rebuilt'
            ? '<div>取值：<b>精确值</b>（原分未单独留存，按存档「模块加权合计 − 信息准确性红旗」'
              + '精确复算 —— 与 app-core 原公式同式）</div>'
            : '');
    }else if(q.exact){
      accLine = '<div>取值：<b>精确值</b>（本场评分时留存，未拆出信息准确性红旗明细）</div>';
    }else{
      accLine = '<div>取值：<b>上限值</b>（本记录既无原分留存、也取不到信息准确性红旗处数，'
        + '只能按存档模块加权反推 —— 未扣那笔 0～12 分，所以真实值只会更低，不会更高）</div>';
    }"""))

REPL.append((SHELL, 'v4.11.37 块：LOG 前缀改用 V4_VERSION', 1,
             "  var LOG = function(m){ try{ console.log('[v4.11.37] ' + m); }catch(e){} };",
             "  var LOG = function(m){ try{ console.log('[' + V4_VERSION + '] ' + m); }catch(e){} };"))

REPL.append((SHELL, 'v4.11.37 块：延迟补包日志同步', 1,
             "    try{ console.log('[v4.11.37] 延迟补包完成：累计接管 ' + n + '/4 个写入口'); }catch(e){}",
             "    try{ console.log('[' + V4_VERSION + '] 延迟补包完成：累计接管 ' + n + '/4 个写入口'); }catch(e){}"))

REPL.append((SHELL, 'V4RAW / V4RAWCOL.version 改为动态读 V4_VERSION', 2,
             """    __installed: true,
    version: '4.11.37',""",
             """    __installed: true,
    version: V4_VERSION,"""))

REPL.append((SHELL, 'v4.11.37 块头注释补 v4.11.38 说明', 1,
             """// 值与标记（老大选：带口径标记，便于日后分辨真假）：
//   判 0 + 精确路径 → `78.5（精确）`；判 0 + 反推路径 → `55.5（上限值）`""",
             """// 值与标记（老大选：带口径标记，便于日后分辨真假）：
//   判 0 + 精确路径 → `78.5（精确）`；判 0 + 反推路径 → `55.5（上限值）`
//   ⚠️ v4.11.38 起：反推路径已升级为「精确复算」（见 v4RawBlk），
//      ⇒ `（上限值）` 只在「既无 rawTotal、又取不到红旗处数」时才会出现。"""))

# ---- index.html ----
REPL.append((HTML, 'index.html：3 处徽标 → v4.11.38', 3,
             '>v4.11.37<', '>v4.11.38<'))

REPL.append((HTML, 'index.html：5 处 ?v= → 4.11.38', 5,
             '?v=4.11.37', '?v=4.11.38'))

REPL.append((HTML, 'index.html：功能说明追加 v4.11.38 一条', 1,
             '） ｜ 原系统 v0.10 / v3 均不受影响</div>',
             ' · v4.11.38 起：存量记录的「不计违规项综合评分」也升级为**精确值**'
             '（原先只按模块加权反推、未扣信息准确性红旗 ⇒ 只能标「上限值」；'
             '现改为「模块加权合计 − min(12, 红旗处数×4)」精确复算，与 app-core 原公式同式，'
             '实测 45 条独立样本逐条闭合）） ｜ 原系统 v0.10 / v3 均不受影响</div>'))

# ---- api/feishu-fill.js ----
REPL.append((API, 'api/feishu-fill.js：注释同步（上限值 → 精确）', 1,
             """    //   `55.5（上限值）`；非判 0 场次不挂该键）。""",
             """    //   `55.5（上限值）`；非判 0 场次不挂该键）。v4.11.38 起上限值已基本不再出现
    //   （存量记录也能精确复算），但格式与判定不变，此处无需改代码。"""))


def md5lf(b):
    return hashlib.md5(b.replace(b'\r\n', b'\n')).hexdigest()


def main():
    dry = '--apply' not in sys.argv
    print('模式：%s' % ('演练（不落盘）' if dry else '落地（--apply）'))
    print()

    texts = {}
    for path in {SHELL, HTML, API}:
        with open(path, 'r', encoding='utf-8', newline='') as f:
            texts[path] = f.read()

    fails = []
    applied = 0
    for path, desc, want, old, new in REPL:
        s = texts[path]
        got = s.count(old)
        if got == 0 and s.count(new) > 0:
            print('  SKIP  %-46s （已应用）' % desc)
            continue
        if got != want:
            fails.append('%-46s 期望命中 %d 次，实际 %d 次' % (desc, want, got))
            print('  FAIL  %-46s 命中 %d 次（期望 %d）' % (desc, got, want))
            continue
        texts[path] = s.replace(old, new, want)
        applied += 1
        print('  OK    %-46s ×%d' % (desc, got))

    print()
    if fails:
        print('❌ 有 %d 处替换未通过校验，**整体不落盘**：' % len(fails))
        for f in fails:
            print('   -', f)
        return 1

    # ---- 回读断言 ----
    shell = texts[SHELL]
    html = texts[HTML]
    api = texts[API]
    checks = [
        ("V4_VERSION == 'v4.11.38'", "var V4_VERSION = 'v4.11.38';" in shell),
        ("V4RAW_FMT 未被误改（仍 4.11.35）", "var V4RAW_FMT = '4.11.35';" in shell),
        ("v4RawBlk 已定义", "function v4RawBlk(x){" in shell),
        ("v4RawPen 已定义", "function v4RawPen(blk){" in shell),
        ("v4RawScore 有 rebuilt 分支", "via = 'rebuilt'" in shell),
        ("v4RawScore 有 derived 兜底分支", "via = 'derived'" in shell),
        ("v4RawScore 返回 via/blk/pen", "via: via, blk: blk, pen: pen" in shell),
        ("extra.bl.errs 取值路径在（老存档关键）", "ex.bl.errs" in shell),
        ("账目行含 rebuilt 取值说明", "与 app-core 原公式同式" in shell),
        ("V4RAWCOL.version 动态", "version: V4_VERSION," in shell),
        ("无残留 '[v4.11.37]' 日志前缀字面量", "[v4.11.37]" not in shell),
        ("index.html 徽标 ×3 = 4.11.38", html.count('>v4.11.38<') == 3),
        ("index.html ?v= ×5 = 4.11.38", html.count('?v=4.11.38') == 5),
        ("index.html 规则库戳未动（仍 3.1.1）", html.count('?v=3.1.1') == 1),
        ("index.html v3 引擎戳未动（仍 4.10.3）", html.count('?v=4.10.3') == 2),
        ("index.html 无残留 4.11.37 的 ?v=", '?v=4.11.37' not in html),
        ("index.html 历史沿革 'v4.11.37 起' 保留", 'v4.11.37 起：被判 0 分场次' in html),
        ("api 列名逐字未变", "'未记录 违规-综合评分'" in api),
        ("api 字段名 rawScoreText 未变", "r.rawScoreText" in api),
    ]
    print('=== 回读断言 ===')
    bad = 0
    for name, ok in checks:
        print('  %s %s' % ('✅' if ok else '❌', name))
        if not ok:
            bad += 1
    if bad:
        print()
        print('❌ %d 条回读断言失败，**整体不落盘**' % bad)
        return 1

    if dry:
        print()
        print('演练通过（%d 处替换）。加 --apply 才落盘。' % applied)
        return 0

    # ---- 备份 + 落盘 ----
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    d = os.path.join(BAKDIR, stamp)
    os.makedirs(d, exist_ok=True)
    for path in {SHELL, HTML, API}:
        shutil.copy2(path, os.path.join(d, os.path.basename(path) + '.before'))
    print()
    print('备份 → %s' % d)

    for path in {SHELL, HTML, API}:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(texts[path])

    print()
    print('=== 落盘后指纹 ===')
    for path in [SHELL, HTML, API]:
        b = open(path, 'rb').read()
        print('  %-22s %8d B  md5(LF)=%s' % (os.path.relpath(path, ROOT), len(b), md5lf(b)))
    print()
    print('✅ 共 %d 处替换已落地。' % applied)
    return 0


if __name__ == '__main__':
    sys.exit(main())
