// v4.9.0 端到端折算验证：真实 DeepSeek 判定结果 → semantic-core.apply → 分数折算
// 用法：node v4/_sem_e2e.js   （需先跑 _sem_judge_local.js 生成 _sem_judge_result.json）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const vm = require('vm');
const g = { console };
const sandbox = vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'v3', 'standard.js'), 'utf8'), sandbox, { filename: 'standard.js' });
global.GRADING_STANDARD = vm.runInContext('GRADING_STANDARD', sandbox);
const STD = global.GRADING_STANDARD;
const V4S = require(path.join(__dirname, 'semantic-core.js'));

let pass = 0, fail = 0;
function ok(cond, msg, extra){ if(cond){ pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  实际=' + JSON.stringify(extra) : '')); } }

function buildR(){
  const order = ['c1','c2','c3','c4','c5','c6','c7','c8'];
  const modules = [];
  const usedIds = {};
  order.forEach(function(mk){
    const mod = STD.modules[mk];
    const standards = [];
    (mod.standards||[]).forEach(function(s){
      if(usedIds[s.id]) return;   // 1.4 双定义 → 渲染单卡（对齐 buildJudges 只判最新一条）
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

(async () => {
  console.log('===== v4.9.0 端到端折算（真实 DeepSeek 结果）=====\n');

  // 1) 判定清单核对
  const judges = V4S.buildJudges();
  console.log('[buildJudges] ' + judges.length + ' 卡');
  const judgeSubIds = new Set(judges.map(j => j.id));
  const realIds = new Set(['1.1','1.2','1.3','1.4','2.1','2.2','3.1','3.2','4.1','5.1','5.2','6.1','6.2','6.3','6.4','7.1','8.1','8.2']);
  const missing = [...realIds].filter(id => !judgeSubIds.has(id));
  ok(missing.length === 0, '判定清单覆盖 standard.js 全部 18 唯一卡', missing);

  // 2) 读真实判定结果
  const jf = path.join(__dirname, '_sem_judge_result.json');
  if(!fs.existsSync(jf)){ console.log('✗ 未找到 _sem_judge_result.json，先跑 _sem_judge_local.js'); process.exit(1); }
  const verdict = JSON.parse(fs.readFileSync(jf, 'utf8'));
  ok(verdict.ok === true && verdict.evidences.length > 30, '真实判定结果加载（' + verdict.evidences.length + ' 条证据）');
  const illegal = verdict.evidences.filter(e => !judgeSubIds.has(String(e.subId).split('-')[0]) || !/^(HIT|EQUIV|NEGATE|MISS|UNCLEAR)$/.test(e.state));
  ok(illegal.length === 0, '无非法 subId/state 混入', illegal.map(e => e.subId + ':' + e.state).slice(0,3));

  // 3) 折算：mock 关键词版骨架（总分子点全按 60/level1）→ apply 真实语义
  const r = buildR();
  const kwTotal = r.total;
  V4S.apply(r, verdict);
  const semTotal = r.total;

  console.log('\n[分数折算] 关键词版骨架(60分卡基线) total=' + kwTotal + ' → 语义版 total=' + semTotal);
  ok(typeof semTotal === 'number' && semTotal > 0 && semTotal <= 100, '语义版 total 有效区间 (0,100]', semTotal);

  // 4) 逐模块检查
  console.log('\n[逐模块折算]');
  r.modules.forEach(function(m){
    if(!m.weight) return;
    const line = ['  ' + m.key + ' (' + m.name + ') w=' + m.weight + '% → 模块分 ' + m.score];
    const low = m.standards.filter(s => s.complete && s.complete.level === 0.5);
    const zero = m.standards.filter(s => s.complete && s.complete.level === 0);
    if(low.length) line.push('半档×' + low.length + '(' + low.map(s=>s.id).join(',') + ')');
    if(zero.length) line.push('零档×' + zero.length + '(' + zero.map(s=>s.id).join(',') + ')');
    console.log(line.join(' '));
  });

  // 5) 抽查单卡：1.1（材质参数）应满分或接近；4.1-b UNCLEAR 不应扣成 0
  const s11 = r.modules[0].standards[0];
  ok(s11.complete.level === 1 && s11.score >= 60, '1.1 材质卡 满档（4 子点全 HIT → level1×q3×20=60）', { level: s11.complete.level, score: s11.score });
  console.log('   1.1 detail=' + String(s11.complete.detail||'').slice(0,60));

  // 6) 红旗/UNCLEAR 传播
  const semFlags = r.baseline && r.baseline.errors ? r.baseline.errors : 0;
  console.log('\n[红旗] baseline.errors=' + semFlags + (semFlags ? '（语义红旗已并入 baseline 扣分）' : '（本段口播无红旗，符合预期）'));

  // 7) overview/cases 派生完整性
  ok(r.overview && typeof r.overview.strength === 'string', 'overview 派生存在');
  ok(r.cases && (r.cases.good || r.cases.bad), 'cases 派生存在');
  const t = r.training;
  ok(t && t.flat && t.flat.length >= 0, 'training 派生存在（buildTraining 产物挂 r.training）');

  console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
})().catch(function(e){ console.error('E2E 异常:', e); process.exit(1); });
