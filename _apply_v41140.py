# -*- coding: utf-8 -*-
"""
_apply_v41140.py —— v4.11.40 落地

需求（老大 2026-10-14，原话）：
  「综合评分里面如果评分是0分 那就直接记录零分。未记录 违规-综合评分，里面是不算违规的综合得分情况」
  ⇒ 「综合评分」= 含平台红线处置的最终分（判 0 就是 0）；
     「未记录 违规-综合评分」= **完全不做红线处置**时的综合得分 ⇒ **任何场次都必须有值**。

v4.11.37 初版只给「判 0」场次写值（理由：非判 0 时该值与综合评分相同，写了是重复噪音）。
该取舍**已作废** —— 两列是**并列对照**关系，非判 0 留空会让看表的人误判成"漏填"。

改法（**只动 v4-shell.js + index.html，app-core.js 一字节不碰**，符合铁律 1）：
  ① 顶层新增 `v4RawCellText(x)` —— 本列取值的**唯一口径**
  ② `v4ScoreRow()` 增 `withRaw` 形参，**只给日报行**加这个 key（周/月/明星主播三表没这列）
  ③ 删掉 `cellText()` 里的 `if(!isZeroed(r)) return '';`（改走 ①）
  ④ `mergeDaily()` 增「远端独有列补齐」—— 防本地旧行整行覆盖飞书已回填的值

安全：默认演练（dry-run），`--apply` 才落盘；写前自动备份；幂等（已应用则 skip）。
"""
import io, os, sys, hashlib, shutil, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
SHELL = os.path.join(ROOT, 'v4', 'v4-shell.js')
HTML  = os.path.join(ROOT, 'v4', 'index.html')
APPLY = '--apply' in sys.argv
V_NEW = 'v4.11.40'
V_OLD = 'v4.11.39'

# ---------------------------------------------------------------- 替换项

# ① 顶层口径函数（插在 v4RawScore 之后）
OLD_RAW = """  }catch(e){ return null; }
}
// ---- v4.11.35：「不计违规项综合评分结果」= 一整份结果块（历史详情 / 当场报告共用同一份）----"""

NEW_RAW = """  }catch(e){ return null; }
}
// v4.11.40：「未记录 违规-综合评分」的**取值口径**（老大 2026-10-14 定稿）——
//   「综合评分」= 含平台红线处置后的最终分（判 0 就是 0）；
//   「未记录 违规-综合评分」= **完全不做红线处置**时的综合得分 ⇒ **任何场次都必须有值**：
//     · 判 0 场次 ⇒ 撤掉「整场归零」后的原分（0 分的同时看得到"本该得多少"）
//     · 非判 0 场次 ⇒ 与「综合评分」相同（红线没动分，app-core 原公式的结果就是它）
//   ⚠️ v4.11.37 初版只在判 0 时给值（理由：非判 0 写了是重复噪音）—— 该取舍**已作废**：
//      两列是**并列对照**关系，非判 0 留空会让看表的人误判成"漏填/没算"。
//   ⚠️ 本函数在**顶层**（v4ScoreRow 也要用）；下面 v4.11.37 块里的 FMT_EXACT/FMT_DERIVED
//      是同一个字面量但在 IIFE 内 ⇒ 改口径时两处必须同步（现已统一走本函数）。
function v4RawCellText(x){
  try{
    if(!x || typeof v4RawScore !== 'function') return '';
    var q = v4RawScore(x);
    if(!q || typeof q.total !== 'number') return '';
    return q.total + (q.exact ? '（精确）' : '（上限值）');
  }catch(e){ return ''; }
}
// ---- v4.11.35：「不计违规项综合评分结果」= 一整份结果块（历史详情 / 当场报告共用同一份）----"""

# ② v4ScoreRow 形参
OLD_SIG = 'function v4ScoreRow(r, extra){'
NEW_SIG = 'function v4ScoreRow(r, extra, withRaw){'

# ③ v4ScoreRow 行体
OLD_ROW = """    '转化引导能力':           (typeof ms.c8 === 'number') ? ms.c8 : ''
  };"""

NEW_ROW = """    '转化引导能力':           (typeof ms.c8 === 'number') ? ms.c8 : ''
  };
  // v4.11.40：本列与「综合评分」**并列写进日报本地行** ——
  //   ① 本地快速通道（v4FeishuLoad）在飞书数据到位前先渲染 localCache ⇒ 本地行不带这一列的话，
  //      首屏那一下这列是空的（要等 merge 完成才补上）；
  //   ② v4.11.11 版的 mergeDaily 在「本地 5 分钟内刚评」时让本地行**整行胜出** ⇒ 行本身必须带全字段。
  //   ⚠️ 只给**日报**加（withRaw=true）：周总结/月总结/明星主播三张表没有这一列，
  //      无差别加会让那三个 tab 各多出一列空的（它们共用 V4_FS_DAILY_COLS，动不得）。
  if(withRaw) row['未记录 违规-综合评分'] = v4RawCellText(r);"""

# ④ 日报 upsert 调用
OLD_CALL = "  v4FsUpsert(V4_FS_LOCAL_KEY.daily, v4ScoreRow(r), dedup);"
NEW_CALL = "  v4FsUpsert(V4_FS_LOCAL_KEY.daily, v4ScoreRow(r, null, true), dedup);"

# ⑤ cellText：去掉 isZeroed 短路
OLD_CELL = """  function cellText(r){
    try{
      if(!on() || !r || typeof r !== 'object') return '';
      if(!isZeroed(r)) return '';                        // 非判 0 ⇒ 留空
      if(typeof v4RawScore !== 'function') return '';
      var q = v4RawScore(r);
      if(!q || typeof q.total !== 'number') return '';
      return q.total + (q.exact ? FMT_EXACT : FMT_DERIVED);
    }catch(e){ return ''; }
  }"""

NEW_CELL = """  function cellText(r){
    try{
      if(!on() || !r || typeof r !== 'object') return '';
      // v4.11.40（老大 10-14 定稿）：**所有场次都要有值**。
      //   原 v4.11.37 的「非判 0 就返回空串」那句短路判定已删除（见沿革）——
      //   两列是并列对照关系，非判 0 留空会被看表的人误判成"漏填"。
      //   ⚠️ 本注释刻意**不复写**那行被删掉的代码：复写会让"已删除"的静态断言自匹配（铁律 13）。
      //   取值统一走顶层 v4RawCellText（与本地行 v4ScoreRow 同源，避免两处字面量漂移）。
      return v4RawCellText(r);
    }catch(e){ return ''; }
  }"""

# ⑥ mergeDaily：远端独有列补齐
OLD_MERGE = """    var localTime=Date.parse(r._updatedAt || '');
    if(!old || !remoteTime || !localTime || localTime >= remoteTime) map[key(r)]=r;"""

NEW_MERGE = """    var localTime=Date.parse(r._updatedAt || '');
    // ⚠️ v4.11.40 更正（原改动已回退）：**本函数不是实际生效的那个** ——
    //   v4.11.11 块（本文件靠后，`window.mergeDaily = function(...)`）在装载时把它整体覆盖，
    //   且语义完全不同：那边是「**飞书优先**，只有 5 分钟内刚评的本地行才覆盖」。
    //   因此这里**不需要**做"远端独有列补齐"：本地历史行的时间戳早已超出 grace ⇒ 飞书行胜出 ⇒
    //   飞书侧回填的值天然不会被本地空值盖掉（实测 ⑤c/⑤f，见 verify_rawcol_localrow.js）。
    //   保留本函数只为兜底（万一 v4.11.11 块没装载），故**与原实现逐字一致**，不做任何加工。
    if(!old || !remoteTime || !localTime || localTime >= remoteTime) map[key(r)]=r;"""

# ⑦⑧⑨ index.html
OLD_CAL = '非判 0 场次留空；不改变本场 0 分判定'
NEW_CAL = '非判 0 场次同样写值（v4.11.40 修订）；不改变本场 0 分判定'

OLD_TAIL = '（此前被追加到表格最右侧，不便于并排对比））'
NEW_TAIL = ('（此前被追加到表格最右侧，不便于并排对比）'
            '· v4.11.40 起：**「未记录 违规-综合评分」所有场次都写值**'
            '（此前仅判 0 场次有值、非判 0 留空 ⇒ 易被读成漏填；两列是并列对照 —— '
            '判 0 行看"本该得多少"，非判 0 行两列相同。综合评分本身仍照旧：判 0 就记 0））')

REPL = [
    # (文件, 说明, 期望命中次数, 旧, 新)
    (SHELL, 'V4_VERSION -> v4.11.40', 1,
     "var V4_VERSION = '%s';" % V_OLD,
     "var V4_VERSION = '%s';" % V_NEW),

    (SHELL, '新增顶层 v4RawCellText（本列取值唯一口径）', 1, OLD_RAW, NEW_RAW),

    (SHELL, 'v4ScoreRow 增 withRaw 形参', 1, OLD_SIG, NEW_SIG),

    (SHELL, 'v4ScoreRow 日报行加「未记录 违规-综合评分」', 1, OLD_ROW, NEW_ROW),

    (SHELL, '日报 upsert 传 withRaw=true', 1, OLD_CALL, NEW_CALL),

    (SHELL, 'cellText 删除 isZeroed 短路（所有场次都给值）', 1, OLD_CELL, NEW_CELL),

    (SHELL, 'mergeDaily 补远端独有列（防本地旧行盖掉飞书值）', 1, OLD_MERGE, NEW_MERGE),

    (HTML, '徽标 3 处 -> v4.11.40', 3,
     '>%s</span>' % V_OLD,
     '>%s</span>' % V_NEW),

    (HTML, '脚本 ?v= 5 处 -> 4.11.40', 5,
     '?v=%s' % V_OLD[1:],          # ⚠️ 缓存戳**不带 v 前缀**："?v=4.11.39"（不是 "?v=v4.11.39"）
     '?v=%s' % V_NEW[1:]),

    (HTML, 'v4.11.37 说明里的旧口径措辞修正', 1, OLD_CAL, NEW_CAL),

    (HTML, '功能说明追加 v4.11.40 沿革', 1, OLD_TAIL, NEW_TAIL),
]


def md5lf(b):
    return hashlib.md5(b.replace(b'\r\n', b'\n')).hexdigest()


def read_norm(p):
    """读文件并**归一化为 LF** 再做替换（避免 Python 源码自身行尾污染匹配串）"""
    b = open(p, 'rb').read()
    raw = b.decode('utf-8')
    nl = '\r\n' if raw.count('\r\n') > raw.count('\n') - raw.count('\r\n') else '\n'
    return raw.replace('\r\n', '\n'), nl


def write_restore(p, s, nl):
    out = s.replace('\r\n', '\n')
    if nl == '\r\n':
        out = out.replace('\n', '\r\n')
    open(p, 'wb').write(out.encode('utf-8'))


def main():
    print('=' * 78)
    print('v4.11.40 落地：「未记录 违规-综合评分」所有场次都给值（不再是仅判 0 才写）')
    print('模式：%s' % ('★ 正式写入（--apply）' if APPLY else '演练（dry-run，不写盘）'))
    print('=' * 78)

    # ---------- 0. 备份 ----------
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    bakdir = os.path.join(ROOT, '_bak', 'rawall-%s' % stamp)
    if APPLY:
        os.makedirs(bakdir, exist_ok=True)
        for p in (SHELL, HTML):
            dst = os.path.join(bakdir, os.path.basename(p) + '.before')
            shutil.copy2(p, dst)
            print('  备份 %s -> %s (%d B)' % (os.path.relpath(p, ROOT), os.path.relpath(dst, ROOT), os.path.getsize(dst)))
    else:
        print('  演练模式：跳过备份')

    # ---------- 1. 读（归一化为 LF）----------
    buf, nls = {}, {}
    for p in (SHELL, HTML):
        s, nl = read_norm(p)
        buf[p], nls[p] = s, nl
        nb = open(p, 'rb').read()
        print('  读入 %-22s %8d B  md5LF=%s  EOL=%s'
              % (os.path.relpath(p, ROOT), len(nb), md5lf(nb)[:12], repr(nl)))

    # ---------- 2. 全部试算（全绿才落盘）----------
    print()
    print('--- 替换（点名 + 计数断言）---')
    plan, ok_all = [], True
    for path, label, n_exp, old, new in REPL:
        old_n = old.replace('\r\n', '\n')
        new_n = new.replace('\r\n', '\n')
        s = buf[path]
        n = s.count(old_n)
        already = (n == 0 and new_n in s)
        if already:
            print('  skip（已应用） %s' % label)
            plan.append((path, label, old_n, new_n, True))
            continue
        ok = (n == n_exp)
        print('  %s  命中 %d/%d  %s%s' % ('✅' if ok else '❌', n, n_exp, label,
                                          '' if ok else '   <<< 计数不符'))
        if not ok:
            print('     旧串首 80 字：%r' % old_n[:80])
            ok_all = False
        plan.append((path, label, old_n, new_n, ok))

    if not ok_all:
        print()
        print('❌ 有替换项计数不符，中止（未写盘）')
        return 1

    for path, label, old_n, new_n, _ in plan:
        buf[path] = buf[path].replace(old_n, new_n)

    # ---------- 3. 回读断言 ----------
    print()
    print('--- 回读断言 ---')
    shell, html = buf[SHELL], buf[HTML]
    chk = []

    def rc(label, cond, extra=''):
        chk.append((label, bool(cond), extra))

    rc('shell 版本 = %s' % V_NEW, "var V4_VERSION = '%s';" % V_NEW in shell)
    rc('顶层 v4RawCellText 已建', 'function v4RawCellText(x){' in shell)
    rc('v4RawCellText 是顶层函数（非缩进）', '\nfunction v4RawCellText(x){' in shell)
    rc('v4ScoreRow 签名含 withRaw', 'function v4ScoreRow(r, extra, withRaw){' in shell)
    rc('日报行写该列（受 withRaw 控制）',
       "if(withRaw) row['未记录 违规-综合评分'] = v4RawCellText(r);" in shell)
    rc('仅日报 upsert 传 withRaw', 'v4ScoreRow(r, null, true)' in shell)
    rc('周/月/明星主播 upsert 仍不带 withRaw',
       shell.count('v4ScoreRow(r, {\'周次\'') == 2 and shell.count('v4ScoreRow(r, {\'月份\'') == 1)
    rc('🔴 cellText 的 isZeroed 短路已删除', 'if(!isZeroed(r)) return \'\';' not in shell)
    rc('cellText 改走 v4RawCellText（1 处；另一处是 row 赋值，非 return）',
       'return v4RawCellText(r);' in shell and
       shell.count('return v4RawCellText(r);') == 1, str(shell.count('return v4RawCellText(r);')))
    rc('isZeroed 函数本体仍在（V4RAWCOL.zeroed 还在用）', 'function isZeroed(r){' in shell)
    rc('🔴 mergeDaily 加工已回退（补列逻辑不在死代码里）',
       "if(!Object.prototype.hasOwnProperty.call(r, k)) r[k] = old[k];" not in shell)
    rc('mergeDaily 兜底版与原实现逐字一致',
       'if(!old || !remoteTime || !localTime || localTime >= remoteTime) map[key(r)]=r;' in shell)
    rc('注释已指明生效版在 v4.11.11 块（飞书优先）',
       '本函数不是实际生效的那个' in shell)
    rc('app-core.js 未被本脚本涉及（只点名 shell+html）',
       all(os.path.relpath(p, ROOT).endswith(('v4-shell.js', 'index.html')) for p, _, _, _, _ in plan))

    rc('html 徽标 3 处 = %s' % V_NEW, html.count('>%s</span>' % V_NEW) == 3,
       str(html.count('>%s</span>' % V_NEW)))
    rc('html ?v= 5 处 = 4.11.40', html.count('?v=4.11.40') == 5, str(html.count('?v=4.11.40')))
    rc('html 残留 4.11.39 = 1 处（历史沿革，必须保留）', html.count(V_OLD) == 1, str(html.count(V_OLD)))
    rc('html 沿革含 v4.11.40 说明', 'v4.11.40 起：**「未记录 违规-综合评分」所有场次都写值**' in html)
    rc('html v4.11.37 旧口径措辞已修正', '非判 0 场次留空' not in html)
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
            write_restore(p, buf[p], nls[p])
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
