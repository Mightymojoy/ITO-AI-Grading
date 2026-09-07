// v4.9.0 semantic-core 单测（node）：真实 standard.js + 构造同构 r + mock 证据包
// 运行：node v4/_sem_core_test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let PASS = 0, FAIL = 0;
function ok(cond, name, extra){
  if(cond){ PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? ' ｜ 实际: ' + JSON.stringify(extra) : '')); }
}

// ---- 0. 加载真实 GRADING_STANDARD（standard.js 为 var 全局赋值，vm 到沙箱 global）----
const g = { console };
const sandbox = vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'v3', 'standard.js'), 'utf8'), sandbox, { filename: 'standard.js' });
const STD = vm.runInContext('GRADING_STANDARD', sandbox);   // standard.js 用 const → 在沙箱内求值取回
global.GRADING_STANDARD = STD;                                // semantic-core factory 捕获全局
ok(!!STD && !!STD.modules, 'standard.js 加载');

// ---- 1. 加载 semantic-core ----
const V4S = require(path.join(__dirname, 'semantic-core.js'));
ok(!!V4S && V4S._v === '4.9.2', 'semantic-core 加载 v' + (V4S && V4S._v));

// ---- 2. buildJudges：从真实 standard 生成判定清单 ----
const judges = V4S.buildJudges();
const judgePointTotal = judges.reduce(function(a,j){ return a + j.points.length; }, 0);
console.log('[buildJudges] 判定卡 ' + judges.length + ' 张 / 考核子点 ' + judgePointTotal + ' 个（46 子点理论值）');
ok(judges.length >= 18 && judges.length <= 20, '判定卡 18~20 张（18 唯一 id + 1.4 重复）', judges.length);
ok(judgePointTotal === 52, '考核子点 52 个（46 唯一 + 1.4 重复 3 + 2.2 负证 3）', judgePointTotal);
const ids = {};
judges.forEach(function(j){ ids[j.id] = (ids[j.id]||0)+1; });
ok(!judges.some(function(j){ return !j.points || !j.points.length; }), '每条判定卡都有子点');
const d14 = ids['1.4'] || 0;
console.log('  [已知待拍板] 1.4 在 standard.js 中重复定义 → 判定清单出现 ' + d14 + ' 次');
const expectIds = ['1.1','1.2','1.3','1.4','2.1','2.2','3.1','3.2','4.1','5.1','5.2','6.1','6.2','6.3','6.4','7.1','8.1','8.2'];
ok(expectIds.every(function(x){ return ids[x] >= 1; }), '18 个唯一子标准 id 全部覆盖');

// ---- 3. 构造与 runGrading 同构的关键词版 r ----
// 按 standard modules 生成：每卡 level=1 quality=3 → score 60；模块分取均值
function buildR(){
  const order = ['c1','c2','c3','c4','c5','c6','c7','c8'];
  const modules = [];
  const usedIds = {};
  order.forEach(function(mk){
    const mod = STD.modules[mk];
    const standards = [];
    (mod.standards||[]).forEach(function(s){
      if(usedIds[s.id]) return;                 // 1.4 重复定义 → 只建一张卡（对齐现行单卡结构）
      usedIds[s.id] = true;
      standards.push({
        id: s.id, name: s.name, desc: s.desc || '',
        complete: { level: 1, detail: '关键词引擎（mock）', hits: [], misses: [] },
        quality: { score: 3, applied: [] },
        score: 60
      });
    });
    const ms = standards.length ? Math.round(standards.reduce(function(a,b){return a+b.score;},0)/standards.length) : 0;
    modules.push({ key: mk, name: mod.name, weight: mod.weight, analyze: !!mod.analyze, score: ms, standards: standards });
  });
  let total = 0;
  modules.forEach(function(m){ if(m.weight>0) total += m.score*m.weight/100; });
  total = Math.round(total*10)/10;
  return {
    total: total, grade: 'C',
    modules: modules,
    baseline: { errors: 0, items: [] },
    overview: { strength:'mock', problem:'mock', tagline:'mock' }
  };
}

// ---- 4. apply：1.1 全 HIT → 满档 60 分保真 ----
let r = buildR();
let v = { evidences: [
  { subId:'1.1-a', state:'HIT',  confidence:0.9, quoteTs:'00:01', quote:'20寸 4.2kg' },
  { subId:'1.1-b', state:'HIT',  confidence:0.9, quoteTs:'00:02', quote:'德国科思创 PC 材质' },
  { subId:'1.1-c', state:'EQUIV',confidence:0.8, quoteTs:'00:03', quote:'轮子静音顺滑' },
  { subId:'1.1-d', state:'HIT',  confidence:0.9, quoteTs:'00:04', quote:'360天换新五年维修' }
]};
let a1 = V4S.apply(r, v);
let s11 = r.modules[0].standards[0];
ok(s11.complete.level === 1, '1.1 全过 → level 1', s11.complete.level);
ok(s11.score === 60, '1.1 level1×q3×20 = 60 分', s11.score);
ok(s11.complete.detail.indexOf('语义判定') === 0, 'detail 标注语义判定', s11.complete.detail);
ok(s11.complete.hits.length === 3 && s11.complete.hits[0].kw && s11.complete.hits[0].ctx, 'hits 复用具名结构（kw/ts/ctx）');
ok(s11.complete.misses.length === 0, '全过 → misses 空');

// ---- 5. 半档/零档封顶 ----
r = buildR();
v = { evidences: [
  { subId:'1.2-a', state:'HIT', confidence:0.9, quoteTs:'', quote:'给经常出差的商务人群' }  // 3 子点过 1 → <half2 → level0
]};
V4S.apply(r, v);
let s12 = r.modules[0].standards[1]; // 1.2
ok(s12.complete.level === 0, '1.2 过1/3 → level 0', s12.complete.level);
ok(s12.quality.score === 1, 'level 0 → quality 封顶 1', s12.quality.score);
ok(s12.score === 0, 'level0 得分 0', s12.score);
ok(s12.complete.misses.length === 2, 'misses 列出 2 个未达标子点', s12.complete.misses);

r = buildR();
v = { evidences: [
  { subId:'3.1-a', state:'EQUIV', confidence:0.8, quoteTs:'', quote:'赶高铁' },
  { subId:'3.1-b', state:'HIT', confidence:0.9, quoteTs:'', quote:'静音轮赶高铁不拖后腿' }
]};
V4S.apply(r, v);
let s31 = r.modules[2].standards[0]; // 3.1（c3 第一张）
ok(s31.complete.level === 0.5, '3.1 过2/3 → 半档 0.5', s31.complete.level);
ok(s31.quality.score === 3, 'level 0.5 → quality 封顶 3（原 mock 3 不变）', s31.quality.score);
ok(s31.score === 30, '0.5×3×20 = 30 分', s31.score);

// ---- 6. 2.2 质量主导卡：负证驱动 ----
r = buildR();
v = { evidences: [
  { subId:'2.2-a', state:'HIT', confidence:0.9, quoteTs:'', quote:'然后然后然后这个这个' },
  { subId:'2.2-b', state:'HIT', confidence:0.9, quoteTs:'', quote:'首先我们看材质，接下来看轮子' },
  { subId:'2.2-c', state:'HIT', confidence:0.9, quoteTs:'', quote:'（段落停顿后）再说容量' }
]};
V4S.apply(r, v);
let s22 = null;
r.modules.forEach(function(m){ m.standards.forEach(function(s){ if(s.id === '2.2') s22 = s; }); });
ok(s22.complete.level === 1, '2.2 level 恒 1', s22.complete.level);
ok(s22.quality.score === 4, '2.2 质量 = 3基础+节奏+停顿−冗余1 = 4', s22.quality.score);
ok(s22.score === 80, '2.2 score = 1×4×20 = 80', s22.score);
// 冗余两处负证 → 质量 3
r = buildR();
v = { evidences: [
  { subId:'2.2-a', state:'HIT', confidence:0.9, quoteTs:'', quote:'这个这个' },
  { subId:'2.2-a', state:'HIT', confidence:0.9, quoteTs:'', quote:'然后然后' },
  { subId:'2.2-b', state:'HIT', confidence:0.9, quoteTs:'', quote:'首先' }
]};
V4S.apply(r, v);
r.modules.forEach(function(m){ m.standards.forEach(function(s){ if(s.id === '2.2') s22 = s; }); });
ok(s22.quality.score === 2, '2.2 冗余2处 → 质量 = 3+0+1−2 = 2', s22.quality.score);

// ---- 7. UNCLEAR 不计 + 非法 subId 忽略 ----
r = buildR();
v = { evidences: [
  { subId:'5.1-a', state:'UNCLEAR', confidence:0.5, quoteTs:'', quote:'存疑' },
  { subId:'9.9-x', state:'HIT', confidence:0.9, quoteTs:'', quote:'非法id' },
  { subId:'5.1-c', state:'HIT', confidence:0.9, quoteTs:'', quote:'放心' }
]};
let a7 = V4S.apply(r, v);
let s51 = r.modules[4].standards[0];
ok(s51.complete.level === 0, '5.1 UNCLEAR 不计 → 过1/3 → level 0', s51.complete.level);
ok(a7.applied === 1, '非法 subId(9.9-x) 不参与（applied 只计 5.1）', a7.applied);

// ---- 8. 语义红旗（NEGATE + flag_error）并入 baseline：-4/处 封顶 -12 ----
r = buildR();
v = { evidences: [
  { subId:'1.1-b', state:'NEGATE', confidence:0.95, quoteTs:'00:30', quote:'这个箱子是纯铝的', reason:'flag_error:材质说错（实际 PC）' },
  { subId:'1.1-c', state:'NEGATE', confidence:0.95, quoteTs:'00:40', quote:'轮子不能拆卸', reason:'flag_error:轮子描述与标准不符' }
]};
let a8 = V4S.apply(r, v);
ok(r.baseline.errors === 2, '红旗 2 处 → baseline.errors = 2', r.baseline.errors);
ok((r.baseline.items||[]).length === 2 && (r.baseline.errorItems||[]).length === 2, 'items/errorItems 同步 2 条');
ok(r.baseline.items[0].field.indexOf('sem:1.1-') === 0, '红旗 field 带 sem: 前缀', r.baseline.items[0].field);
// 对比：无红旗 baseline 总分 vs 有红旗总分（c1-c5 全 60 mock：60*0.25+60*0.2+60*0.2+60*0.15+60*0.2=60）
let tBase = buildR(); tBase.total = 60;
let vNo = { evidences: [] };
V4S.apply(tBase, vNo);
ok(tBase.total === 60, '无红旗 → 总分 60 不变', tBase.total);
let t8 = buildR(); t8.total = 60;
V4S.apply(t8, v);
// 语义后卡分：1.1 有 2 处 NEGATE → passed 0 → level 0 → 卡 0 分 → c1=(0+60+60+60)/4=45 → 11.25
// 总分 = 11.25+12+12+9+12 = 56.25 − 8(2 红旗) = 48.25 → round 48.3
ok(t8.baseline.errors === 2, '红旗 2 处 → baseline.errors = 2', t8.baseline.errors);
ok(t8.total === 48.3, '2 处红旗 → 56.25 − 8 = 48.3', t8.total);
// 封顶 12（5 处红旗跨卡：1.1 全 4 子点 + 1.2-a）
r = buildR(); r.total = 60;
let many = [];
[['1.1','a'],['1.1','b'],['1.1','c'],['1.1','d'],['1.2','a']].forEach(function(p){
  many.push({ subId: p[0]+'-'+p[1], state:'NEGATE', confidence:0.9, quoteTs:'', quote:'x', reason:'flag_error:错误' });
});
V4S.apply(r, { evidences: many });
// 语义后卡分：1.1 全 NEGATE → 0 分；1.2 无通过 → 0 分；c1=(0+0+60+60)/4=30 → 7.5；总分前=7.5+12+12+9+12=52.5；−12(封顶) → 40.5
ok(r.baseline.errors === 5, '5 处红旗 → baseline.errors = 5', r.baseline.errors);
ok(r.total === 40.5, '5 处红旗 → 52.5 − 12(封顶) = 40.5', r.total);

// ---- 9. recompute：总分/等级/概览/训练/案例 派生 ----
r = buildR(); r.total = 60;
V4S.apply(r, v8 = { evidences: [
  { subId:'1.1-a', state:'HIT', confidence:0.9, quoteTs:'00:01', quote:'20寸4.2kg超轻' },
  { subId:'1.1-b', state:'HIT', confidence:0.9, quoteTs:'00:02', quote:'科思创PC' },
  { subId:'1.1-c', state:'HIT', confidence:0.9, quoteTs:'00:03', quote:'静音万向轮' },
  { subId:'1.1-d', state:'HIT', confidence:0.9, quoteTs:'00:04', quote:'五年质保' }
]});
ok(typeof r.total === 'number' && r.grade, 'recompute 输出 total/grade', r.total + '/' + r.grade);
ok(r.overview && r.overview.tagline && r.overview.best, 'overview 派生完整');
ok(Array.isArray(r.training) && Array.isArray(r.cases.good), 'training/cases 派生');
// 单卡满分 100（q5 level1）应进优秀案例 good
r = buildR();
// 把 1.1 质量提到 5 且全过 → score 100（真实链路 quality 来自 evalQuality 关键词因子，此处直接设卡分等价）
V4S.apply(r, { evidences: [
  { subId:'1.1-a', state:'HIT', confidence:0.95, quoteTs:'00:01', quote:'20寸只有4.2公斤，比两瓶水还轻' },
  { subId:'1.1-b', state:'HIT', confidence:0.95, quoteTs:'00:02', quote:'德国科思创PC四层结构，抗冲击强' },
  { subId:'1.1-c', state:'HIT', confidence:0.95, quoteTs:'00:03', quote:'静音万向轮，越重越好推' },
  { subId:'1.1-d', state:'HIT', confidence:0.95, quoteTs:'00:04', quote:'360天换新，五年免费维修' }
]});
let s1c = r.modules[0].standards[0];
s1c.quality.score = 5;
s1c.score = Math.round(s1c.complete.level * s1c.quality.score * 20);   // 1×5×20 = 100
V4S.recompute(r);
let gCase = r.cases.good.some(function(c){ return c.std.indexOf('1.1') === 0 && c.full; });
ok(gCase, '100 分卡进优秀案例 good（含 full 标记）', JSON.stringify(r.cases.good));

// ---- 10. truncate 超长截断 ----
let longSegs = [];
for(let i=0;i<4000;i++) longSegs.push({ text: '这是一个用于测试截断的超长转写内容段落，用于验证语义请求不会超过模型窗口。' });
let tOut = V4S.truncate(longSegs);
ok(tOut.length <= V4S.CFG.maxChars + 1000, 'truncate 输出 ≤ maxChars+换行+提示（join \\n 计入）', tOut.length);
ok(tOut.indexOf('已截断') >= 0, '截断含提示标记');
let shortOut = V4S.truncate([{ ts:'00:01', text:'正常短文本' }]);
ok(shortOut === '[00:01] 正常短文本', '短文本原样带时间戳');

// ---- 11. levelFromEvs 直接单测 ----
let lf = V4S.levelFromEvs(V4S.POINTS['1.1'], [
  { subId:'1.1-a', state:'HIT' }, { subId:'1.1-b', state:'HIT' }, { subId:'1.1-c', state:'HIT' }
]);
ok(lf.level === 0.5 && lf.passed === 3 && lf.total === 4, 'levelFromEvs 3/4 → 半档', JSON.stringify(lf));
lf = V4S.levelFromEvs(V4S.POINTS['1.1'], [
  { subId:'1.1-a', state:'HIT' }, { subId:'1.1-b', state:'HIT' }, { subId:'1.1-c', state:'HIT' }, { subId:'1.1-d', state:'EQUIV' }
]);
ok(lf.level === 1, 'levelFromEvs 4/4 → 满档');

console.log('\n========== 结果：' + PASS + ' 通过 / ' + FAIL + ' 失败 ==========');
process.exit(FAIL ? 1 : 0);
