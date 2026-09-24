/* ============================================================
 * v4/violation-rules.js —— 直播平台红线规则库（v2.1.0）
 *
 * 来源：抖音直播客观违规规则.xlsx（逐字提取，未发明任何词条）
 *    Sheet1「ITO箱包直播违规表达」 八类 —— B1 原文「提到就触发客观0分违规」
 *    Sheet2「平台通用违规高风险词库」170 条 / 11 类
 *
 * 处置口径（2026-09-17 业务侧拍板）：
 *    SESSION_ZERO = 命中即该场**总分归 0**
 *    MODULE_ZERO  = 命中即**对应能力模块归 0**
 *    （模块权重 25/20/20/15/20/0/0/0 ⇒ 映射到 6/7/8 的条目不改变总分，属已知空转）
 *
 * v1.0.1（2026-09-17 业务侧拍板「A」）：新增 GUARD —— 8 个"词根级"条目加**宣传/诱导语境必配**。
 *    依据：真实 4 小时逐字稿实测，这 8 个词根造成 112 次命中、真阳性 0，不加约束则**每场必 0 分**。
 *    **条目一条未删**；`redline_strict='1'` 可一键回退原口径。
 *
 * v1.0.2（2026-09-17 业务侧二次拍板）—— GUARD 由"±30 字窗口"**收紧为紧邻窗口**：
 *    原话「行业第一，必须是 4 个字都说了才判断违规；如果只讲到'第一'、或是'行业'等，不归纳到违规中」。
 *    ⚠️ 注意分工：`行业第一/中国第一/全球领先第一品牌` 本就是 **S1-4 表内逐字的独立条目**（裸匹配即命中），
 *       `全网/全球/世界/行业/全国/宇宙第一` 与 `销量/市占率/回购率第一` 同样是 **S2 R16-21 / R132-135 的独立条目**；
 *       GUARD 只负责 **S2 R10 那条孤立的裸「第一」** —— 替它补上"必须与宣传名词连写"的判据。
 *       收紧前：同段出现"行业第一"后，其后 30 字内的「第一个/第一点」会被**连带判违规**（证据清单串味）。
 *
 * v1.0.3（2026-09-17 业务侧三次拍板「B：诱导互动类也加语境必配」）——
 *    ① Sheet1 第5类另 3 个裸词条 `点关注` / `评论区评论` / `行李牌字母` 一并加语境必配
 *       （依据表原文 B6「引导直播间点关注，赠送XXX…等**诱导评论点关注**的话术」⇒ 违规在"诱导"）；
 *    ② **修正 `完全` 的语境白名单**：移出 `没问题|放心|可以放心`（口语，非宣传语境）——
 *       59 份真实逐字稿 / 105.7 万字实测该词 468 次命中，移出前它单独导致约 20 份场次整场归 0；
 *    ③ 补 `百分百` 豁免（与已豁免的 `100%` 同指，24 处全是"百分百全新的PC材料"）；
 *    ④ 补 `最好` 豁免 `卖最好|卖最多`（ASR 少"得"字，7 处漏豁免）。
 *    **为什么必须做这套实测**：初版口径下 53 份真实场次有 30 份（56.6%）会整场归 0 —— 那样红线
 *    功能等于把整场评分统一压成 0，8 能力维度失去区分度。判据收窄后见 assets/viol_allscan_*.txt。
 *
 * v2.0.0（2026-09-23，业务侧拍板「一级归0 + 二级归模块0」）—— 依据新版《抖音直播客观违规规则(0923更新).xlsx》：
 *    ① **Sheet2 170 条 = 逐条对拍零变化**（新增 0 / 删除 0 / 分类等级 0 / 行号全同）⇒ 本文件 S2 一字节未动。
 *    ② Sheet1 **8 类 → 9 类**，新增 R10「虚假承诺」（一级；表内明写"没有擦边的任何可能性"⇒无二级）。
 *    ③ Sheet1 **引入「一级违规（0容忍）/ 二级违规（擦边话术）」分级**，全表重写：
 *       一级 → SESSION_ZERO（整场归 0）；二级 → MODULE_ZERO（对应模块归 0）。
 *       为此把原「类别一条」拆成「同类目 × 一级/二级两条」，**壳层 v4-shell.js 与扫描器判定逻辑未变**。
 *    ④ R5 表内首次写明「**违规词定义：只有同时出现四个字或以上字数才能触发违规**」——
 *       与业务侧 09-17 原话一致；本版仅登记，**未据此清理其余 2~3 字裸词**（属口径变更，待拍板）。
 *    ⑤ 表内已删除的上一版条目 → `DELETED_FROM_NEW_TABLE`（登记在案，未静默删除）。
 *
 * v2.1.0（2026-09-24，业务侧拍板「口径A：**提到就判 0**」）—— 只动 R6，其余类别一字节未改：
 *    ① 移除 R6 的 **6 条「须利益诱导」语境约束**（`公屏`/`打在公屏上`/`评论`/`评论区评论`/`点赞`/`点关注`）
 *       ⇒ 表内裸列词一律按**字面直接判**（一级 → 整场归 0）。
 *    ② **补入 `关注` 词条**——老大原话是「关注」，而旧词条只有 `点关注`：
 *       实测漏判真违规（张天翊 09-15 摩登场 13 次「关注我们直播间会有一个5元优惠券」，因不含"点"字零命中）。
 *    ③ 保留 `赠送`（表原文「做XXX就赠XXX（**有条件加赠**违规）」，表本身要求"有条件"，老大未点名）
 *       与 `告诉主播`（R6 二级，老大未点名；实测裸判与否影响 29→29 场，为 0）。
 *    实测代价（48 份真实逐字稿 / 21.3 MB）：整场归 0 **17/48 (35.4%) → 29/48 (60.4%)**。
 *    两处中文多义误伤（`评论`/`关注` 共 3 场）已在 GUARD 区注释中逐条登记，**未擅自豁免**。
 *    回退：`redline_strict='1'` 仍可切回纯字面条目口径；恢复旧约束的判据原文留档于 GUARD 区注释。
 *
 * ⚠️ 本文件不含政治敏感类具体词表（Sheet1 第6类）、拉踩（第7类）、侮辱类（第8类）与虚假承诺（第9类）：
 *    这四类表内没有"话术字面词"（判的是性质/真假，不是用词），硬编码会失真且误伤 ⇒ 交语义通道判定。
 *    ⚠️ 新版表 R7 出现了可枚举国别锚点（日本/韩国/美国/日韩）、R9 二级出现「提示场控处理一下用户」——
 *       本版**刻意未采纳**为字面词条（讲产地/竞品国别/正常叫场控会大面积误伤），已在代码内逐条注明。
 *    🔴 v2.1.0 补充实测（拉踩第7类）—— **结论是"不能靠改语义判据"**：
 *       现行语义 n3 片段级召回仅 2/14 (14.3%)、整场层 12/48 (25.0%)（且多为真阳性）；
 *       把判据改宽 → 47/48 (97.9%)、收窄版 → 39/48 (81.3%)，**两条路都会让红线功能失效**。
 *       ⇒ 最终**不动 `semantic-core.js`**，改走确定性字面锚点（见 R8 条目内注释）。
 *       实测脚本：`_n3_recall_test.js` / `_n3_impact.js` / `_n3_impact2.js` / `_scan_lacai_literal.js`。
 * ============================================================ */
(function(root){
  'use strict';
  var _v = '2.1.0';

  // ---- Sheet1：ITO 自有红线九类（v2.0.0：引入「一级/二级」分级）----
  //   处置映射（业务侧 2026-09-23 拍板「一级归0 + 二级归模块0」）：
  //     一级违规（0容忍）  → SESSION_ZERO：本场**总分归 0**（模块明细保留，仅供复盘）
  //     二级违规（擦边话术）→ MODULE_ZERO ：对应能力模块**归 0**，随后重算总分
  //   ⚠️ 已知空转（如实标注，不掩盖）：模块权重 c1..c5 = 25/20/20/15/20、**c6/c7/c8 = 0**
  //      ⇒ 二级条目若映射到 c6/c7/c8，只落明细与横幅，**不改变总分**。
  //      本版命中者：`1 保价承诺·二级`(mod8 价格类，沿用 S2「价格/优惠宣传」惯例)、
  //                  `5 诱导互动·二级`(mod8 转化引导)。
  //      若业务侧要求二级必须真扣分，这两条的 mod 需改指到计分模块（c1 或 c5），属口径变更，待拍板。
  //   词条来源（代码里不可见，在此登记）：[表] = 新版表逐字；[沿用] = 上一版保留。
  //   新版表已不再列出的上一版条目 → 见 DELETED_FROM_NEW_TABLE（**未静默删除**）。
  //   ⚠️ 本版**未新增任何 GUARD**（除逐字沿用者）——按「先实测、再收窄」纪律，
  //      先以纯字面跑全语料普查，据证据再决定给哪些短词加语境约束。
  var S1 = [
    // ---- R2 保价承诺话术 ----
    { id: 's1-1-1', cat: '1 保价承诺·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: false,
      terms: ['全年保价', '全年不打折', '不降价', '保价'] },
    { id: 's1-1-2', cat: '1 保价承诺·二级(擦边)', tier: 2, action: 'MODULE_ZERO', mod: 8, point: '8.2', semantic: false,
      terms: ['价格统一', '全渠道统一', '统一价格', '保证价格', '价格保证'] },

    // ---- R3 物流时效违规承诺 ----
    { id: 's1-2-1', cat: '2 物流时效·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: false,
      terms: ['18点前截单发', '江浙沪周边明天到', '今天加急发', '今天拍今天发', '今天上午拍下午发货', '今天加急发出', '今天发', '下午发'] },
    { id: 's1-2-2', cat: '2 物流时效·二级(擦边)', tier: 2, action: 'MODULE_ZERO', mod: 1, point: '1.1', semantic: false,
      terms: ['今天拍明天发', '全国都次日达', '今天拍明天一定到', '明天发', '次日达', '两天到'] },

    // ---- R4 售后保障违规承诺 ----
    { id: 's1-3-1', cat: '3 售后保障·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: false,
      terms: ['360天内出现任何情况都可以免费换新', '任何情况都能退', '拆了用了也能退', '什么情况都可以换新', '运费险可以包运费'] },
    { id: 's1-3-2', cat: '3 售后保障·二级(擦边)', tier: 2, action: 'MODULE_ZERO', mod: 1, point: '1.1', semantic: false,
      terms: ['质保'] },

    // ---- R5 极限词表达 ----
    //   ⚠️ 新版表在 R5 一级栏内首次写明：「违规词定义：只有同时出现四个字或以上字数才能触发违规」。
    //      现行做法只给裸「第一」加了紧邻窗口约束（GUARD L4/R4），**未按此条清理其余 2~3 字裸词**
    //      （上表 S2 内的 唯一/完美/绝对/彻底/首选/永久/终身/永不 等）。是否统一收窄，待拍板。
    { id: 's1-4-1', cat: '4 极限词·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: false,
      terms: ['全球领先第一品牌', '所有航空公司一定能登机', '同尺寸容量最大', '全球设计大奖',
              '行业第一', '中国第一', '全球第一', '绝对静音', '完全静音',
              '全网最低价', '全网最低', '史上最低', '全年最低',
              '100%抗菌', '100%杀菌', '100%抑菌', '永久抗菌', '永久杀菌', '永久抑菌',
              '完全抗菌', '完全杀菌', '完全抑菌',
              '100%防水', '完全防水', '无限容量', '一辈子不用换', '一辈子不用坏',
              '终身免费', '永久免费', '坏了终身免费换', '永久免费换新',
              '获奖无数', 'RIMOWA平替', '某大牌同款', '同厂同线', '永久下架', '一定能登机'] },
    { id: 's1-4-2', cat: '4 极限词·二级(擦边)', tier: 2, action: 'MODULE_ZERO', mod: 1, point: '1.1', semantic: false,
      terms: ['所有航空公司都能登机', '用十年都不会坏', '十年不用换', '十年不会坏',
              '泡水也没事', '淋雨没事', '泡水没事', '什么都能装',
              '99%杀菌', '99%抑菌', '99抗菌', '杀菌99.9%',
              '0噪音', '至低价', '史低价', '国际大奖', '马上永久下架', '马上下架'] },

    // ---- R6 诱导互动表达 ----
    //   表内**一级栏裸列** 点关注/评论/飘公屏/扣评论/打在公屏上/点赞/关注点一点/小赞点一点。
    //   🟢 v2.1.0 口径变更（业务侧 2026-09-24 拍板「**口径A：提到就判 0**」）：
    //      上述表内裸列词**一律按字面直接判**，不再要求"须利益诱导"（GUARD 约束已移除；
    //      老大原话「提及到 关注/点赞/评论/公屏 也判定违规，0容忍」）。
    //      代价经 48 份真实逐字稿实测如实登记：整场归 0 由 17/48(35.4%) → **29/48(60.4%)**，
    //      其中「评论」「关注」两个中文多义词各含实测误伤（详见 GUARD 区注释）。
    //   ⚠️ 补入 `关注`（v2.1.0）：老大原话是「**关注**」而旧词条只有 `点关注` ⇒
    //      实测漏判真违规——张天翊 09-15 摩登场 13 次「关注我们直播间会有一个5元优惠券」
    //      （利益诱导）因**不含"点"字**而零命中、当次不归零。这是本次补词条的实测依据。
    { id: 's1-5-1', cat: '5 诱导互动·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: false,
      terms: ['打在公屏上', '关注点一点', '小赞点一点', '飘公屏', '扣评论',
              '点关注', '评论区评论', '赠送', '公屏', '评论', '点赞', '关注'] },
    //   R6 二级原文：「XXX宝贝（用户昵称），把想要的颜色和尺寸告诉主播」⇒ 违规在**昵称+索取规格**。
    { id: 's1-5-2', cat: '5 诱导互动·二级(擦边)', tier: 2, action: 'MODULE_ZERO', mod: 8, point: '8.2', semantic: false,
      terms: ['告诉主播'] },

    // ---- R7 政治敏感表达 ----
    //   ⚠️ 新版表一级栏出现**可枚举字面锚点**（日本/韩国/美国/日韩、918/711/54青年节）。
    //      本版**未采纳**为字面词条：讲产地/竞品国别/节点会大面积误伤，且这几类历来交语义通道。
    //      ⇒ 保持 semanticOnly。若业务侧要求字面拦截，需先定义排除语境（属口径变更）。
    //   ⚠️ 二级语义（正能量/热搜话题）**当前无实现**：字面通道无词条 ⇒ 不触发；
    //      语义通道（neg0 n1–n8）只产出整场级 ⇒ 无法表达"二级"。故 mod 留空并如实登记
    //      （不硬指到某个能力模块制造"看起来落地了"的假象）。待语义侧支持分级后再补。
    { id: 's1-6-1', cat: '6 政治敏感·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: true, terms: [] },
    { id: 's1-6-2', cat: '6 政治敏感·二级(擦边)', tier: 2, action: 'MODULE_ZERO', mod: null, point: null, semantic: true, terms: [] },

    // ---- R8 拉踩表达 ----
    //   🟢 v2.1.0 起**补入字面锚点**（原为 semantic:true + terms:[]，100% 依赖语义通道）。
    //   起因：业务侧 09-24 要求「主播话术中有拉踩其他品牌来提升自我的产品…也需要判定违规」。
    //
    //   🔴 为什么最终没有改语义判据（实测三版，48 份真实语料 / 生产截断口径 30000 字）：
    //      现行 n3（要件"点名或暗指竞品**并贬损**"）        = 12/48 (25.0%)  ← 多为真阳性，合理
    //      扩宽 n3（加"泛指主体负面衬托"）                  = 47/48 (97.9%)  ⛔ 红线失效
    //      收窄版（只留表依据两类 + 显式排除泛泛对比）      = 39/48 (81.3%)  ⛔ 仍收不干净
    //   根因：中文直播语境里「比普通箱子轻」与「比市面上的其他同尺寸箱子轻」语义**几无差别**，
    //         模型一律算作"与他方比较" ⇒ **靠改判据文本收不干净**，故改走确定性字面通道。
    //   实测脚本：`_n3_impact.js`（三版整场影响面）、`_n3_impact2.js`（收窄版）、
    //             `_n3_recall_test.js`（片段级召回：现行 2/14 = 14.3%）
    //
    //   一级锚点（点名/暗指**具体竞品** → 表 R8 一级「拉踩其他品牌抬高ITO产品」）：
    //      词条共 6 个品牌名，两类来源必须分开看（此处措辞已按代码实际内容更正）：
    //        · `某某利` —— **实测命中 1 处**（赵亚男 08-21 736s），是主播对新秀丽的 ASR/口播变体；
    //        · `新秀丽`/`日默瓦`/`爱可乐`/`途加`/`90分` —— 48 份语料 **零出现**，是作为
    //          **通用竞品名登记在册**（未来场次若提及即可命中），本次实测**不触发**。
    { id: 's1-7-1', cat: '7 拉踩·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: true,
      terms: ['某某利', '新秀丽', '日默瓦', '爱可乐', '途加', '90分'] },
    //   二级锚点（**明确声称他方没有/做不到** → 表 R8 二级原文
    //              「ITO产品有但是其他产品或者品牌没有的功能和卖点」）。
    //      ⚠️ `只有我们` 带强约束：裸字面会误伤「每个主播**只有我们**两单名额给大家」（实测 1 处），
    //         故要求后接"才有/才能/可以做得到"这类**排他性独有**结构（见 GUARD）。
    //      ⚠️ 刻意**未采纳**「市面上没有」（实测唯一命中是张天翊 10549s「不叫道市面上没有」= ASR 乱码），
    //         以及「千篇一律/老土/刻板/笨重」等贬损形容词（属常见措辞，单用会大面积误伤）。
    //     📊 实测影响面（`_measure_r8_marginal.js` —— 用**边际测量**而非集合对比，见下注）：
    //        锚点真实命中 **7 处 / 5 场次**（已过 GUARD），整场归零率**逐字不变 29/48 → 29/48**。
    //        这 5 场另有归零原因，**并非"被 R6 覆盖"**（早期注释措辞已按实测更正）：
    //          · 3 场由 R6 口径A 的 `公屏`/`打在公屏上`（张文静 8.14 / 8.18 / 08-21）
    //          · 2 场由 S2 字面一级（邹晨汐 08-26「吊打/最好/天花板」、赵亚男 08-21「完全」）
    //        ⇒ 确认为**零额外代价的真阳性补齐**，价值在于报告能标注"因拉踩被判"。
    //     ⚠️ 方法论更正：`_scan_lacai_literal.js`（P0=P1=P2=29）只证明"集合大小相同"，
    //        证不了"锚点无边际贡献"。本版改用**逐变体跑同一语料再取差集**（NO_R8/R8_1/R8_2），
    //        并顺带验证 GUARD 真在挡（裸子串 11 处 → 过 GUARD 后 7 处；
    //        被挡的 4 处为「只有我们家柴油的」「也只有我们的开始我而来」等 ASR 乱码/非排他句）。
    //     ⚠️ 一级锚点 `某某利` 是**唯一**的一级命中（赵亚男 08-21 736s「很多老的顾客之前都是买
    //        某某利行李箱的」）—— 该处**点名竞品但无贬损**（属"老客转投"陈述），
    //        已登记为**业务侧待复核的边界**；因该场早被 S2 `完全` 归零，当前不改变任何结果。
    //     🔴 已知落地缺口（比"空转"更严重，务必知悉）：本条目 `mod` 留 null ⇒
    //        扫描器 `summarize()` 里 `mods` 只收 `mod` 为真的条目 ⇒ `moduleZero=false`
    //        ⇒ 壳层 `redlineApply` 的 `if(sc.moduleZero)` 不成立 ⇒ **reasons 不推入、横幅不显示**。
    //        即：二级拉踩命中**在用户可见的报告里完全不可见**（只在扫描器 `hits` 与
    //        `_measure_r8_marginal.js` 的明细里能看到），既不归零也不改分。
    //        表 R8 二级未指定模块 ⇒ 未硬凑。若要让它可见/真扣分，需业务侧二选一拍板：
    //          (a) 指 `c8 转化引导能力`（权重 0，与 R6 二级一致 ⇒ 可见但仍不扣分）
    //          (b) 指 `c1 产品理解能力`（权重 25，含 1.3 产品差异化表达 ⇒ 真扣分，代价大）
    { id: 's1-7-2', cat: '7 拉踩·二级(擦边)', tier: 2, action: 'MODULE_ZERO', mod: null, point: null, semantic: true,
      terms: ['其他家没有', '别家没有', '别人没有', '同行没有', '其他品牌没有', '其他牌子没有',
              '别家做不到', '别人做不到', '其他品牌做不到', '很多品牌做不到', '其他家做不到',
              '只有ITO', '只有我们ITO', '只有我们'] },

    // ---- R9 侮辱直播用户表达 ----
    //   ⚠️ R9 二级新增「提示运营/小助理/场控处理一下用户」——高频动作，字面检测必误伤，未采纳。
    { id: 's1-8-1', cat: '8 侮辱用户·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: true, terms: [] },
    { id: 's1-8-2', cat: '8 侮辱用户·二级(擦边)', tier: 2, action: 'MODULE_ZERO', mod: null, point: null, semantic: true, terms: [] },

    // ---- R10 虚假承诺（新增类别）----
    //   一级：虚假产品卖点/材质和功能承诺、虚假品牌售后服务承诺、虚假赠品承诺、虚假价格承诺
    //   二级：表内原文「虚假承诺是红线行为，没有擦边的任何可能性」⇒ **本类无二级**
    //   ⚠️ 表内无字面词（判的是"真假"，不是"用词"）⇒ semanticOnly；与 1.1 参数准确 邻接，勿重复扣。
    { id: 's1-9-1', cat: '9 虚假承诺·一级(0容忍)', tier: 1, action: 'SESSION_ZERO', mod: null, point: null, semantic: true, terms: [] },
  ];

  // ---- 新版表已不再列出的上一版条目（**登记在案，未静默删除**；处置见注释）----
  //   本版把它们保留在同一 tier 的 terms 里（宁多勿漏），仅在此登记，便于业务侧核对后决定去留：
  //     全球领先第一品牌 / 某大牌同款 / 同厂同线 → 保留于 4 极限词·一级
  //     杀菌99.9% / 用十年都不会坏 / 史低价 / 泡水也没事 → 保留于 4 极限词·二级
  //     坏了终身免费换 / 永久免费换新 → 保留于 4 极限词·一级
  //     马上永久下架 → 保留于 4 极限词·二级（其子串「永久下架」已由一级命中，处置取重）
  //     什么情况都可以换新 → 保留于 3 售后保障·一级（表内改写为「360天内出现任何情况都可以免费换新」）
  //     一定能登机 → 保留于 4 极限词·一级（表内改写为「所有航空公司一定能登机」）
  //     行李牌字母 → **未保留为独立词条**：新版表 R6 一级把动作改写成「打在公屏上」，
  //                  旧判据（要求用户把字母发到公屏）已由「打在公屏上」+ 公屏 GUARD 覆盖。
  //                  若业务侧认为仍需单独拦，把它加回 5 诱导互动·一级 并配 GUARD 即可。
  var DELETED_FROM_NEW_TABLE = [
    '全球领先第一品牌', '某大牌同款', '同厂同线', '杀菌99.9%', '用十年都不会坏', '史低价',
    '泡水也没事', '坏了终身免费换', '永久免费换新', '马上永久下架', '什么情况都可以换新', '一定能登机',
    '行李牌字母',
  ];

  // ---- Sheet2：170 条词条（按类别决定处置）----
  var S2 = [
    { row: 2, cat: '绝对化/极限宣传', level: '高', term: '国家级', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 3, cat: '绝对化/极限宣传', level: '高', term: '最高级', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 4, cat: '绝对化/极限宣传', level: '高', term: '最佳', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 5, cat: '绝对化/极限宣传', level: '高', term: '最好', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 6, cat: '绝对化/极限宣传', level: '高', term: '最强', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 7, cat: '绝对化/极限宣传', level: '高', term: '最优', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 8, cat: '绝对化/极限宣传', level: '高', term: '顶级', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 9, cat: '绝对化/极限宣传', level: '高', term: '极品', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 10, cat: '绝对化/极限宣传', level: '高', term: '第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 11, cat: '绝对化/极限宣传', level: '高', term: '唯一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 12, cat: '绝对化/极限宣传', level: '高', term: '首选', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 13, cat: '绝对化/极限宣传', level: '高', term: '冠军', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 14, cat: '绝对化/极限宣传', level: '高', term: '天花板', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 15, cat: '绝对化/极限宣传', level: '高', term: '史上最', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 16, cat: '绝对化/极限宣传', level: '高', term: '全网第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 17, cat: '绝对化/极限宣传', level: '高', term: '全球第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 18, cat: '绝对化/极限宣传', level: '高', term: '世界第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 19, cat: '绝对化/极限宣传', level: '高', term: '行业第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 20, cat: '绝对化/极限宣传', level: '高', term: '全国第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 21, cat: '绝对化/极限宣传', level: '高', term: '宇宙第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 22, cat: '绝对化/极限宣传', level: '高', term: '无敌', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 23, cat: '绝对化/极限宣传', level: '高', term: '完美', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 24, cat: '绝对化/极限宣传', level: '高', term: '绝对', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 25, cat: '绝对化/极限宣传', level: '高', term: '100%', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 26, cat: '绝对化/极限宣传', level: '高', term: '零缺点', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 27, cat: '绝对化/极限宣传', level: '高', term: '零风险', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 28, cat: '绝对化/极限宣传', level: '高', term: '永不', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 29, cat: '绝对化/极限宣传', level: '高', term: '永久', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 30, cat: '绝对化/极限宣传', level: '高', term: '终身', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 31, cat: '绝对化/极限宣传', level: '高', term: '彻底', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 32, cat: '绝对化/极限宣传', level: '高', term: '完全', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 33, cat: '绝对化/极限宣传', level: '高', term: '百分百', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 34, cat: '权威背书/资质', level: '高', term: '国家认证', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 35, cat: '权威背书/资质', level: '高', term: '国家推荐', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 36, cat: '权威背书/资质', level: '高', term: '政府推荐', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 37, cat: '权威背书/资质', level: '高', term: '官方指定', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 38, cat: '权威背书/资质', level: '高', term: '央视推荐', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 39, cat: '权威背书/资质', level: '高', term: '人民大会堂同款', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 40, cat: '权威背书/资质', level: '高', term: '军方指定', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 41, cat: '权威背书/资质', level: '高', term: '国家机关推荐', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 42, cat: '权威背书/资质', level: '高', term: '专家认证', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 43, cat: '权威背书/资质', level: '高', term: '权威认证', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 44, cat: '权威背书/资质', level: '高', term: '国际权威认证', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 45, cat: '权威背书/资质', level: '高', term: '国家免检', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 46, cat: '权威背书/资质', level: '高', term: '质量免检', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 47, cat: '功效/性能宣传', level: '高', term: '摔不坏', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 48, cat: '功效/性能宣传', level: '高', term: '压不坏', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 49, cat: '功效/性能宣传', level: '高', term: '刮不花', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 50, cat: '功效/性能宣传', level: '高', term: '永不变形', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 51, cat: '功效/性能宣传', level: '高', term: '永不褪色', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 52, cat: '功效/性能宣传', level: '高', term: '绝不漏水', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 53, cat: '功效/性能宣传', level: '高', term: '100%防水', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 54, cat: '功效/性能宣传', level: '高', term: '完全防水', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 55, cat: '功效/性能宣传', level: '高', term: '零噪音', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 56, cat: '功效/性能宣传', level: '高', term: '完全静音', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 57, cat: '功效/性能宣传', level: '高', term: '0噪音', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 58, cat: '功效/性能宣传', level: '高', term: '永久抗菌', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 59, cat: '功效/性能宣传', level: '高', term: '100%抗菌', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 60, cat: '功效/性能宣传', level: '高', term: '杀菌100%', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 61, cat: '功效/性能宣传', level: '高', term: '永久耐磨', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 62, cat: '功效/性能宣传', level: '高', term: '永不卡顿', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 63, cat: '功效/性能宣传', level: '高', term: '永不掉色', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 64, cat: '功效/性能宣传', level: '高', term: '绝对安全', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 65, cat: '功效/性能宣传', level: '高', term: '绝对不会坏', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 66, cat: '价格/优惠宣传', level: '高', term: '全网最低价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 67, cat: '价格/优惠宣传', level: '高', term: '史低价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 68, cat: '价格/优惠宣传', level: '高', term: '最低价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 69, cat: '价格/优惠宣传', level: '高', term: '全网最低', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 70, cat: '价格/优惠宣传', level: '高', term: '全网最便宜', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 71, cat: '价格/优惠宣传', level: '高', term: '全年最低', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 72, cat: '价格/优惠宣传', level: '高', term: '全年最便宜', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 73, cat: '价格/优惠宣传', level: '高', term: '最低到手价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 74, cat: '价格/优惠宣传', level: '高', term: '跳楼价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 75, cat: '价格/优惠宣传', level: '高', term: '白菜价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 76, cat: '价格/优惠宣传', level: '高', term: '骨折价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 77, cat: '价格/优惠宣传', level: '高', term: '厂家亏本卖', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 78, cat: '价格/优惠宣传', level: '高', term: '赔钱卖', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 79, cat: '价格/优惠宣传', level: '高', term: '成本价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 80, cat: '价格/优惠宣传', level: '高', term: '出厂价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 81, cat: '价格/优惠宣传', level: '高', term: '进货价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 82, cat: '价格/优惠宣传', level: '高', term: '原价XX现在XX', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 83, cat: '价格/优惠宣传', level: '高', term: '最后一天最低价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 84, cat: '价格/优惠宣传', level: '高', term: '以后绝不再有这个价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 85, cat: '价格/优惠宣传', level: '高', term: '买贵包赔', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 86, cat: '价格/优惠宣传', level: '高', term: '永久保价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 87, cat: '价格/优惠宣传', level: '高', term: '全网比价最低', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 88, cat: '价格/优惠宣传', level: '高', term: '比官网便宜', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 89, cat: '价格/优惠宣传', level: '高', term: '专柜价XX', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 90, cat: '价格/优惠宣传', level: '高', term: '市场价XX', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 91, cat: '促销玩法/互动诱导', level: '高', term: '评论区扣1才发福利', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 92, cat: '促销玩法/互动诱导', level: '高', term: '点赞到XX才改价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 93, cat: '促销玩法/互动诱导', level: '高', term: '满XX赞才降价', action: 'MODULE_ZERO', mod: 8, point: '8.2' },
    { row: 94, cat: '服务/售后承诺', level: '高', term: '无理由终身退', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 95, cat: '服务/售后承诺', level: '高', term: '永久包退', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 96, cat: '服务/售后承诺', level: '高', term: '终身免费换新', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 97, cat: '服务/售后承诺', level: '高', term: '终身质保', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 98, cat: '服务/售后承诺', level: '高', term: '永久质保', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 99, cat: '服务/售后承诺', level: '高', term: '坏了随便换', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 100, cat: '服务/售后承诺', level: '高', term: '任何情况都能退', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 101, cat: '服务/售后承诺', level: '高', term: '随时退', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 102, cat: '服务/售后承诺', level: '高', term: '无条件退', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 103, cat: '服务/售后承诺', level: '高', term: '100%退款', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 104, cat: '服务/售后承诺', level: '高', term: '必赔', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 105, cat: '服务/售后承诺', level: '高', term: '一定赔', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 106, cat: '服务/售后承诺', level: '高', term: '运费全包', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 107, cat: '服务/售后承诺', level: '高', term: '到货不满意随便退', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 108, cat: '服务/售后承诺', level: '高', term: '全国任何地方都包邮', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 109, cat: '来源/资质/专利', level: '中高', term: '原厂', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 110, cat: '来源/资质/专利', level: '中高', term: '厂家直营', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 111, cat: '来源/资质/专利', level: '中高', term: '厂家直销', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 112, cat: '来源/资质/专利', level: '中高', term: '工厂直发', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 113, cat: '来源/资质/专利', level: '中高', term: '自家工厂', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 114, cat: '来源/资质/专利', level: '中高', term: '自家生产', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 115, cat: '来源/资质/专利', level: '中高', term: '进口原装', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 116, cat: '来源/资质/专利', level: '中高', term: '海外原装', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 117, cat: '来源/资质/专利', level: '中高', term: '原装进口', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 118, cat: '来源/资质/专利', level: '中高', term: '海关正品', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 119, cat: '来源/资质/专利', level: '中高', term: '专柜正品', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 120, cat: '来源/资质/专利', level: '中高', term: '官方正品', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 121, cat: '来源/资质/专利', level: '中高', term: '100%正品', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 122, cat: '来源/资质/专利', level: '中高', term: '专利产品', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 123, cat: '来源/资质/专利', level: '中高', term: '专利技术', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 124, cat: '来源/资质/专利', level: '中高', term: '独家专利', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 125, cat: '来源/资质/专利', level: '中高', term: '国际专利', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 126, cat: '来源/资质/专利', level: '中高', term: '获奖产品', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 127, cat: '来源/资质/专利', level: '中高', term: '行业大奖', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 128, cat: '来源/资质/专利', level: '中高', term: '设计大奖', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 129, cat: '比较/竞品宣传', level: '高', term: '吊打', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 130, cat: '比较/竞品宣传', level: '高', term: '秒杀同行', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 131, cat: '比较/竞品宣传', level: '高', term: '碾压同行', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 132, cat: '数据/排名/口碑', level: '中高', term: '销量第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 133, cat: '数据/排名/口碑', level: '中高', term: '销量冠军', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 134, cat: '数据/排名/口碑', level: '中高', term: '市占率第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 135, cat: '数据/排名/口碑', level: '中高', term: '回购率第一', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 136, cat: '数据/排名/口碑', level: '中高', term: '好评率100%', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 137, cat: '数据/排名/口碑', level: '中高', term: '全网爆款', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 138, cat: '数据/排名/口碑', level: '中高', term: '百万用户选择', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 139, cat: '数据/排名/口碑', level: '中高', term: '千万用户选择', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 140, cat: '数据/排名/口碑', level: '中高', term: '零差评', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 141, cat: '数据/排名/口碑', level: '中高', term: '0投诉', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 142, cat: '数据/排名/口碑', level: '中高', term: '全五星好评', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 143, cat: '数据/排名/口碑', level: '中高', term: '全网销量领先', action: 'SESSION_ZERO', mod: null, point: null },
    { row: 144, cat: '材质/检测/等级', level: '中高', term: '食品级', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 145, cat: '材质/检测/等级', level: '中高', term: '医用级', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 146, cat: '材质/检测/等级', level: '中高', term: '航空级', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 147, cat: '材质/检测/等级', level: '中高', term: '航天级', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 148, cat: '材质/检测/等级', level: '中高', term: '军工级', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 149, cat: '材质/检测/等级', level: '中高', term: '军用级', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 150, cat: '材质/检测/等级', level: '中高', term: '母婴级', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 151, cat: '材质/检测/等级', level: '中高', term: '婴儿级', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 152, cat: '材质/检测/等级', level: '中高', term: '零甲醛', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 153, cat: '材质/检测/等级', level: '中高', term: '无甲醛', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 154, cat: '材质/检测/等级', level: '中高', term: '零污染', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 155, cat: '材质/检测/等级', level: '中高', term: '无毒无害', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 156, cat: '材质/检测/等级', level: '中高', term: '绝对环保', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 157, cat: '材质/检测/等级', level: '中高', term: '环保无害', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 158, cat: '材质/检测/等级', level: '中高', term: '抗菌99.9%', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 159, cat: '材质/检测/等级', level: '中高', term: '抑菌99.9%', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 160, cat: '商品基础信息', level: '中高', term: '纯天然', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 161, cat: '商品基础信息', level: '中高', term: '纯手工', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 162, cat: '商品基础信息', level: '中高', term: '纯进口', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 163, cat: '商品基础信息', level: '中高', term: '100%真皮', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 164, cat: '商品基础信息', level: '中高', term: '100%羊绒', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 165, cat: '商品基础信息', level: '中高', term: '100%棉', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 166, cat: '商品基础信息', level: '中高', term: '全PC', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 167, cat: '商品基础信息', level: '中高', term: '德国材质', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 168, cat: '商品基础信息', level: '中高', term: '日本技术', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 169, cat: '商品基础信息', level: '中高', term: '意大利设计', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 170, cat: '商品基础信息', level: '中高', term: '法国设计', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
    { row: 171, cat: '商品基础信息', level: '中高', term: '原产地XX', action: 'MODULE_ZERO', mod: 1, point: '1.1' },
  ];

  // ---- 词根级条目的语境约束（v1.0.1，2026-09-17 业务侧拍板「A：加宣传语境必配」）----
  // 背景：用真实 4 小时逐字稿（7054 段 / 83915 字）实测，170+52 条里只有 9 条会命中，
  //       其中 7 条是 2 字"词根级"条目 —— 共 112 次命中，**真阳性 0**：
  //       第一 71 次（全是「第一个/第一点/第一天/第一波」）、完全 25 次（「完全分享」「完全一致」）、
  //       赠送 9 次（含「确实是没有这个赠送」否定式）、最好/绝对/首选/彻底 各 1~2 次（口语）。
  //       ⇒ 不加约束则**每一场真实直播都必然整场归 0**，整个 8 能力评分失去区分度。
  // 口径：命中点**紧邻**的 L/R 字窗口内出现下列短语才算违规（默认 L=6 / R=6，逐条可覆盖）。
  //       **条目一条不删**；同场 213/222 条零触发（含全部短语级硬红线）⇒ 只有会独立成词的短条目需要约束。
  //
  // v1.0.2（2026-09-17 业务侧二次拍板）—— 由"±30 字窗口"**收紧为紧邻窗口**：
  //   原话「行业第一，必须是 4 个字都说了才判断违规；如果只讲到'第一'、或是'行业'等，不归纳到违规中」。
  //   ±30 字的问题：同段一旦出现"行业第一"，其后 30 字内的「第一个/第一点」会被**连带判违规**（证据清单串味）。
  //   L=4 后 ⇒ "行业第一"必命中；"行业不景气，第一点要讲的"里那个「第一」**不再命中**。
  //   ⚠️ 本条不是"另立新词"：`全网/全球/世界/行业/全国/宇宙第一`（表内 R16-21）与
  //      `销量/市占率/回购率第一`（表内 R132/134/135）本就是**表里逐字列出的独立条目**，
  //      裸匹配即可命中；此处只是替 R10 那条孤立的裸「第一」补上"必须连写"的判据。
  //      前缀中 `中国` 系业务侧举例认可（"中国第一"），`品牌/排名/市占/回购/好评/口碑/权威/官方/
  //      类目/品质/人气/热销/复购` 为同类补充（表内无逐字条目）—— 如需增删，改这一行即可。
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

  // ---- 安全阀：只对有实测误伤证据、且属业务事实陈述的词加豁免 ----
  var EXEMPT = [
    { term: '最好', re: /卖得最好|卖得最多|卖最好|卖最多|明星自用最多|明星同款最多/,
      why: '业务方自己的满分示范话术就是「卖得最好，明星自用最多」（实测误伤 2 处）。v1.0.3 补 `卖最好|卖最多`：ASR 常少"得"字，59 份语料里 7 处「直播间卖最好／这边卖最好」因此漏豁免' },
    { term: '100%', re: /100%全新|100%新料|100%纯新/, why: '业务侧「100%全新四层德国拜耳PC」是材质新旧事实陈述（实测误伤 1 处）' },
    { term: '百分百', re: /百分百(的)?(全新|新料|纯新|进口|PC|pc)/,
      why: '与 `100%` 同指的另一种说法：v1.0.3 实测 24 处全是「百分百全新的PC材料／百分百PC箱／百分百纯PC」（程都兰门店接待等），属材质事实陈述。为与已豁免的 `100%` 保持一致而补' },
    { term: '全PC', re: /全PC|全pc/, why: 'ITO 箱体就是全 PC 材质，属产品事实描述；讲材质必然出现（无豁免=每场必中）' },
  ];

  // ---- 派生统计（供自检与报告显示）----
  var S2_SESSION = S2.filter(function(x){ return x.action === 'SESSION_ZERO'; });
  var S2_MODULE  = S2.filter(function(x){ return x.action === 'MODULE_ZERO'; });
  var S1_TERMS   = S1.reduce(function(a,x){ return a + x.terms.length; }, 0);
  var S2_TERMS   = S2.length;
  var S1_T1      = S1.filter(function(x){ return x.tier === 1; });
  var S1_T2      = S1.filter(function(x){ return x.tier === 2; });
  var S1_T1_TERMS = S1_T1.reduce(function(a,x){ return a + x.terms.length; }, 0);
  var S1_T2_TERMS = S1_T2.reduce(function(a,x){ return a + x.terms.length; }, 0);
  var MODULE_W   = { c1: 25, c2: 20, c3: 20, c4: 15, c5: 20, c6: 0, c7: 0, c8: 0 };  // 真源 v3/standard.js

  root.V4ViolationRules = {
    _v: _v,
    src: '抖音直播客观违规规则(0923更新).xlsx',
    rulesAt: '2026-09-23',
    S1: S1,
    S2: S2,
    EXEMPT: EXEMPT,
    GUARD: GUARD,
    GUARD_L: 6,                      // v1.0.2 紧邻窗口默认半径：命中点左侧 6 字（逐条可覆盖）
    GUARD_R: 6,                      // v1.0.2 紧邻窗口默认半径：命中点右侧 6 字（逐条可覆盖）
    MODULE_NAME: { c1: '产品理解能力', c2: '逻辑组织能力（流畅度）', c3: '场景化表达能力（延展性）',
                   c4: '可视化道具运用', c5: '情绪感染能力', c6: '需求识别能力（权重0）',
                   c7: '临场反应能力（权重0）', c8: '转化引导能力（权重0）' },
    MODULE_W: MODULE_W,
    DELETED_FROM_NEW_TABLE: DELETED_FROM_NEW_TABLE,
    stat: {
      s1Cats: S1.length,                 // v2.0.0 起 = 规则条数（同类目一级/二级各拆一条）
      s1Terms: S1_TERMS,
      s1Tier1: S1_T1.length, s1Tier2: S1_T2.length,
      s1Tier1Terms: S1_T1_TERMS, s1Tier2Terms: S1_T2_TERMS,
      s1SemanticOnly: S1.filter(function(x){ return x.semantic; }).length,
      s2Total: S2_TERMS,
      s2SessionZero: S2_SESSION.length,
      s2ModuleZero: S2_MODULE.length,
      matchers: S1_TERMS + S2_TERMS,
      guarded: GUARD.length,
      // 二级映射到权重为 0 的模块 ⇒ 归0 不改变总分（如实计入，供报告与横幅提示）
      tier2NoEffect: S1_T2.filter(function(x){ return x.mod && !MODULE_W['c' + x.mod]; })
                          .map(function(x){ return x.id + ':' + x.cat; })
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.V4ViolationRules;
})(typeof window !== 'undefined' ? window : globalThis);
