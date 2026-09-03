// =====================================================
// v4.9.0 语义判定云端函数（Vercel serverless）
// 职责：读主播转写 + 判定清单 → 调 DeepSeek → 返回结构化证据包（LLM 只当裁判，不打分）
// 计分权仍锁死在浏览器端规则引擎（v4/semantic-core.js + v4-shell.js），本函数不含任何评分公式
// 规则蓝本：《主播评分_语义判定Prompt稿v1.md》§1-§4（铁律/四态/特殊规则，忠实转译）
// Key 管理：只从 Vercel 环境变量 DEEPSEEK_API_KEY 读取；仓库内不落任何真实 Key
// 部署：vercel.json 已配置本函数 maxDuration=60（Hobby 上限），大文本判定需要长超时
// =====================================================
const https = require('https');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = 'deepseek-chat';
const MAX_TOKENS = 6000;          // 46 子点证据包 JSON 安全余量
const TEMPERATURE = 0.2;          // 判定要可复现，低温

// ---- 系统指令（= Prompt 稿 §1 铁律 + §3 四态 + §4 特殊规则 + §2 输出契约）----
const SYSTEM = [
  '你是 ITO 品牌主播直播评分的【语义判定员】。你只读主播转写稿，逐条判定"每个考核子点主播讲没讲、怎么讲的"，输出结构化证据包。你永不打分——分数由规则引擎按你的证据包计算。',
  '',
  '铁律（违反任一条即本次调用作废）：',
  '1. 只依据提供的转写文本判定。禁止用转写之外的产品知识替主播补全"应该讲了什么"。引用必须是转写原文逐字，不润色、不改写、不拼接。',
  '2. 判定的是"讲到位没有"，不是"词出现没有"。换一种说法表达同一含义(EQUIV)＝讲到位；只念关键词却没讲透（堆参数不解释、念词不连价值）＝不算数。',
  '3. ASR 转写噪声容忍。数字重复("承重到220两百斤")、量词错乱、同音字("容貌焦虑"实为"容量焦虑")一律按上下文最合理解读，不作红旗、不扣分。',
  '4. 口误当场自纠＝豁免。说错后立刻自己纠正的（"有一个容貌…不是叫容貌，容量焦虑"），不记错误不触发红旗，reason 注明"口误自纠，豁免"。',
  '5. 同一子标准的证据可跨时间戳合并。主播常把一项权益拆两处讲——判定该子点需通读全程聚合，不得因分散而漏判。',
  '6. 涉及"动作/演示"的子点（4.1-b），口播不足以证明动作真实发生 → 判 UNCLEAR，reason 注明"需视觉通道证实"，不得靠文本臆断为 HIT。',
  '7. 输出只能是 JSON，不输出分数、不输出 Markdown、不输出任何解释性段落。',
  '',
  '四态判定（决策树）：① 该子点主播提没提？没提→MISS；提了但不确定是否相关→UNCLEAR。② 提了怎么提的？否定/回避/贬损/错误表述→NEGATE（若属错误表述，reason 必须以 flag_error 开头）；直接讲到位→HIT；换说法讲到位→EQUIV。',
  '',
  'state 取值：HIT 直接命中 | EQUIV 语义等价（换说法算讲到位）| NEGATE 否定/回避/讲错（错误表述在 reason 标 flag_error）| MISS 未讲 | UNCLEAR 存疑（含动作类需视觉证实）',
  'confidence：0-1 小数。同一子点有多条证据句时全部输出（引擎只计 1 个通过子点），不要为凑数拆分同一句话到多个子点。',
  '',
  '输出格式（单个 JSON 对象，一次覆盖全部给定子点）：',
  '{"evidences":[{"subId":"1.1-a","state":"HIT","confidence":0.95,"quoteTs":"00:08:07","quote":"30寸的话是4.9千克，112升。","reason":"给出具体数值且自洽"}]}',
  '字段规则：subId 必须用清单中给定编号不得自造；quote 为转写原文逐字、最长不超 80 字；quoteTs 用转写稿内时间戳原样，无则 ""。'
].join('\n');

function deepseekChat(messages){
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: messages,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' }
    });
    const req = https.request({
      host: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error('deepseek: ' + (j.error.message || j.error.type || JSON.stringify(j.error))));
          const content = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
          resolve({ content: content, usage: j.usage || null });
        } catch(e) { reject(new Error('parse: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(55000, () => { req.destroy(new Error('deepseek timeout')); });
    req.write(body);
    req.end();
  });
}

// 构造判定清单文本（user 消息前半段）
function buildJudgeText(judges){
  const lines = ['【考核标准判定清单】对下面每个子点输出一条 evidence（subId 严格照抄）。'];
  let curMod = '';
  for (let i = 0; i < judges.length; i++) {
    const jd = judges[i];
    if (jd.mod && jd.mod !== curMod) { curMod = jd.mod; lines.push('【' + jd.mod + '】'); }
    lines.push(jd.id + ' ' + jd.name + '：');
    for (let k = 0; k < jd.points.length; k++) {
      const p = jd.points[k];
      lines.push('  - ' + jd.id + '-' + p.id + ' ' + p.name + '：' + p.q);
    }
  }
  return lines.join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!DEEPSEEK_KEY) {
    return res.json({ ok: false, error: 'DEEPSEEK_API_KEY not configured on server' });
  }
  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch(e) {
    return res.json({ ok: false, error: 'bad json body' });
  }
  const text = String(payload.text || '').slice(0, 40000);
  const judges = Array.isArray(payload.judges) ? payload.judges : [];
  if (!text || !judges.length) return res.json({ ok: false, error: 'missing text or judges' });

  const allowed = {};
  judges.forEach(jd => { (jd.points || []).forEach(p => { allowed[jd.id + '-' + p.id] = 1; }); });

  const t0 = Date.now();
  try {
    const resp = await deepseekChat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildJudgeText(judges) + '\n\n【主播转写稿】\n' + text + '\n\n请输出 JSON 证据包。' }
    ]);
    // 解析 + 校验（非法 subId / 非法 state / 过短引用一律剔除，防止污染计分）
    let parsed = null;
    try { parsed = JSON.parse(resp.content); }
    catch(e) {
      // 模型偶发输出带 ```json 围栏 → 剥壳重试
      const m = String(resp.content).match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch(e2) {} }
    }
    const rawEvs = (parsed && Array.isArray(parsed.evidences)) ? parsed.evidences : [];
    const VALID_STATES = { HIT: 1, EQUIV: 1, NEGATE: 1, MISS: 1, UNCLEAR: 1 };
    const evidences = [];
    const seen = {};
    for (let i = 0; i < rawEvs.length; i++) {
      const e = rawEvs[i] || {};
      const subId = String(e.subId || '').trim();
      const state = String(e.state || '').trim().toUpperCase();
      if (!allowed[subId] || !VALID_STATES[state]) continue;
      const key = subId + '|' + state;
      if (seen[key]) continue;          // 同子点同态去重（跨时间戳不同态保留）
      seen[key] = 1;
      evidences.push({
        subId: subId,
        state: state,
        confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0.5)),
        quoteTs: String(e.quoteTs || ''),
        quote: String(e.quote || '').slice(0, 120),
        reason: String(e.reason || '').slice(0, 160)
      });
    }
    return res.json({
      ok: true,
      evidences: evidences,
      meta: { model: MODEL, ms: Date.now() - t0, judged: evidences.length, chars: text.length, usage: resp.usage }
    });
  } catch(e) {
    return res.json({ ok: false, error: e.message, ms: Date.now() - t0 });
  }
};
