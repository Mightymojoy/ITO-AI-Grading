// =====================================================
// v4 离线验证脚本（不联网、不写飞书、不改根目录任何文件）
// ① 静态检查：app-core.js 引用的 $('id') 在 v4/index.html 全部存在
// ② 沙箱加载真实评分引擎（standard.js + outfit.js + app-core.js），
//    跑样例评分 + 全部渲染函数，断言零异常、分值结构完整
// 用法: node v4/verify_v4.js  （在仓库根目录执行）
// =====================================================
const fs = require('fs'), vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// ---------- ① 静态 DOM ID 检查 ----------
const coreSrc = fs.readFileSync(path.join(__dirname, 'app-core.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const idsUsed = new Set();
for(const m of coreSrc.matchAll(/\$\('([^']+)'\)/g)) idsUsed.add(m[1]);
// 核心内部动态创建/可选守卫的 ID
const dynamicOk = new Set(['extraTag', 'productMeta']);
const missing = [...idsUsed].filter(id => !dynamicOk.has(id) && !htmlSrc.includes(`id="${id}"`));
console.log('===== ① 静态 DOM ID 检查 =====');
console.log('核心引用 ID 数: ' + idsUsed.size + ' ｜ v4 页面缺失: ' + (missing.length ? missing.join(', ') + ' ❌' : '0 个 ✅'));
if(missing.length) process.exitCode = 1;

// ---------- ② 沙箱跑真实引擎 ----------
function mkEl(){
  return { value:'', style:{}, innerHTML:'', textContent:'', className:'', files:[],
    appendChild(){}, scrollIntoView(){}, classList:{add(){},remove(){}} };
}
const cache = {};
const sandbox = {
  console, setTimeout, clearTimeout,
  FileReader: function(){}, File: function(){}, Blob: function(){}, DataTransfer: function(){},
  localStorage: { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  fetch: async () => { throw new Error('offline-mode'); },   // 离线：飞书写回全部走 catch，不阻塞
  location: { protocol:'https:', hostname:'mightymojoy.github.io' },
  document: {
    getElementById(id){ if(!cache[id]) cache[id] = mkEl(); return cache[id]; },
    querySelectorAll(){ return []; },
    createElement(){ return mkEl(); },
    addEventListener(){}
  }
};
sandbox.window = sandbox;
const code = fs.readFileSync(path.join(ROOT,'v3','standard.js'),'utf8') + '\n' +
             fs.readFileSync(path.join(ROOT,'v3','outfit.js'),'utf8') + '\n' + coreSrc;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const SAMPLE = [
  '00:00:00 开场：很多明星博主达人都在用，非常好看，也非常好用能装。',
  '00:00:12 经常出差，要快速拿取电脑，这个箱子非常适合你。',
  '00:00:21 不需要把整个箱子都打开，站立状态之下直接快速拿取。',
  '00:02:20 四层全新的一个PC材质，抗压性抗冲击性都要更好。',
  '00:02:47 德国进口科思创PC，坚韧耐用。',
  '00:03:34 360度静音的万向轮，越负重越好推，赶高铁的时候不会拖后腿。',
  '00:04:50 7A级抗菌和防渗水，99%的抗菌率。',
  '00:05:43 你看这个就弹出来了，给大家看一下前开盖。',
  '00:06:00 快速取物，同时也是能够保护隐私。',
  '00:06:49 三个隔层收纳起来之后像一个大通仓。',
  '00:08:24 四层PC、7A级抗菌、静音万向轮、快速取物保护隐私、360天换新五年维修。',
  '00:08:41 售后360天无忧，五年免费质保，所以您放心用。',
  '00:09:11 高频差旅看20寸，家庭出行直接看29寸，确认好尺寸直接拍二号链接。',
  '00:09:28 20寸适合3到5天的短途出行。',
  '00:09:58 如果大家对尺寸容量不清楚，可以把出行计划打在公屏上。',
  '00:10:17 有大买大，大家扣1我来帮你们选。'
].join('\n');

(async () => {
  console.log('\n===== ② 沙箱真实引擎跑样例 =====');
  const r = vm.runInContext(`
    (function(){
      var __t = ${JSON.stringify(SAMPLE)};
      var __segs = parseTranscript(__t);
      var __fk = detectProductFromName("样例_陈思颖_8.18.txt", __t);
      var __r = runGrading(__segs, __fk || "auto");
      if(__r.noProduct) throw new Error("样例未识别到产品");
      __r.host = "陈思颖"; __r.studio = "云端商务家"; __r.date = "2026-08-28";
      __r.product = GRADING_STANDARD.sellpoints[__fk || __r.autoMatch.fromKey].name;
      __r.segCount = __segs.length;
      return __r;
    })()
  `, sandbox);
  const ok = (cond, name) => { console.log((cond ? '✅ ' : '❌ ') + name); if(!cond) process.exitCode = 1; };
  ok(typeof r.total === 'number' && r.total >= 0 && r.total <= 100, 'runGrading 出分: ' + r.total + ' 分 ' + r.grade + ' 级（' + r.product + '）');
  ok(r.modules && r.modules.length === 8, '能力矩阵 8 项齐全');
  ok(r.sellpoints && r.sellpoints.items.length === 7, '7 大核心卖点覆盖表: ' + r.sellpoints.covered + '/' + r.sellpoints.total);
  ok(r.golden && typeof r.golden.total === 'number', '金句提炼: ' + r.golden.total + ' 句');
  ok(r.baseline && typeof r.baseline.errors === 'number', '基准库对照: ' + r.baseline.errors + ' 处错误');
  ok(r.training && Array.isArray(r.training), '改善闭环: ' + r.training.length + ' 条');

  // 渲染函数全量调用（DOM 全 mock，抛错即失败）
  try{
    vm.runInContext('renderResult(__rr)', Object.assign(sandbox, {__rr: r}));
    ok(true, 'renderResult（单主播报告 13 子模块渲染）');
  }catch(e){ ok(false, 'renderResult 异常: ' + e.message); }

  // 批量 TOP1（构造 2 人）
  const r2 = JSON.parse(JSON.stringify(r));
  r2.host = '任佳瑛'; r2.total = Math.max(0, r.total - 7);
  try{
    vm.runInContext('renderBatchCompare(__bb)', Object.assign(sandbox, {__bb: [r, r2]}));
    const t1 = vm.runInContext('pickTop1(__bb2)', Object.assign(sandbox, {__bb2: [r, r2]}));
    ok(t1 && t1.host === r.host, '批量 TOP1 评选: TOP1 = ' + (t1 && t1.host));
  }catch(e){ ok(false, 'renderBatchCompare/pickTop1 异常: ' + e.message); }

  // 库函数
  try{
    vm.runInContext('addHistoryRecord(__hh); renderHistoryLib();', Object.assign(sandbox, {__hh: r}));
    const hn = vm.runInContext('getHistoryLib().length', sandbox);
    ok(hn >= 1, '历史评分库写入+渲染: ' + hn + ' 条');
  }catch(e){ ok(false, '历史库异常: ' + e.message); }
  try{
    const np = vm.runInContext('collectProblems(__pp) || 0; renderProblemLib(); renderProblemDetail(); getProblemLib().length;', Object.assign(sandbox, {__pp: r}));
    ok(true, '问题库沉淀+渲染: ' + np + ' 条');
  }catch(e){ ok(false, '问题库异常: ' + e.message); }
  try{
    const ng = vm.runInContext('addGoldenToLib("陈思颖","云端商务家","2026-08-28","PISTACHIO Plus",__gg); renderGoldenLib(); getGoldenLib().items.length;', Object.assign(sandbox, {__gg: r.golden}));
    ok(true, '话术库入库+渲染: ' + ng + ' 条');
  }catch(e){ ok(false, '话术库异常: ' + e.message); }

  // 服化道
  try{
    const of_ = vm.runInContext('judgeOutfit("黑色低饱和通勤西装，妆发完整，低马尾，皮鞋","曲姝锜")', sandbox);
    ok(of_.total > 0 && of_.total <= 25, '服化道判定: ' + of_.total + '/25' + (of_.gradeLimit ? '（触发B级上限）' : ''));
  }catch(e){ ok(false, '服化道异常: ' + e.message); }

  console.log('\n===== v4 离线验证完成 =====');
  console.log('引擎版本: ' + vm.runInContext('GRADING_STANDARD.version', sandbox) + ' ｜ 工作台: v4.5');
})();
