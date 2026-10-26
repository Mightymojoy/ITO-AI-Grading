/* ============================================================
 * v4/violation-rules.js —— 直播平台红线规则库（v3.1.1）
 *
 * 来源：**《抖音直播客观违规规则V3版.xlsx》**（2026-09-30 老大提供）——逐字提取，未发明任何词条。
 *    · Sheet1「ITO箱包直播违规表达」      9 类  → 编号 S1-01 .. S1-09
 *    · Sheet2「平台通用违规高风险词库」 170 条 → 编号 S2-001 .. S2-170
 *
 * 来源追加：**《抖音直播客观违规规则V5.xlsx》**（2026-10-09 老大提供）—— 已**逐行逐字比对**：
 *    · V5 Sheet1 = 10 行（R1 是**表头**：A「直播高风险违规」/ B「违规话术表达（提到就触发客观0分违规）」
 *      / C「**系统特殊违规项调整**」；R2–R10 = 与 V3 版完全相同的 9 类）
 *    · V5 Sheet2 = 171 行（R1 表头 + 170 条词条）—— 列结构 A 一级分类 / B 高风险表达 /
 *      **C 风险等级（高·中高）** / D 判定逻辑 / E 不建议话术 / F 建议替代 / G 适用说明 / H 主要依据；
 *      分类共 **11 类**（绝对化极限宣传 32·权威背书资质 13·功效性能宣传 19·价格优惠宣传 25·
 *      促销玩法互动诱导 3·服务售后承诺 15·来源资质专利 20·比较竞品宣传 3·数据排名口碑 12·
 *      材质检测等级 16·商品基础信息 12）
 *    ⇒ **V5 的词表与 V3 版完全一致**，V5 的**唯一变化 = Sheet1 C 列新增了 R5 / R6 / R10 三行内容**
 *      （C1 批注：「高=建议默认禁用；中高=必须有证据并限制上下文；实际判定仍以平台最新规则和具体语境为准」）
 *    🔴 **口径边界（易错点）**：老大的「C 列」口径指的是 **Sheet1 的 C「系统特殊违规项调整」**。
 *      **Sheet2 的 C 列是「风险等级」，属词库自身属性、不是处置指令，不得拿它当"放宽"依据。**
 *
 * 业务侧 2026-09-30 三点拍板（本版全部据此执行）：
 *   ① 「没写的可以一律删除」  ⇒ V3 表为**完整清单**。表内找不到的上一版词条**一律不再判定**，
 *      逐条登记在 `REMOVED_IN_V3`（**未静默删除**，共 54 条），便于业务侧复核与随时恢复。
 *   ② 「这个是判罚标准」      ⇒ **全表取消分级**。Sheet1 原来的「一级0容忍/二级擦边」与 Sheet2 原来的
 *      「高/中高」全部作废：**命中任意一条 ⇒ 本场总分归 0**（SESSION_ZERO）。
 *      ⇒ Sheet2 由「47 条整场0 + 123 条模块0」变为 **170 条全部整场0**；`mod` 一律 null，
 *        `MODULE_ZERO` 在本版**不再产生**（`moduleZero` 恒 false 属预期，不是 bug）。
 *   ③ 「给于编号，让评判的结果有依可寻」⇒ 每条规则带稳定编号 `id`（S1-xx / S2-xxx），
 *      判罚明细 `reasons[].id` 一路带到报告横幅；同时登记 `tblRow`（源表行号）便于回表核对。
 *      例：横幅显示「[S1-04] 极限词表达 触发词「行业第一」」。
 *
 * 与上一版（v2.1.0）的**唯一差异**就是上面这三条；GUARD / EXEMPT 两个安全阀**逐字未动**。
 *   · GUARD/EXEMPT 是**判定精度**约束（如"行业第一"必须 4 字连写、"完全"不含口语搭配），
 *     不是"分级"，也不改变处置等级 ⇒ 本次保留，与「取消分级」不冲突。
 *   · Sheet1 第 4 类（极限词）表内自述「只有同时出现四个字或以上字数才能触发违规」⇒ 本类不含 2~3 字裸词。
 *
 * ⚠️ 已知边界（如实登记，不粉饰）：
 *   · Sheet1 第 6/7/8/9 类（政治敏感／拉踩／侮辱用户／虚假承诺）表内**没有可枚举字面词**
 *     ⇒ `semantic:true`，交语义通道；字面扫描器对其返回 semanticOnly。
 *     🔴 09-24 为拉踩加的「6 个竞品名 + 14 条他方没有锚点」已按「表外一律删除」移除 ⇒ **拉踩字面召回回到 0**。
 *   · 「评论 / 关注 / 点赞」按表内裸列字面判定（老大 09-24 口径A），中文多义误伤如实登记、未擅自豁免。
 *   · `#/vision`「一键完整日报」通道内部裸调 runGrading、不走 redlineApply ⇒ 该通道不判红线（既有结构性盲区）。
 *
 * 回退：localStorage `redline_enabled='0'` 关闭整条红线；`redline_strict='1'` 忽略 GUARD（纯字面）。
 * ------------------------------------------------------------
 * v3.1.0（2026-10-09 业务侧拍板）—— **V5 表「C 列系统特殊违规项调整」落地**，只放宽、不删词。
 *
 * 老大原话：「C 列没有的，违规的保持不变；C 列有的，其中包含了就可以按 C 列来评判」+
 *            「C 列中如有出现了，放宽不判 0，但在细分报告中需要标注出来，了解主播的话术情况」
 *
 *   ⇒ 两条不可违反的口径：
 *      ① **C 列为空的行 → 原样冻结**（R2 保价 / R3 物流 / R4 售后 / R7 政治 / R8 拉踩 / R9 侮辱用户）
 *         ⚠️ 这**推翻**了 09-30「表外一律删除」的推断 —— `截单发`/`明天到` **保留**，本版一个词都没删。
 *      ② **C 列有内容 → 被描述涵盖的放宽**，从 SESSION_ZERO 改为 `ANNOTATE`（标注不判 0）。
 *
 * 新增第三处置档 `ANNOTATE`（= 记进报告的「标注区」，但**不置 sessionZero / moduleZero**、不动分数）：
 *   · S1-04「极限词表达」全部 32 条            ← R5 C「违规极限词均需标注出来，但不作为判处0分的规则」
 *   · Sheet2「绝对化/极限宣传」全部 32 条        ← 同上（分类名即"极限宣传"，属"极限词"涵盖范围）
 *   · Sheet2「材质/检测/等级」等级类 8 条        ← R10 C「飞机舷窗同款材质…不做违规以及0分判定」
 *     （食品级／医用级／航空级／航天级／军工级／军用级／母婴级／婴儿级）
 *   · Sheet2 `官方正品` + 新增 S1-10 的 4 个词   ← R10 C 逐字点名
 *   ⚠️ **表内重叠已一并消解**：R5 B 列逐字点名的 9 个词（100%防水／完全防水／完全静音／0噪音／
 *      永久抗菌／100%抗菌／全网最低价／全网最低／全年最低）在 Sheet2 里被归到「功效/性能宣传」与
 *      「价格/优惠宣传」两个分类 —— 按 C 列「违规极限词**均**需标注…」与 B 列逐字列举，
 *      **同办为 ANNOTATE**，避免同一表达出现两种处置。实测对 49 份语料归零率 **零影响**（无命中）。
 *   ⚠️ 环保无害类（零甲醛／无毒无害／绝对环保／零污染／抗菌99.9%／抑菌99.9%）**不豁**，
 *      仍判 0 —— R10 C 列的 4 个词都是"拿特殊场景材质背书"，与环保类不同源。
 *   ⚠️ `100%PC`／`百分百PC`：v3.1.0 时两者行为**不一致**（`100%PC` 能进标注区、`百分百PC` 被
 *      EXEMPT 整词豁免连标注都不记）⇒ **v3.1.1 已拉齐，见下方 v3.1.1 段**。
 *
 * GUARD 新增 2 条（`关注` / `评论`，仍属 SESSION_ZERO，只是加"诱导语境必配"）← R6 C 列：
 *   · `关注`：须引导点关注账号/涨粉/加粉丝团才算违规；日常语境（"重视"义）不算。
 *   · `评论`：C 列 6 个示例里 3 个讲"评论"日常语境 ⇒ 同办；真阳性由裸词条 `扣评论` 与
 *     Sheet2「评论区扣1才发福利」兜底。
 *   ⚠️ `打在公屏上` / `飘公屏` / `扣评论` / `点赞` / `赠送` / `点关注` **一律仍判 0** ——
 *      R6 C 列只讲"关注"（+示例里的"评论"），未涵盖这些，不得超范围放宽。
 *
 * 影响面（49 份真实逐字稿 / 373,509 字，`structuredClone` + identity 自检）：
 *   整场归 0 率 **37/49 (75.5%) → 19/49 (38.8%)**；**0 新增归零**，18 场退出**逐场可归因**；
 *   产生标注 29 份（其中 17 份"只有标注、不归零"）。详见 `.workbuddy/memory/2026-10-09.md` 与桌面报告。
 *
 * ------------------------------------------------------------
 * v3.1.1（2026-10-09）—— **V5 表 Sheet1 R5 C 列「重点注意事项」落地**（唯一改动在 EXEMPT）。
 *
 * V5 表 R5 C 列原文（该单元格第二段，逐字）：
 *   「重点注意事项：涉及100%PC，百分百PC的描述，**可标注出来，但不判定违规，不判0分**」
 *
 * ⚠️ 落地前实测发现**同一句 C 列点名的两个词，行为不一致**：
 *   · `100%PC`   → EXEMPT 的 `100%` 只拦 `100%全新|100%新料|100%纯新` ⇒ `100%PC` **不被豁免**
 *                  ⇒ 命中 S2-024「100%」（ANNOTATE）⇒ 进标注区 ✅ **已符合 C 列**
 *   · `百分百PC` → EXEMPT 的 `百分百` 分支含 `PC|pc` ⇒ **整词豁免、连标注都不记** ❌ **与 C 列不符**
 *
 * 本版**去掉 `百分百` 豁免正则里的 `PC|pc` 分支**（`PC|pc` → 删）：
 *   · `百分百PC`／`百分百pc` ⇒ 不再豁免 ⇒ 命中 S2-032「百分百」（ANNOTATE）⇒ **进标注区、仍不判 0** ✅
 *   · `百分百全新的PC材料`／`百分百新料`／`百分百纯新`／`百分百进口` ⇒ **仍被豁免**（材质事实陈述，不动）
 *   · 其余三条 EXEMPT（`最好` / `100%` / `全PC`）**逐字未动**；GUARD 12 条**逐字未动**；
 *     S1 / S2 词表与 `action` **一字未改**（本版没有任何条目换档）
 *
 * 影响面：49 份语料实测 `100%PC` **0 处**、`百分百PC` **0 处**（`%` 共 22 处全是 80%/90%/30% 类；
 *   `PC` 共 128 处全是"德国拜尔PC"）⇒ **本轮零命中、零影响**；但另一批语料（v1.0.3 实测
 *   「百分百全新的PC材料／百分百PC箱」24 处）会因此从"完全不记"变为"进标注区（不判 0）"。
 *
 * 回退：localStorage `redline_enabled='0'` 关闭整条红线；`redline_strict='1'` 忽略 GUARD（纯字面）。
 * ------------------------------------------------------------
 * v3.1.2（2026-10-26）—— **飞书人工复核误判样本反哺**（业务侧拍板「A+B 同时修」）
 *
 * 起因（老大原话）：「之前判断违规话术造成误判的情况，现在在飞书表新增了对于判断的复核」
 *                  → 「这些就是规则就是现在系统可能会造成误判，所以需要人工复核，待后续系统需要
 *                     熟悉这些误判的规则，避免下次再误判，所以才有这个设定」→ 拍板 A+B 同时修。
 *
 * 数据源：飞书「主播日报」新增三列 —— `初审违规`(type3 单选 fldalu0qyN) / `复核违规`(type3 单选 fldyzKdUOz)
 *         / `误判内容`(type1 文本 fldNXVyxNm)。**三列此前系统零引用**（grep 全仓库无命中）。
 *   误判口径：**初审违规=否 且 AI 侧有痕迹**（按0计 / 已撤销 / 已标注）
 *   实测：AI 有痕迹 198 场 → 已人工初审 116 场 → 判「否」**43 场 / 69 条命中** ⇒ **误判率 37.1%**
 *   处置分布：仍按 0 计 16 场 ｜ 仅标注 24 场 ｜ 已正式撤销 3 场
 *
 *   🔴 「复核违规」与「初审违规」**逐行 100% 同值**（264/264，零分歧）⇒ 复核列目前未推翻任何初审结论，
 *      故本版以「初审违规=否」为准取样本。此事实已上报，待业务侧确认复核列性质。
 *   🔴 「误判内容」列名有坑：初审=**是**的 56 行也填满了内容（那是正常命中的原文）⇒
 *      **按列名直接统计会把真违规算成误判**，必须与「初审违规=否」联表取。
 *
 * 误判根因（69 条，6 类）：A 口语信心词当绝对化 18｜B 词面不看搭配 14｜C 客观陈述/官方背书 17｜
 *                        D 母婴级有检测配套 10｜E 疑问句/分词错误 2｜F 主观感叹/行业地位 4
 *
 * 本版改动（**只收窄判定面，不删任何词条、不换档、不动 S1/S2 词表**）：
 *   ① 本文件 EXEMPT 由 4 条扩到 **17 条**（新增 15 条、自查撤回 2 条，净 +13，覆盖根因 B/C/D/E 共 35 条命中）
 *   ② `semantic-core.js` n1「绝对化用语」—— 删掉 prompt 里的"一定"并新增代码侧安全阀（覆盖根因 A）
 *   ③ `semantic-core.js` n2「最高级用语」安全阀补「卖**的**最好」等（原只有「卖得最好」）
 *   详见各条 `why`（都带真实引文 + 日期主播，可回飞书原表核对）。
 *
 * ⚠️ 刻意**不**放宽（人工判否但本版保留，已列报告待裁定）：
 *    · 10-17 程都兰「完全**不会爆开**」、10-19 王金鸽/10-17 赵亚男「**找不到第二只**」、
 *      10-19 杨光来/10-12 杨光来「ITO 属于**领头羊**的位置」—— 均属明确的绝对化/排他断言
 *    · 10-13 全程「很多顾客都在**点赞**这两个颜色」—— 与老大 09-24「提到就判」口径A 直接冲突，
 *      属**口径变更**、不是误判，须业务侧另行拍板（本版未擅改）
 *
 * 回退：localStorage `redline_enabled='0'` 关闭整条红线；`redline_strict='1'` 忽略 GUARD（纯字面）。
 * ============================================================ */
(function(root){
  'use strict';
  var _v = '3.1.2';
  var _src = '抖音直播客观违规规则V3版.xlsx（词表）＋V5.xlsx（Sheet1 C 列口径，2026-10-09 拍板）';

  var S1 = [
    // S1-01  ｜ 源表 R2「保价承诺话术」
    //   B 列逐字。表内 C 列另有裸词「统一/打折/降价」——过于宽泛（“统一”是常用词），未采纳为字面词条，如实登记
    { id: 'S1-01', tblRow: 2, cat: '保价承诺话术', action: 'SESSION_ZERO', mod: null, point: null,
      terms: [
        '保价', '全年保价', '全年不打折', '不降价', '价格统一', '全渠道统一', '统一价格', '保证价格', '价格保证',
      ] },

    // S1-02  ｜ 源表 R3「物流时效违规承诺」
    //   B 列逐字 + C 列「截单发/明天到」。B 列「明天发，次日达，两天到」逐字保留
    { id: 'S1-02', tblRow: 3, cat: '物流时效违规承诺', action: 'SESSION_ZERO', mod: null, point: null,
      terms: [
        '18点前截单发', '江浙沪周边明天到', '今天加急发', '今天发', '下午发', '明天发', '截单发', '次日达', '明天到', '两天到',
      ] },

    // S1-03  ｜ 源表 R4「售后保障违规承诺」
    //   📌 本类**不再含裸词「质保」**（V3 表内没有）—— 这是本次归零率回落的主因之一，已单独登记
    { id: 'S1-03', tblRow: 4, cat: '售后保障违规承诺', action: 'SESSION_ZERO', mod: null, point: null,
      terms: [
        '360天内出现任何情况都可以免费换新', '任何情况都能退', '拆了用了也能退', '运费险可以包运费', '全额免运费', '运费不要钱',
      ] },

    // S1-04  ｜ 源表 R5「极限词表达」
    //   B 列逐字。表内自述「只有同时出现四个字或以上字数才能触发违规」⇒ 本类**不含** 2~3 字裸词（完美/绝对/彻底/完全/永久/终身/唯一…）；表外的这些裸词若在 Sheet2 中逐字列出，则仍由 Sheet2 判定
    { id: 'S1-04', tblRow: 5, cat: '极限词表达', action: 'ANNOTATE', mod: null, point: null,
      terms: [
        '行业第一', '中国第一', '全球第一', '绝对静音', '完全静音', '0噪音', '全网最低', '全网最低价', '史上最低', '全年最低', '100%抗菌', '永久抗菌',
        '完全抗菌', '100%杀菌', '永久杀菌', '完全杀菌', '100%抑菌', '永久抑菌', '完全抑菌', '100%防水', '完全防水', '一定能登机', '无限容量',
        '同尺寸容量最大', '一辈子不用换', '一辈子不用坏', '终身免费', '永久免费', '获奖无数', '全球设计大奖', 'RIMOWA平替', '永久下架',
      ] },

    // S1-05  ｜ 源表 R6「诱导互动表达」
    //   B 列逐字 + 老大 09-24 明确点名的裸「关注」。「赠送」按表原文「做XXX就赠XXX（有条件加赠违规）」保留，配“诱导语境必配”约束
    { id: 'S1-05', tblRow: 6, cat: '诱导互动表达', action: 'SESSION_ZERO', mod: null, point: null,
      terms: [
        '打在公屏上', '关注点一点', '小赞点一点', '飘公屏', '扣评论', '点关注', '关注', '评论', '点赞', '赠送',
      ] },

    // S1-06  ｜ 源表 R7「政治敏感表达」
    //   B 列无可枚举字面词（判的是话题性质）⇒ 交语义通道
    { id: 'S1-06', tblRow: 7, cat: '政治敏感表达', action: 'SESSION_ZERO', mod: null, point: null, semantic: true, terms: [] },

    // S1-07  ｜ 源表 R8「拉踩表达」
    //   B 列无可枚举字面词 ⇒ 交语义通道。⚠️ 09-24 曾加的 6 个竞品名 + 14 条「他方没有」锚点，V3 表内**没有** ⇒ 按「表外一律删除」移除，登记在 REMOVED_IN_V3
    { id: 'S1-07', tblRow: 8, cat: '拉踩表达', action: 'SESSION_ZERO', mod: null, point: null, semantic: true, terms: [] },

    // S1-08  ｜ 源表 R9「侮辱直播用户表达」
    //   B 列无可枚举字面词（判的是行为性质）⇒ 交语义通道
    { id: 'S1-08', tblRow: 9, cat: '侮辱直播用户表达', action: 'SESSION_ZERO', mod: null, point: null, semantic: true, terms: [] },

    // S1-09  ｜ 源表 R10「虚假承诺」
    //   B 列无可枚举字面词（判的是"真假"，不是"用词"）⇒ 交语义通道
    { id: 'S1-09', tblRow: 10, cat: '虚假承诺', action: 'SESSION_ZERO', mod: null, point: null, semantic: true, terms: [] },

    // S1-10  ｜ 源表 R10 的 **C 列标注项**（业务侧 2026-10-09 拍板 · V5 表）
    //   C 列原文：「"官方正品"、"防弹玻璃"、"警用盾牌"、"飞机舷窗同款材质"均需标[注]，
    //              但不做违规以及 0 分判定」
    //   ⇒ 本类**不判 0**，命中只进报告的「标注区」⇒ action: 'ANNOTATE'
    //   ⚠️ 与 S1-09 是**同一张表行（R10）的两个面**：S1-09 判"虚假承诺"（语义通道，判 0）；
    //      本类只做"看见了就记一笔"（字面通道，不判 0）。两者互不干扰。
    //   ⚠️ `官方正品` 不在此列 —— 它在 Sheet2 里已有一条（S2-119），已就地改档，避免同词双记。
    { id: 'S1-10', tblRow: 10, cat: '虚假承诺（C列标注项）', action: 'ANNOTATE', mod: null, point: null,
      terms: [
        '防弹玻璃', '警用盾牌', '飞机舷窗', '飞机悬窗',
      ] },

  ];

  // ---- Sheet2：平台通用违规高风险词库 170 条 ----
  //   业务侧 2026-09-30 拍板「Sheet2 中的也取消分级」⇒ **170 条全部 SESSION_ZERO**
  //   （旧版：47 条整场0 + 123 条模块0；现行：0/170 条模块0，mod 一律置 null）
  //   `level` 与 `tblRow` 仅作**登记信息**（表内原风险等级/行号），不参与判定。
  var S2 = [
    { id: 'S2-001', tblRow: 2, cat: '绝对化/极限宣传', level: '高', term: '国家级', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-002', tblRow: 3, cat: '绝对化/极限宣传', level: '高', term: '最高级', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-003', tblRow: 4, cat: '绝对化/极限宣传', level: '高', term: '最佳', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-004', tblRow: 5, cat: '绝对化/极限宣传', level: '高', term: '最好', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-005', tblRow: 6, cat: '绝对化/极限宣传', level: '高', term: '最强', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-006', tblRow: 7, cat: '绝对化/极限宣传', level: '高', term: '最优', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-007', tblRow: 8, cat: '绝对化/极限宣传', level: '高', term: '顶级', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-008', tblRow: 9, cat: '绝对化/极限宣传', level: '高', term: '极品', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-009', tblRow: 10, cat: '绝对化/极限宣传', level: '高', term: '第一', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-010', tblRow: 11, cat: '绝对化/极限宣传', level: '高', term: '唯一', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-011', tblRow: 12, cat: '绝对化/极限宣传', level: '高', term: '首选', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-012', tblRow: 13, cat: '绝对化/极限宣传', level: '高', term: '冠军', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-013', tblRow: 14, cat: '绝对化/极限宣传', level: '高', term: '天花板', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-014', tblRow: 15, cat: '绝对化/极限宣传', level: '高', term: '史上最', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-015', tblRow: 16, cat: '绝对化/极限宣传', level: '高', term: '全网第一', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-016', tblRow: 17, cat: '绝对化/极限宣传', level: '高', term: '全球第一', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-017', tblRow: 18, cat: '绝对化/极限宣传', level: '高', term: '世界第一', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-018', tblRow: 19, cat: '绝对化/极限宣传', level: '高', term: '行业第一', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-019', tblRow: 20, cat: '绝对化/极限宣传', level: '高', term: '全国第一', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-020', tblRow: 21, cat: '绝对化/极限宣传', level: '高', term: '宇宙第一', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-021', tblRow: 22, cat: '绝对化/极限宣传', level: '高', term: '无敌', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-022', tblRow: 23, cat: '绝对化/极限宣传', level: '高', term: '完美', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-023', tblRow: 24, cat: '绝对化/极限宣传', level: '高', term: '绝对', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-024', tblRow: 25, cat: '绝对化/极限宣传', level: '高', term: '100%', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-025', tblRow: 26, cat: '绝对化/极限宣传', level: '高', term: '零缺点', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-026', tblRow: 27, cat: '绝对化/极限宣传', level: '高', term: '零风险', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-027', tblRow: 28, cat: '绝对化/极限宣传', level: '高', term: '永不', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-028', tblRow: 29, cat: '绝对化/极限宣传', level: '高', term: '永久', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-029', tblRow: 30, cat: '绝对化/极限宣传', level: '高', term: '终身', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-030', tblRow: 31, cat: '绝对化/极限宣传', level: '高', term: '彻底', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-031', tblRow: 32, cat: '绝对化/极限宣传', level: '高', term: '完全', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-032', tblRow: 33, cat: '绝对化/极限宣传', level: '高', term: '百分百', action: 'ANNOTATE', mod: null, point: null },
    { id: 'S2-033', tblRow: 34, cat: '权威背书/资质', level: '高', term: '国家认证', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-034', tblRow: 35, cat: '权威背书/资质', level: '高', term: '国家推荐', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-035', tblRow: 36, cat: '权威背书/资质', level: '高', term: '政府推荐', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-036', tblRow: 37, cat: '权威背书/资质', level: '高', term: '官方指定', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-037', tblRow: 38, cat: '权威背书/资质', level: '高', term: '央视推荐', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-038', tblRow: 39, cat: '权威背书/资质', level: '高', term: '人民大会堂同款', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-039', tblRow: 40, cat: '权威背书/资质', level: '高', term: '军方指定', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-040', tblRow: 41, cat: '权威背书/资质', level: '高', term: '国家机关推荐', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-041', tblRow: 42, cat: '权威背书/资质', level: '高', term: '专家认证', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-042', tblRow: 43, cat: '权威背书/资质', level: '高', term: '权威认证', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-043', tblRow: 44, cat: '权威背书/资质', level: '高', term: '国际权威认证', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-044', tblRow: 45, cat: '权威背书/资质', level: '高', term: '国家免检', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-045', tblRow: 46, cat: '权威背书/资质', level: '高', term: '质量免检', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-046', tblRow: 47, cat: '功效/性能宣传', level: '高', term: '摔不坏', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-047', tblRow: 48, cat: '功效/性能宣传', level: '高', term: '压不坏', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-048', tblRow: 49, cat: '功效/性能宣传', level: '高', term: '刮不花', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-049', tblRow: 50, cat: '功效/性能宣传', level: '高', term: '永不变形', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-050', tblRow: 51, cat: '功效/性能宣传', level: '高', term: '永不褪色', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-051', tblRow: 52, cat: '功效/性能宣传', level: '高', term: '绝不漏水', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-052', tblRow: 53, cat: '功效/性能宣传', level: '高', term: '100%防水', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-053', tblRow: 54, cat: '功效/性能宣传', level: '高', term: '完全防水', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-054', tblRow: 55, cat: '功效/性能宣传', level: '高', term: '零噪音', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-055', tblRow: 56, cat: '功效/性能宣传', level: '高', term: '完全静音', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-056', tblRow: 57, cat: '功效/性能宣传', level: '高', term: '0噪音', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-057', tblRow: 58, cat: '功效/性能宣传', level: '高', term: '永久抗菌', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-058', tblRow: 59, cat: '功效/性能宣传', level: '高', term: '100%抗菌', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-059', tblRow: 60, cat: '功效/性能宣传', level: '高', term: '杀菌100%', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-060', tblRow: 61, cat: '功效/性能宣传', level: '高', term: '永久耐磨', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-061', tblRow: 62, cat: '功效/性能宣传', level: '高', term: '永不卡顿', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-062', tblRow: 63, cat: '功效/性能宣传', level: '高', term: '永不掉色', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-063', tblRow: 64, cat: '功效/性能宣传', level: '高', term: '绝对安全', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-064', tblRow: 65, cat: '功效/性能宣传', level: '高', term: '绝对不会坏', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-065', tblRow: 66, cat: '价格/优惠宣传', level: '高', term: '全网最低价', action: 'ANNOTATE', mod: null, point: '8.2' },
    { id: 'S2-066', tblRow: 67, cat: '价格/优惠宣传', level: '高', term: '史低价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-067', tblRow: 68, cat: '价格/优惠宣传', level: '高', term: '最低价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-068', tblRow: 69, cat: '价格/优惠宣传', level: '高', term: '全网最低', action: 'ANNOTATE', mod: null, point: '8.2' },
    { id: 'S2-069', tblRow: 70, cat: '价格/优惠宣传', level: '高', term: '全网最便宜', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-070', tblRow: 71, cat: '价格/优惠宣传', level: '高', term: '全年最低', action: 'ANNOTATE', mod: null, point: '8.2' },
    { id: 'S2-071', tblRow: 72, cat: '价格/优惠宣传', level: '高', term: '全年最便宜', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-072', tblRow: 73, cat: '价格/优惠宣传', level: '高', term: '最低到手价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-073', tblRow: 74, cat: '价格/优惠宣传', level: '高', term: '跳楼价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-074', tblRow: 75, cat: '价格/优惠宣传', level: '高', term: '白菜价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-075', tblRow: 76, cat: '价格/优惠宣传', level: '高', term: '骨折价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-076', tblRow: 77, cat: '价格/优惠宣传', level: '高', term: '厂家亏本卖', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-077', tblRow: 78, cat: '价格/优惠宣传', level: '高', term: '赔钱卖', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-078', tblRow: 79, cat: '价格/优惠宣传', level: '高', term: '成本价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-079', tblRow: 80, cat: '价格/优惠宣传', level: '高', term: '出厂价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-080', tblRow: 81, cat: '价格/优惠宣传', level: '高', term: '进货价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-081', tblRow: 82, cat: '价格/优惠宣传', level: '高', term: '原价XX现在XX', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-082', tblRow: 83, cat: '价格/优惠宣传', level: '高', term: '最后一天最低价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-083', tblRow: 84, cat: '价格/优惠宣传', level: '高', term: '以后绝不再有这个价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-084', tblRow: 85, cat: '价格/优惠宣传', level: '高', term: '买贵包赔', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-085', tblRow: 86, cat: '价格/优惠宣传', level: '高', term: '永久保价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-086', tblRow: 87, cat: '价格/优惠宣传', level: '高', term: '全网比价最低', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-087', tblRow: 88, cat: '价格/优惠宣传', level: '高', term: '比官网便宜', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-088', tblRow: 89, cat: '价格/优惠宣传', level: '高', term: '专柜价XX', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-089', tblRow: 90, cat: '价格/优惠宣传', level: '高', term: '市场价XX', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-090', tblRow: 91, cat: '促销玩法/互动诱导', level: '高', term: '评论区扣1才发福利', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-091', tblRow: 92, cat: '促销玩法/互动诱导', level: '高', term: '点赞到XX才改价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-092', tblRow: 93, cat: '促销玩法/互动诱导', level: '高', term: '满XX赞才降价', action: 'SESSION_ZERO', mod: null, point: '8.2' },
    { id: 'S2-093', tblRow: 94, cat: '服务/售后承诺', level: '高', term: '无理由终身退', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-094', tblRow: 95, cat: '服务/售后承诺', level: '高', term: '永久包退', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-095', tblRow: 96, cat: '服务/售后承诺', level: '高', term: '终身免费换新', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-096', tblRow: 97, cat: '服务/售后承诺', level: '高', term: '终身质保', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-097', tblRow: 98, cat: '服务/售后承诺', level: '高', term: '永久质保', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-098', tblRow: 99, cat: '服务/售后承诺', level: '高', term: '坏了随便换', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-099', tblRow: 100, cat: '服务/售后承诺', level: '高', term: '任何情况都能退', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-100', tblRow: 101, cat: '服务/售后承诺', level: '高', term: '随时退', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-101', tblRow: 102, cat: '服务/售后承诺', level: '高', term: '无条件退', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-102', tblRow: 103, cat: '服务/售后承诺', level: '高', term: '100%退款', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-103', tblRow: 104, cat: '服务/售后承诺', level: '高', term: '必赔', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-104', tblRow: 105, cat: '服务/售后承诺', level: '高', term: '一定赔', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-105', tblRow: 106, cat: '服务/售后承诺', level: '高', term: '运费全包', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-106', tblRow: 107, cat: '服务/售后承诺', level: '高', term: '到货不满意随便退', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-107', tblRow: 108, cat: '服务/售后承诺', level: '高', term: '全国任何地方都包邮', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-108', tblRow: 109, cat: '来源/资质/专利', level: '中高', term: '原厂', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-109', tblRow: 110, cat: '来源/资质/专利', level: '中高', term: '厂家直营', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-110', tblRow: 111, cat: '来源/资质/专利', level: '中高', term: '厂家直销', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-111', tblRow: 112, cat: '来源/资质/专利', level: '中高', term: '工厂直发', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-112', tblRow: 113, cat: '来源/资质/专利', level: '中高', term: '自家工厂', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-113', tblRow: 114, cat: '来源/资质/专利', level: '中高', term: '自家生产', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-114', tblRow: 115, cat: '来源/资质/专利', level: '中高', term: '进口原装', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-115', tblRow: 116, cat: '来源/资质/专利', level: '中高', term: '海外原装', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-116', tblRow: 117, cat: '来源/资质/专利', level: '中高', term: '原装进口', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-117', tblRow: 118, cat: '来源/资质/专利', level: '中高', term: '海关正品', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-118', tblRow: 119, cat: '来源/资质/专利', level: '中高', term: '专柜正品', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-119', tblRow: 120, cat: '来源/资质/专利', level: '中高', term: '官方正品', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-120', tblRow: 121, cat: '来源/资质/专利', level: '中高', term: '100%正品', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-121', tblRow: 122, cat: '来源/资质/专利', level: '中高', term: '专利产品', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-122', tblRow: 123, cat: '来源/资质/专利', level: '中高', term: '专利技术', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-123', tblRow: 124, cat: '来源/资质/专利', level: '中高', term: '独家专利', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-124', tblRow: 125, cat: '来源/资质/专利', level: '中高', term: '国际专利', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-125', tblRow: 126, cat: '来源/资质/专利', level: '中高', term: '获奖产品', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-126', tblRow: 127, cat: '来源/资质/专利', level: '中高', term: '行业大奖', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-127', tblRow: 128, cat: '来源/资质/专利', level: '中高', term: '设计大奖', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-128', tblRow: 129, cat: '比较/竞品宣传', level: '高', term: '吊打', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-129', tblRow: 130, cat: '比较/竞品宣传', level: '高', term: '秒杀同行', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-130', tblRow: 131, cat: '比较/竞品宣传', level: '高', term: '碾压同行', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-131', tblRow: 132, cat: '数据/排名/口碑', level: '中高', term: '销量第一', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-132', tblRow: 133, cat: '数据/排名/口碑', level: '中高', term: '销量冠军', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-133', tblRow: 134, cat: '数据/排名/口碑', level: '中高', term: '市占率第一', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-134', tblRow: 135, cat: '数据/排名/口碑', level: '中高', term: '回购率第一', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-135', tblRow: 136, cat: '数据/排名/口碑', level: '中高', term: '好评率100%', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-136', tblRow: 137, cat: '数据/排名/口碑', level: '中高', term: '全网爆款', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-137', tblRow: 138, cat: '数据/排名/口碑', level: '中高', term: '百万用户选择', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-138', tblRow: 139, cat: '数据/排名/口碑', level: '中高', term: '千万用户选择', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-139', tblRow: 140, cat: '数据/排名/口碑', level: '中高', term: '零差评', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-140', tblRow: 141, cat: '数据/排名/口碑', level: '中高', term: '0投诉', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-141', tblRow: 142, cat: '数据/排名/口碑', level: '中高', term: '全五星好评', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-142', tblRow: 143, cat: '数据/排名/口碑', level: '中高', term: '全网销量领先', action: 'SESSION_ZERO', mod: null, point: null },
    { id: 'S2-143', tblRow: 144, cat: '材质/检测/等级', level: '中高', term: '食品级', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-144', tblRow: 145, cat: '材质/检测/等级', level: '中高', term: '医用级', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-145', tblRow: 146, cat: '材质/检测/等级', level: '中高', term: '航空级', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-146', tblRow: 147, cat: '材质/检测/等级', level: '中高', term: '航天级', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-147', tblRow: 148, cat: '材质/检测/等级', level: '中高', term: '军工级', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-148', tblRow: 149, cat: '材质/检测/等级', level: '中高', term: '军用级', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-149', tblRow: 150, cat: '材质/检测/等级', level: '中高', term: '母婴级', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-150', tblRow: 151, cat: '材质/检测/等级', level: '中高', term: '婴儿级', action: 'ANNOTATE', mod: null, point: '1.1' },
    { id: 'S2-151', tblRow: 152, cat: '材质/检测/等级', level: '中高', term: '零甲醛', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-152', tblRow: 153, cat: '材质/检测/等级', level: '中高', term: '无甲醛', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-153', tblRow: 154, cat: '材质/检测/等级', level: '中高', term: '零污染', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-154', tblRow: 155, cat: '材质/检测/等级', level: '中高', term: '无毒无害', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-155', tblRow: 156, cat: '材质/检测/等级', level: '中高', term: '绝对环保', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-156', tblRow: 157, cat: '材质/检测/等级', level: '中高', term: '环保无害', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-157', tblRow: 158, cat: '材质/检测/等级', level: '中高', term: '抗菌99.9%', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-158', tblRow: 159, cat: '材质/检测/等级', level: '中高', term: '抑菌99.9%', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-159', tblRow: 160, cat: '商品基础信息', level: '中高', term: '纯天然', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-160', tblRow: 161, cat: '商品基础信息', level: '中高', term: '纯手工', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-161', tblRow: 162, cat: '商品基础信息', level: '中高', term: '纯进口', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-162', tblRow: 163, cat: '商品基础信息', level: '中高', term: '100%真皮', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-163', tblRow: 164, cat: '商品基础信息', level: '中高', term: '100%羊绒', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-164', tblRow: 165, cat: '商品基础信息', level: '中高', term: '100%棉', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-165', tblRow: 166, cat: '商品基础信息', level: '中高', term: '全PC', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-166', tblRow: 167, cat: '商品基础信息', level: '中高', term: '德国材质', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-167', tblRow: 168, cat: '商品基础信息', level: '中高', term: '日本技术', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-168', tblRow: 169, cat: '商品基础信息', level: '中高', term: '意大利设计', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-169', tblRow: 170, cat: '商品基础信息', level: '中高', term: '法国设计', action: 'SESSION_ZERO', mod: null, point: '1.1' },
    { id: 'S2-170', tblRow: 171, cat: '商品基础信息', level: '中高', term: '原产地XX', action: 'SESSION_ZERO', mod: null, point: '1.1' },
  ];

  // ---- V3 表外、按业务侧「没写的可以一律删除」移除的上一版词条（**登记在案，未静默删除**）----
  //   与 v2.0.0 的 DELETED_FROM_NEW_TABLE 不同：那一版是"表里删了但我仍保留"，
  //   本版是**真的不判**。如需恢复任意一条，加回对应类的 terms 即可（源表变更时优先查这里）。
  var REMOVED_IN_V3 = [
    '今天拍今天发', '今天上午拍下午发货', '今天加急发出', '今天拍明天发', '全国都次日达', '今天拍明天一定到', '什么情况都可以换新', '质保', '全球领先第一品牌',
    '所有航空公司一定能登机', '坏了终身免费换', '永久免费换新', '某大牌同款', '同厂同线', '所有航空公司都能登机', '用十年都不会坏', '十年不用换', '十年不会坏',
    '泡水也没事', '淋雨没事', '泡水没事', '什么都能装', '99%杀菌', '99%抑菌', '99抗菌', '杀菌99.9%', '至低价', '史低价', '国际大奖', '马上永久下架',
    '马上下架', '评论区评论', '公屏', '告诉主播', '某某利', '新秀丽', '日默瓦', '爱可乐', '途加', '90分', '其他家没有', '别家没有', '别人没有',
    '同行没有', '其他品牌没有', '其他牌子没有', '别家做不到', '别人做不到', '其他品牌做不到', '很多品牌做不到', '其他家做不到', '只有ITO', '只有我们ITO',
    '只有我们',
  ];

  var GUARD = [
    { term: '第一',  L: 4, R: 4,
      re: /(行业|全国|全网|全球|世界|中国|销量|品牌|排名|市占|回购|好评|口碑|权威|官方|类目|品质|人气|热销|复购)第一|第一名|第一品牌|牌子第一/,
      why: '序数词高频：实测 71 次全是「第一个/第一点/第一天/第一波」；仅"XX第一/第一名"**连写**才是绝对化宣传。L=4 保证"行业第一"4 字连写才判 —— "行业/中国/全球+第一"命中，"行业"或"第一"单独出现均不判' },
    { term: '完全',  re: /完全(防水|静音|不坏|无损|无缺|不会坏|不会爆|不会裂|不会断|不会压|不会掉|无死角|零风险|杜绝|避免|不变形|不褪色|不渗水|防摔|防压|不卡|不磨|隔离|密封|不脏)/,
      why: '程度副词 —— 严格按「绝对化功效宣称」判，**不含口语搭配**。v1.0.3 修正：原白名单里的 `没问题|放心|可以放心` 经 59 份/105.7 万字真实语料实测属高频口语（「完全没问题/完全可以/完全够用/完全一模一样」，另有「完全度」系「完整度」的 ASR 误识），非宣传语境，已移出 —— 移出前它单独导致约 20 份真实场次整场归 0。保留项均为对商品功效的绝对化承诺。' },
    { term: '绝对',  re: /绝对(不|没|是|能|会|可以|好|值|安全|可靠|放心|超值|划算|品质|质量|正品|第一|最好|完美|不会)/,
      why: '口语"比较绝对一点"实测命中；"绝对不坏/绝对安全"才是绝对化承诺' },
    { term: '彻底',  re: /彻底(解决|告别|消除|根除|祛|杀|除螨|洗净|清除|消灭|改变|颠覆|摆脱|提升|杜绝|解决掉)/,
      why: '口语"把我彻底绕进去了"实测命中；"彻底解决/彻底告别"才是功效绝对化' },
    { term: '最好',  re: /最好(的|品牌|产品|选择|一款|那款|方案|搭配|东西)/,
      why: '建议语气"最好还是选30/最好是选30"实测命中；仅"最好的X"是极限词（注：不加"选"，否则建议语气又中）' },
    { term: '首选',  re: /首选(品牌|之选|推荐|产品|一款|选择)/,
      why: '口语"首选1二层就够用了"实测命中；"首选品牌/首选之选"才是绝对化推荐' },
    { term: '赠送',  L: 16, R: 16,
      re: /(点关注|关注|评论区|公屏|粉丝团|进群|加群|扣\d|打\d|刷\d|回复|留言).{0,12}赠送|赠送.{0,12}(点关注|关注|评论区|公屏|粉丝团|进群)/,
      why: 'S1 第5类原文是"点关注送X/评论扣X"⇒违规在**诱导互动**，不在"赠送"本身；实测"确实是没有这个赠送啊"（否定）也命中。L/R=16 是给 `.{0,12}` 跨度留余量' },
    // ⛔ v2.1.0 起 `公屏` 的语境约束**已移除**（口径A「提到就判」）—— 见本数组末尾「已移除的 R6 约束」注释块

    // ⛔ v1.0.3 的「须利益诱导」约束块（`点关注` / `评论区评论`）**已于 v2.1.0 按口径A 移除** ——
    //    原依据（09-17 三次拍板「诱导互动类也加语境必配」）已被 09-24 拍板的口径A 取代。
    //    原判据留档：`点关注` re = 点关注/点点关注/关注一下/加关注/关注 ×{0,12} 送|赠|领|抽|抢|福袋|优惠券… ；
    //                `评论区评论` re = 评论区评论 ×{0,18} 扣|打|发|刷|就可以|领|送|赠… 。
    //    留档这一行是为了将来若回退到「须利益诱导」口径时能一键恢复，不必重推。
    // ---------- v3.1.0 新增（业务侧 2026-10-09 拍板 · V5 表 Sheet1 R6 C 列）----------
    //   C 列原文：「引导用户点关注账号、涨粉、引导客户加粉丝团这样的"关注"话术才算违规；
    //              将"关注"二字带入日常语境中，不算违规」+ 6 个日常语境示例。
    //   🔴 正则内**绝不出现词条本身的字**（"关注"/"评论"）—— 否则自匹配恒真、约束形同失效（09-30 已踩过）。
    { term: '关注', L: 12, R: 12,
      re: /直播间|券|左上角|粉丝|涨粉|灯牌|点亮|加一下|点一点|福利|抽|榜|加入/,
      why: 'V5 R6 C 列口径：须是"引导点关注账号 / 涨粉 / 加粉丝团"才算违规。实测 18 处 / 4 份逐字稿 —— 张天翊 09-15 那 12 处**全是**「关注我们直播间有5元券」类真诱导（保留判 0）；宿浩淇 08-19「我很关注这个滚轴」「受关注的七夕活动」、张文静 08-23「大家比较关注的」共 6 处是「重视」动词义，属 C 列点名的日常语境 ⇒ 挡掉。' },
    { term: '评论', L: 12, R: 12,
      re: /扣|打|刷|公屏|飘|帮主|给主|来一|留下|留言|发一个|发个/,
      why: 'V5 R6 C 列 6 个示例里有 3 个讲"评论"的日常语境（看/查看评论区）⇒ 同办。实测 3 处 / 2 份**全部是误伤**：陈思颖 08-27「点进去那个评论区看一下」、程都兰 08-22「买评论会更多一点」「评论会比较清爽」。真阳性有兜底 —— 本表裸词条 `扣评论` 与 Sheet2「评论区扣1才发福利」仍按 SESSION_ZERO 判 0。' },

    { term: '行李牌字母', L: 18, R: 18,
      re: /(打|发|扣|留|写|报|输入|敲|晒|备注).{0,12}(公屏|评论区|屏幕|弹幕)|(公屏|评论区|屏幕|弹幕).{0,12}行李牌字母|(拍下|下单|买到|购买|下单后).{0,16}行李牌字母|行李牌字母.{0,16}(打|发|扣|留|写|报)/,
      why: '表原文「拍下产品把想要的行李牌字母**打在公屏上**」⇒ 须是"要求用户把字母发到公屏"这个动作；单纯介绍产品带行李牌不判（本法在 59 份语料中零出现）。⚠️ v2.0.0 起该词条本身已不在 S1（见 DELETED_FROM_NEW_TABLE），此条仅备重新启用时使用' },

    // ================================================================
    // ⛔ v2.1.0「已移除的 R6 约束」—— 口径A 落地登记（业务侧 2026-09-24 拍板）
    // ================================================================
    // 移除清单（6 条，全部属 R6 诱导互动）：
    //    公屏 / 打在公屏上 / 评论 / 评论区评论 / 点赞 / 点关注
    // 拍板原话：「主播话术中有拉踩其他品牌来提升自我的产品…另外主播话术中，有提及到
    //            关注、点赞、评论、公屏 也判定违规，0容忍」→ 选「**口径A：提到就判 0**」。
    //
    // 代价（48 份真实逐字稿 / 21.3 MB 实测，脚本 `_scan_r6_final.js`）：
    //    整场归 0：17/48 (35.4%)  →  **29/48 (60.4%)**，即每三场有两场 0 分 E 级。
    //    其中 +8 场来自「公屏/打在公屏上/评论」，+4 场来自补入 `关注`（含 1 份重复副本 ⇒ 实际 +3 场）。
    //    老大已在看到「+8 场、真阳性 0」的前提下拍板，此处如实登记、不代为辩解。
    //
    // ⚠️ 两处**中文多义误伤**（实测存在，未擅自豁免，等业务侧定夺）：
    //    `评论`：①「你点进去那个**评论区**看一下有没有那个大号小号的一个对比」——让用户**看**评论，
    //            非诱导评论；②「但是**买评论**会确实会更多一点」——ASR/口语，与诱导无关。
    //    `关注`：①「我觉得对于一个滚轴我很**关注**」②「那里来看一下大家比较**关注**的」——
    //            均为「关注＝重视」的动词义，非引导关注账号。
    //    ⇒ 合计 3 场（程都兰 08-22 / 宿浩淇 08-19 / 张文静 08-23）纯由多义词致归 0。
    //    如需最小反误伤：只给这两个词各加一条「动作义」紧邻窗口即可（约束写法留档于本数组上方注释）。
    //
    // 附：仍**保留**约束的 2 条 R6 相关词条，理由——
    //    `赠送`：表原文写的是「做XXX就赠XXX（**有条件加赠**违规）」⇒ 表本身要求"有条件"，
    //            老大本次也未点名「赠送」；且实测含「确实是没有这个赠送啊」这类否定式。
    //    `告诉主播`：属 R6 **二级**，老大未点名；实测裸判与否对 48 份语料影响为 0（29→29 场）。

    { term: '告诉主播', L: 12, R: 12,
      re: /(宝贝|宝子|宝宝|亲|同学|这位|这位朋友).{0,12}告诉主播|告诉主播.{0,12}(颜色|尺寸|尺码|想要|哪款|型号)|(颜色|尺寸|尺码|想要).{0,12}告诉主播/,
      why: '新版表 R6 二级原文「XXX宝贝（用户昵称），把想要的颜色和尺寸告诉主播」⇒ 违规在**昵称点名 + 索取规格**这个结构；泛泛的"有问题可以告诉主播"不判' },
    // ---- v2.1.0：R8 拉踩二级锚点 `只有我们` 的强约束 ----
    { term: '只有我们', L: 0, R: 14,
      re: /只有(我们|咱们|我)家?(才)?(有|能|可以|做得到|做到|做的到)/,
      why: '裸字面会误伤：实测「每个主播**只有我们**两单名额给大家」（张文静 08-23 @468s）是名额播报、不是拉踩。要求后接"才有/才能/可以做得到"这类**排他性独有**结构 ⇒ 只判"只有我们家才有的"这类声称他方缺失的表述。实测约束后命中 2 场，引文均为真阳性（"轮子也是只有我们家才有的"）' },
  ];

  var EXEMPT = [
    { term: '最好', re: /卖得最好|卖得最多|卖最好|卖最多|卖的最好|卖的最多|明星自用最多|明星同款最多|明星用的最多|明星用的最多/,
      why: '业务方自己的满分示范话术就是「卖得最好，明星自用最多」（实测误伤 2 处）。v1.0.3 补 `卖最好|卖最多`：ASR 常少"得"字，59 份语料里 7 处「直播间卖最好／这边卖最好」因此漏豁免。' +
           '【v3.1.2 改动】原豁免只有「卖**得**最好」，而真实逐字稿几乎全部写成「卖**的**最好」——' +
           '飞书人工复核 43 场误判里，`最好` 一字独占 **7 场全部**是「卖的最好的颜色是一号链接」「卖的最好的就是综灰」这类同款句式（10-12 王菲/全程/一丹、10-18 曲姝锜、10-21 甘晋铭、10-22 曹佳/甘晋铭），' +
           '一字之差让 7 场全部进标注区。⇒ 补 `卖的最好|卖的最多`，并补 `明星用的最多`（10-20 程方「明星用的最多的一个颜色和款」）。' },
    { term: '100%', re: /100%全新|100%新料|100%纯新/, why: '业务侧「100%全新四层德国拜耳PC」是材质新旧事实陈述（实测误伤 1 处）' },
    { term: '百分百', re: /百分百(的)?(全新|新料|纯新|进口)/,
      why: '与 `100%` 同指的另一种说法：v1.0.3 实测 24 处全是「百分百全新的PC材料／百分百PC箱／百分百纯PC」（程都兰门店接待等），属材质事实陈述。为与已豁免的 `100%` 保持一致而补。' +
           '【v3.1.1 改动】原正则含 `PC|pc` 分支 ⇒ 把「百分百PC」也一并豁免了，与 V5 表 R5 C 列「重点注意事项：涉及 100%PC，百分百PC 的描述，可标注出来，但不判定违规，不判0分」冲突（同句点名的 100%PC 能进标注区、百分百PC 却连记都不记）。' +
           '⇒ 去掉 `PC|pc`，让「百分百PC／百分百pc」落到 S2-032「百分百」（ANNOTATE 档）进报告标注区（**仍不判 0**）。' +
           '「百分百全新的PC材料／百分百新料／百分百纯新／百分百进口」等材质事实陈述仍被本豁免覆盖，两档互不干扰' },
    { term: '全PC', re: /全PC|全pc/, why: 'ITO 箱体就是全 PC 材质，属产品事实描述；讲材质必然出现（无豁免=每场必中）' },

    // ================================================================
    // v3.1.2（2026-10-26）—— **飞书人工复核误判样本反哺**（业务侧拍板：A+B 同时修）
    // ================================================================
    // 来源：飞书「主播日报」新增复核三列（初审违规 / 复核违规 / 误判内容）。
    // 口径：误判样本 = 「初审违规=否」且 AI 侧有痕迹（按0计/已撤销/已标注），实测 **43 场 / 69 条命中**，
    //       误判率 **43/116 = 37.1%**（分母=已判违规且已人工初审的场次）。
    // 提取脚本：`extract_misjudge_cases.py` → `_bak/_misjudge_cases.json`（原文逐条留档）。
    // 下列每条的 why 都写明了对应的**真实引文**与日期主播，便于回飞书原表核对，不凭猜。
    // ⚠️ 这些词条本版**全部已是 ANNOTATE 档（不判 0）**，本条改动只减少"标注区污染"，
    //    不影响分数；真正让 16 场被压成 0 分的是语义通道 n1/n2，改在 `semantic-core.js`。
    // ================================================================

    // ---- 根因 B：词面命中、不看搭配语境 ----
    { term: '完美', re: /更加完美|完美.{0,6}?(贴合|贴盒|搭配|结合|适配|融合|契合|配合|规避|帮)/,
      why: '误判 7 场**全部**是「包和箱子做一个完美贴合/搭配」的**搭配效果**描述，没有一条在说商品品质完美：' +
           '10-21王金鸽「可以跟行李箱做一个完美贴合」、10-20王金鸽「包和箱子也可以做更加完美贴合」、10-17王金鸽「让背包和箱子更加完美」、' +
           '10-15王金鸽「让包和箱子能够做到一个完美的适配和搭配」、10-14苏蓬「跟我们的实用以及功能去完美的结合」、' +
           '10-14王金鸽「让包和箱子可以完美做到一个贴盒」（贴盒=贴合的 ASR 误识）、10-14张洁「25寸和29寸可以很完美的帮它去规避」。' +
           '⚠️ 整段级豁免：同段若同时出现"完美品质"类宣称会被一并放过（该词条为 ANNOTATE 档、不判 0，风险仅为少一条标注）' },
    { term: '唯一', re: /唯一的(区别|不同|差别|差异)/,
      why: '10-20 王菲「12号链接**唯一的区别**就只有颜色上不一样」—— 这里是**限定差异范围**（"唯一的区别是…"是极常见的中性句式），与"唯一品牌"的排他性绝对化无关' },
    { term: '天花板', re: /天花板.{0,8}(容量|组合)/,
      why: '3 场里 2 场是**客观上限描述**：10-17/10-13 赵亚男「天花板容量42升」「登机箱尺寸范围之内天花板的一个容量」；' +
           '另 1 场 10-20 全程「26加20…叫做天花板的一个黄金组合」是组合名称。均非"最好的产品"式绝对化。' +
           '⚠️ `.{0,8}` 是为了吃掉"天花板的一个这个黄金组合"里的口语插入语' },
    { term: '完全', re: /完全避免(了)?(一些|不必要)/,
      why: '10-18 苏蓬「**完全避免**了一些不必要的这种撞击呀」—— 描述减震防护效果，不是"完全无风险"的绝对化承诺。' +
           '⚠️ 同批另一条 10-17 程都兰「这款都是**完全不会爆开**的」**刻意不放宽**（属明确功效绝对化），已在报告里列为待裁定' },

    // ---- 根因 C：客观陈述 / 官方背书被当绝对化 ----
    { term: '永不', re: /永不过时/,
      why: '10-20 王菲「它是我们的经典**永不过时**」—— 成语式表达，非对产品功效的绝对化承诺' },
    { term: '官方正品', re: /也都是官方正品|都是官方正品/,
      why: '10-20 任佳瑛「在我直播间下买也都是**官方正品**」—— ITO 直播间是品牌自营，属**事实陈述**。' +
           '该词条本身已按 V5 R10 C 列点名为 ANNOTATE 档，本条让它不进标注区' },
    { term: '最优', re: /(尽可能|尽量|努力).{0,12}最优惠/,
      why: '10-15 苏蓬「我们一定会**尽可能**的让大家在直播间拍的**最优惠**的价格」—— 有"尽可能"弱化，且指促销力度、非商品品质绝对化' },
    { term: '首选', re: /颜色首选|首选推荐/,
      why: '10-15 全程「**颜色首选**推荐」—— 推荐语，非排他性绝对化推荐（原 GUARD 要求"首选+品牌/之选/产品"才判，"首选推荐"恰好撞上）' },
    // ⛔ 撤回：`飞机舷窗` / `飞机悬窗` 的整词豁免（v3.1.2 自查推翻，勿再重启）
    //   初版写成 `{term:'飞机舷窗', re:/飞机舷窗/}` 整词豁免，**双向 A/B 直接抓出放水**：
    //   「应仍判」集（初审=是）里有 **13 条**是飞机悬窗/舷窗 ——「飞机悬窗玻璃」「被广泛应用于像是飞机悬窗」
    //   「斯创工厂的拜尔材质跟那个飞机悬窗」「它是相当于飞机舷窗同款质地」；而「应不判」集（初审=否）也有 5 条。
    //   ⇒ 同一表达人工一边判"是"一边判"否"，**人工初审自身不一致**，不能靠整词豁免一刀切。
    //   ⇒ 本版**不豁**，维持 S1-10 原有的 ANNOTATE（记一笔、不判 0）。矛盾已上报待业务侧裁定。

    // ---- 根因 D：母婴级/婴儿级**有检测配套** ----
    { term: '母婴级', re: /(母婴级|母婴级别).{0,14}(7A|7a|抑菌|抗菌|灭菌|灭杀|杀菌|90)/,
      why: '7 场命中里 6 场同段给出了**具体检测等级**作为依据：「内里材质都是母婴级的**7A级**」「母婴级别的1个**7A级90加**的细菌灭杀率」' +
           '「内里都是母婴级的**抑菌**的一个材质」「母婴级**抗菌**的材质」⇒ 有据可依，不应与中国广告法意义上的"无依据等级宣称"同办。' +
           '⚠️ 该词条为 ANNOTATE 档、不判 0；本条仅让它不进标注区。第 7 场 10-13 曲姝锜「质作都是母婴级别的」若整段无检测配套则**仍会标注**（保守）' },
    { term: '婴儿级', re: /婴儿级别?(的)?(一些)?衣服/,
      why: '3 场（10-20/10-15/10-14 全程）全是**使用场景说明**：「可以放**婴儿级别的衣服**」「婴儿级别的衣服可以直接放的」「也是切的婴儿级别的衣服可以直接放的」—— ' +
           '说的是"能放婴儿衣物"，不是宣称材质达到婴儿级标准。注意与 `母婴级` 的材质等级宣称区分。' +
           '⚠️ 初版正则要求前面必须有"放/可以放"，实测 3 条里 1 条是「**切的**婴儿级别的衣服」，前置词不是"放" ⇒ 去掉前置要求，只锚定"婴儿级+衣服"' },

    // ---- 根因 E：疑问句 / 分词错误 ----
    { term: '今天发', re: /(可以|能不能|能否|会不会).{0,6}今天发.{0,3}(吗|么|嘛|\?|？)/,
      why: '10-21 程方「你今天下单**可以今天发吗**？」—— **疑问句**，主播在向场控/客服询问，不是对买家的时效承诺。' +
           'S1-02 属保价时效类，处理对象是"承诺"，问句不构成承诺' },
    { term: '明天到', re: /明天到\d+月|从明天到/,
      why: '10-18 王菲「但是**从明天到**11月1号的券的额度…」—— 这是"明天"+"到11月1号"被**分词误切**成「明天到」，' +
           '与物流时效承诺毫无关系。`明天到\\d+月` 兜住"明天到11月"这类跨词切分' },
    { term: '不降价', re: /(一般|通常|基本上)都?是不打折|(一般|通常|基本上)都?不降价/,
      why: '10-21 刘育「因为**一般都是不打折**不降价的」—— 陈述**行业普遍现象**（有"一般"弱化），不是对本场价格的保价承诺。' +
           'S1-01 要治的是"我们全年保价"这类自我承诺' },

  ];

  // ---- 派生统计（供自检与报告显示）----
  var S1_TERMS   = S1.reduce(function(a,x){ return a + x.terms.length; }, 0);
  var S2_TERMS   = S2.length;
  var S2_SESSION = S2.filter(function(x){ return x.action === 'SESSION_ZERO'; });
  var S2_MODULE  = S2.filter(function(x){ return x.action === 'MODULE_ZERO'; });
  var MODULE_W   = { c1: 25, c2: 20, c3: 20, c4: 15, c5: 20, c6: 0, c7: 0, c8: 0 };  // 真源 v3/standard.js

  // v3.1.0：处置档具名常量（业务侧拍板口径，别在壳层写字面量）
  var ACTION = { SESSION_ZERO: 'SESSION_ZERO', MODULE_ZERO: 'MODULE_ZERO', ANNOTATE: 'ANNOTATE' };
  // v3.1.0：ANNOTATE（标注不判 0）条目清单 —— 供自检与报告显示
  var ANNOTATE_LIST = S1.filter(function(x){ return x.action === ACTION.ANNOTATE; })
                        .map(function(x){ return { id: x.id, cat: x.cat, n: x.terms.length }; })
                        .concat(S2.filter(function(x){ return x.action === ACTION.ANNOTATE; })
                        .map(function(x){ return { id: x.id, cat: x.cat, n: 1, term: x.term }; }));

  root.V4ViolationRules = {
    _v: _v,
    src: '抖音直播客观违规规则V3版.xlsx（词表）＋V5.xlsx（Sheet1 C 列口径）',
    rulesAt: '2026-10-09',
    S1: S1,
    S2: S2,
    EXEMPT: EXEMPT,
    GUARD: GUARD,
    GUARD_L: 6,                      // 紧邻窗口默认半径：命中点左侧 6 字（逐条可覆盖）
    GUARD_R: 6,                      // 紧邻窗口默认半径：命中点右侧 6 字（逐条可覆盖）
    MODULE_NAME: { c1: '产品理解能力', c2: '逻辑组织能力（流畅度）', c3: '场景化表达能力（延展性）',
                   c4: '可视化道具运用', c5: '情绪感染能力', c6: '需求识别能力（权重0）',
                   c7: '临场反应能力（权重0）', c8: '转化引导能力（权重0）' },
    MODULE_W: MODULE_W,
    REMOVED_IN_V3: REMOVED_IN_V3,
    ACTION: ACTION,                          // v3.1.0：处置档常量
    ANNOTATE_LIST: ANNOTATE_LIST,            // v3.1.0：标注不判 0 的条目清单
    stat: {
      s1Cats: S1.length,                       // v3.0.0 起 = 表内类目数（**不再拆一级/二级**）
      s1Terms: S1_TERMS,
      s1SemanticOnly: S1.filter(function(x){ return x.semantic; }).length,
      s2Total: S2_TERMS,
      s2SessionZero: S2_SESSION.length,
      s2ModuleZero: S2_MODULE.length,
      annotate: ANNOTATE_LIST.length,          // v3.1.0：标注不判 0 的条目数
      s1Annotate: S1.filter(function(x){ return x.action === ACTION.ANNOTATE; }).length,
      s2Annotate: S2.filter(function(x){ return x.action === ACTION.ANNOTATE; }).length,
      matchers: S1_TERMS + S2_TERMS,
      guarded: GUARD.length,
      exempt: EXEMPT.length,
      removedTerms: REMOVED_IN_V3.length,
      codes: S1.length + S2.length
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.V4ViolationRules;
})(typeof window !== 'undefined' ? window : globalThis);
