// v4.9.0 语义判定本地联调（B 路径：本地起函数实测，验证后再走 Vercel 部署）
// 用法：node v4/_sem_judge_local.js [payload 文件]   （DEEPSEEK_API_KEY 从环境变量读取）
// 不带 payload 文件 → 用内置示例（真实 standard.js 判定清单 + 短转写样例）
const fs = require('fs');
const path = require('path');

(async () => {
  // 1) 构造 payload：真实判定清单（semantic-core.buildJudges）+ 转写文本
  const ROOT = path.join(__dirname, '..');
  const vm = require('vm');
  const g = { console };
  const sandbox = vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'v3', 'standard.js'), 'utf8'), sandbox, { filename: 'standard.js' });
  global.GRADING_STANDARD = vm.runInContext('GRADING_STANDARD', sandbox);
  const V4S = require(path.join(__dirname, 'semantic-core.js'));

  let payload;
  const argv = process.argv[2];
  if (argv && fs.existsSync(argv)) {
    payload = JSON.parse(fs.readFileSync(argv, 'utf8'));
  } else {
    // 内置示例：loadSample 风格转写（覆盖：参数/材质/售后/场景/CTA/冗余话术 + 一处错误表述）
    const segs = [
      { ts: '00:00:12', text: '经常出差，要快速拿取电脑，这个箱子非常适合你。' },
      { ts: '00:01:04', text: '不需要把整个箱子都打开，站立状态之下直接快速拿取，保护隐私。' },
      { ts: '00:02:20', text: '四层全新的一个PC材质，抗压性抗冲击性都要更好，这个箱子是纯铝的特别轻。' },
      { ts: '00:02:47', text: '德国进口科思创PC，坚韧耐用，比普通箱子轻很多。' },
      { ts: '00:03:34', text: '360度静音的万向轮，越负重越好推，赶高铁的时候不会拖后腿。' },
      { ts: '00:04:50', text: '7A级抗菌和防渗水，99%的抗菌率，贴身衣物放心放。' },
      { ts: '00:05:43', text: '你看这个就弹出来了，给大家看一下前开盖。' },
      { ts: '00:06:49', text: '三个隔层收纳起来之后像一个大通仓。' },
      { ts: '00:08:24', text: '四层PC、7A级抗菌、静音万向轮、快速取物保护隐私、360天换新五年维修。' },
      { ts: '00:09:02', text: '你一年两年才用一次的，我都不建议你买它。' },
      { ts: '00:09:11', text: '高频差旅看20寸，家庭出行直接看29寸，确认好尺寸直接拍二号链接。' }
    ];
    payload = {
      product: 'PISTACHIO 2（自动匹配）',
      judges: V4S.buildJudges(),
      text: V4S.truncate(segs),
      _v: '4.9.0'
    };
    console.log('[payload] judges=' + payload.judges.length + ' 卡 / text=' + payload.text.length + ' 字（内置示例）');
  }

  // 2) 调 handler（fake req/res，单次调用）
  const handler = require(path.join(ROOT, 'api', 'semantic-judge.js'));
  const res = { code: null, setHeader(){}, status(c){ this.code = c; return this; }, json(o){ this.body = o; } };
  const started = Date.now();
  await handler({ method: 'POST', body: JSON.stringify(payload) }, res);
  const ms = Date.now() - started;
  const out = res.body || {};
  if (out.ok) {
    const byState = {};
    out.evidences.forEach(function(e){ byState[e.state] = (byState[e.state] || 0) + 1; });
    console.log('✓ 云端判定真实返回（' + ms + 'ms）：' + out.evidences.length + ' 条证据');
    console.log('  分布: ' + JSON.stringify(byState));
    console.log('  meta: ' + JSON.stringify(out.meta || {}));
    const samples = out.evidences.slice(0, 5).map(function(e){ return e.subId + '=' + e.state; }).join(' ');
    console.log('  前 5 条: ' + samples);
    fs.writeFileSync(path.join(__dirname, '_sem_judge_result.json'), JSON.stringify(out, null, 2));
    console.log('  完整结果已存 v4/_sem_judge_result.json');
  } else {
    console.log('✗ 判定未通过: ' + (out.error || JSON.stringify(out)));
    if (String(out.error || '').indexOf('DEEPSEEK_API_KEY') >= 0) {
      console.log('\n[需要 Key] 本地联调请设置环境变量后重跑，例如：');
      console.log('  export DEEPSEEK_API_KEY=sk-xxxx （Git Bash）');
      console.log('  $env:DEEPSEEK_API_KEY="sk-xxxx"（PowerShell）');
    }
    process.exitCode = 1;
  }
})().catch(function(e){ console.error('本地联调异常:', e); process.exitCode = 1; });
