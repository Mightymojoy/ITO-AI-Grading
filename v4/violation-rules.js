/* ============================================================
 * v4/violation-rules.js —— 直播平台红线规则库（v1.0.1）
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
 * ⚠️ 本文件不含政治敏感类具体词表（Sheet1 第6类）与拉踩/侮辱类（第7/8类）：
 *    表中原文本就没有字面词，硬编码会失真且误伤 ⇒ 这三类交语义通道判定。
 * ============================================================ */
(function(root){
  'use strict';
  var _v = '1.0.3';

  // ---- Sheet1：ITO 自有红线八类（全部 SESSION_ZERO）----
  var S1 = [
    { id: 's1-1', cat: '1 保价承诺', action: 'SESSION_ZERO', semantic: false, terms: ['全年不打折', '不降价', '全年保价', '价格统一', '全渠道统一'] },
    { id: 's1-2', cat: '2 物流时效', action: 'SESSION_ZERO', semantic: false, terms: ['今天拍今天发', '今天上午拍下午发货', '今天加急发出', '今天拍明天发', '全国都次日达', '今天拍明天一定到'] },
    { id: 's1-3', cat: '3 售后保障', action: 'SESSION_ZERO', semantic: false, terms: ['任何情况都能退', '拆了用了也能退', '什么情况都可以换新', '运费险可以包运费'] },
    { id: 's1-4', cat: '4 极限词', action: 'SESSION_ZERO', semantic: false, terms: ['行业第一', '中国第一', '全球领先第一品牌', '0噪音', '完全静音', '绝对静音', '全网最低', '全网最低价', '史低价', '全年最低', '100%抗菌', '永久抗菌', '杀菌99.9%', '100%防水', '完全防水', '泡水也没事', '所有航空公司都能登机', '一定能登机', '什么都能装', '无限容量', '同尺寸容量最大', '用十年都不会坏', '一辈子不用换', '坏了终身免费换', '永久免费换新', '国际大奖', '全球设计大奖', '获奖无数', 'RIMOWA平替', '某大牌同款', '同厂同线', '马上永久下架'] },
    { id: 's1-5', cat: '5 诱导互动', action: 'SESSION_ZERO', semantic: false, terms: ['点关注', '赠送', '评论区评论', '行李牌字母', '公屏'] },
    { id: 's1-6', cat: '6 政治敏感', action: 'SESSION_ZERO', semantic: true, terms: [] },
    { id: 's1-7', cat: '7 拉踩', action: 'SESSION_ZERO', semantic: true, terms: [] },
    { id: 's1-8', cat: '8 侮辱用户', action: 'SESSION_ZERO', semantic: true, terms: [] },
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
    { term: '公屏',  L: 16, R: 16,
      re: /(拍下|下单|购买|买到|加购|扣\d|打\d|刷\d|扣个|打个|送|赠|领|抽|抢|福袋|优惠券|优惠|福利|免单|名额).{0,14}公屏|公屏.{0,14}(拍下|下单|购买|扣\d|打\d|送|赠|领|抽|优惠券|优惠|福利|免单|名额)/,
      why: 'v1.0.3 修正判据：表原文第3条完整动作是「**拍下产品**把想要的行李牌字母**打在公屏上**」⇒ 违规点是"以下单/利益换取用户上公屏"的**诱导**结构，`公屏` 并非表内独立违规词。原判据（"打+公屏"即违规）属**过度提取**：59 份真实语料 25 处命中里，12 份场次仅因「想看什么打在公屏上」（无利益、无下单）被判整场归 0。现要求与"拍下/下单/利益/扣N"共现。' },

    // ---- v1.0.3（2026-09-17 业务侧三次拍板「B：诱导互动类也加语境必配」）----
    // Sheet1 第5类 B6 原文：「引导直播间点关注，赠送XXX；在评论区评论XXX，扣XXX评论，就可以XXX；
    //                        拍下产品把想要的行李牌字母打在公屏上 等**诱导评论点关注**的话术均属于违规话术」
    // ⇒ 违规点是「**诱导**」（以利益换取关注/评论），不在"点关注/评论"这些字样本身。
    // 依据：59 份真实直播逐字稿（8.13-9.15 / 105.7 万字）实测，`点关注` 3 次命中中
    //       「记得给我们点点关注」属正常引导、「点点关注去领一下」才是诱导。
    { term: '点关注', L: 16, R: 16,
      re: /(点关注|点点关注|关注一下|加关注|关注).{0,12}(送|赠|赠品|礼品|领|抽|抢|福袋|红包|优惠券|优惠|福利|礼物|免单|便宜|立减|折扣|名额|抽奖)|(送|赠|赠品|礼品|领|抽|抢|福袋|红包|优惠券|福利|礼物|免单).{0,12}(点关注|点点关注|关注一下|加关注)/,
      why: '表原文「引导直播间点关注，**赠送XXX**…等诱导评论点关注的话术」⇒ 须以利益诱导才算；单纯"记得点个关注"是正常引导（实测语料 2/3 属此类）' },
    { term: '评论区评论', L: 14, R: 20,
      re: /评论区评论.{0,18}(扣|打|发|刷|就可以|就能|即可|可以|领|送|赠|抽|抢|福袋|优惠|优惠券|福利|礼物|免单|名额|抽奖|赠品|得|拿|换)|(扣|打|刷)\d.{0,10}评论区|评论区.{0,10}(扣\d|打\d|扣个|打个)/,
      why: '表原文「在评论区评论XXX，**扣XXX评论，就可以XXX**」⇒ 须有"评论换利益"的交换结构才算（本法在 59 份语料中零出现，判据纯依表原文）' },
    { term: '行李牌字母', L: 18, R: 18,
      re: /(打|发|扣|留|写|报|输入|敲|晒|备注).{0,12}(公屏|评论区|屏幕|弹幕)|(公屏|评论区|屏幕|弹幕).{0,12}行李牌字母|(拍下|下单|买到|购买|下单后).{0,16}行李牌字母|行李牌字母.{0,16}(打|发|扣|留|写|报)/,
      why: '表原文「拍下产品把想要的行李牌字母**打在公屏上**」⇒ 须是"要求用户把字母发到公屏"这个动作；单纯介绍产品带行李牌不判（本法在 59 份语料中零出现）' },
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

  root.V4ViolationRules = {
    _v: _v,
    src: '抖音直播客观违规规则.xlsx',
    rulesAt: '2026-09-17',
    S1: S1,
    S2: S2,
    EXEMPT: EXEMPT,
    GUARD: GUARD,
    GUARD_L: 6,                      // v1.0.2 紧邻窗口默认半径：命中点左侧 6 字（逐条可覆盖）
    GUARD_R: 6,                      // v1.0.2 紧邻窗口默认半径：命中点右侧 6 字（逐条可覆盖）
    MODULE_NAME: { c1: '产品理解能力', c8: '转化引导能力' },
    stat: {
      s1Cats: S1.length,
      s1Terms: S1_TERMS,
      s2Total: S2_TERMS,
      s2SessionZero: S2_SESSION.length,
      s2ModuleZero: S2_MODULE.length,
      matchers: S1_TERMS + S2_TERMS,
      guarded: GUARD.length
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.V4ViolationRules;
})(typeof window !== 'undefined' ? window : globalThis);
