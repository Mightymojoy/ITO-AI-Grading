/* v4.11.67 静态自检：硬参数讲错 ⇒ 产品理解 c1 整块归零 + 取消 -4/处 + recompute 归一修复 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const APP = fs.readFileSync(REPO + '/v4/app-core.js', 'utf8');
const SEM = fs.readFileSync(REPO + '/v4/semantic-core.js', 'utf8');
const SHELL = fs.readFileSync(REPO + '/v4/v4-shell.js', 'utf8');
const HTML = fs.readFileSync(REPO + '/v4/index.html', 'utf8');
const STD = fs.readFileSync(REPO + '/v3/standard.js', 'utf8');

let pass = 0, fail = 0;
const fails = [];
function chk(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? '  [' + extra + ']' : '')); }
}
function block(src, startPat, endPat) {
  const i = src.search(startPat);
  if (i < 0) return '';
  // ⚠️ endPat 允许字符串或正则：indexOf 收到正则对象会转成字符串，永远匹配不到（块会被拉到文件尾）
  let j;
  if (typeof endPat === 'string') j = src.indexOf(endPat, i);
  else {
    const m = src.slice(i).match(endPat);
    j = m ? i + m.index : -1;
  }
  return src.slice(i, j < 0 ? src.length : j);
}

/* ---------- 1. app-core：c1 归零 ---------- */
const runG = block(APP, /function runGrading/, /function gradeWindow/);
chk('1.1 runGrading 内存在 c1 归零逻辑', /_hpHit\s*=\s*_hpZero\s*&&\s*\(bl\.errors\s*>\s*0\)/.test(runG)); 
chk('1.2 归零条件是 errors > 0（不能无条件归零）', /bl\.errors\s*>\s*0/.test(block(runG, /_hpHit\s*=/, /for\(var hpi/))); 
chk('1.3 只对 c1 生效', /moduleResults\[hpi\]\.key === 'c1'/.test(runG)); 
chk('1.4 分数与加权都置 0', /moduleResults\[hpi\]\.score = 0/.test(runG) && /moduleResults\[hpi\]\.weighted = 0/.test(runG)); 
chk('1.5 打 hardParamZero 标记供渲染', /moduleResults\[hpi\]\.hardParamZero = true/.test(runG)); 
chk('1.6 归零发生在 total 累加之前',
  runG.indexOf('hardParamZero = true') > 0 && runG.indexOf('hardParamZero = true') < runG.indexOf('var total = 0;')); 
chk('1.7 回退阀 v4hardparam_c1zero', /localStorage\.getItem\('v4hardparam_c1zero'\) === '0'/.test(runG)); 
chk('1.8 无条件 -4/处 已移除（仅回退路径保留）',
  /if\(!_hpZero\)\{[\s\S]{0,160}Math\.min\(12, bl\.errors \* 4\)/.test(runG)); 
chk('1.9 旧的 blPenalty 变量已不存在', !/var blPenalty/.test(APP)); 

/* ---------- 2. app-core：报告标注 ---------- */
chk('2.1 模块卡片标注硬参数归零',
  /hardParamZero \? ' <span style="color:var\(--danger\);font-weight:700">· 硬参数讲错，整块归零<\/span>'/.test(APP)); 
const nMark = (APP.match(/硬参数讲错，整块归零/g) || []).length;
chk('2.2 两处渲染点都标注（s-cell ×2）', nMark === 2, 'count=' + nMark);

/* ---------- 3. semantic-core：recompute 口径 ---------- */
const rec = block(SEM, /function recompute\(r\)/, /function gradeOf|function overviewOf/);
chk('3.1 recompute 内不再写死 /100', !/\/ 100/.test(rec)); 
chk('3.2 归一基数改为 W_SUM 求和的 _WSUM', /_WSUM \+= _wm\.weight/.test(rec)); 
chk('3.3 累加用 _WSUM', /m\.score \* m\.weight \/ _WSUM/.test(rec)); 
chk('3.4 weighted 也用 _WSUM', /m\.score \* m\.weight \/ _WSUM \* 10/.test(rec)); 
chk('3.5 recompute 内也有 c1 归零', /_hpOn && m\.key === 'c1'/.test(rec)); 
chk('3.6 recompute 回退阀同口径', /v4hardparam_c1zero/.test(rec)); 
chk('3.7 recompute 无条件扣分已移除（仅回退保留）',
  /if\(!_hpZero\)\{[\s\S]{0,160}Math\.min\(12, blErr \* 4\)/.test(rec)); 
chk('3.8 旧的 var pen = 已不存在', !/var pen = Math\.min/.test(rec)); 
chk('3.9 semantic-core _v 已更新', /_v: '4\.11\.67'/.test(SEM)); 

/* ---------- 4. standard.js 未被改动（口径权威源） ---------- */
chk('4.1 standard.js 权重仍为 c1=25', /c1:\s*25/.test(STD)); 
chk('4.2 standard.js 未被本轮修改（无 v4.11.67 字样）', !/v4\.11\.67/.test(STD)); 

/* ---------- 5. 版本号与缓存戳 ---------- */
chk('5.1 V4_VERSION = v4.11.67', /var V4_VERSION = 'v4\.11\.67';/.test(SHELL)); 
const m1 = HTML.match(/id="brandVer"[^>]*>v?([\d.]+)</);
const m2 = HTML.match(/id="pageBadge"[^>]*>v?([\d.]+)</);
const m3 = HTML.match(/id="footVer"[^>]*>v?([\d.]+)</);
chk('5.2 brandVer = 4.11.67', m1 && m1[1] === '4.11.67', m1 && m1[1]); 
chk('5.3 pageBadge = 4.11.67', m2 && m2[1] === '4.11.67', m2 && m2[1]); 
chk('5.4 footVer = 4.11.67', m3 && m3[1] === '4.11.67', m3 && m3[1]); 
chk('5.5 v4-shell.js 缓存戳 = 4.11.67', /v4-shell\.js\?v=4\.11\.67/.test(HTML)); 
chk('5.6 app-core.js 缓存戳已破（内容已变，必须）', /app-core\.js\?v=4\.11\.67/.test(HTML)); 
chk('5.7 semantic-core.js 缓存戳已破', /semantic-core\.js\?v=4\.11\.67/.test(HTML)); 
chk('5.8 旧版 4.11.66 仅剩 1 处（更新日志）',
  (HTML.match(/4\.11\.66/g) || []).length <= 1, 'count=' + (HTML.match(/4\.11\.66/g) || []).length);

/* ---------- 6. 未被误伤的既有机制 ---------- */
chk('6.1 整场归零机制仍在（sessionZero）', /sessionZero/.test(SHELL)); 
chk('6.2 壳层 rawPen 旧口径保留（老存档复算用，故意不改）', /function v4RawPen\(blk\)/.test(SHELL)); 
chk('6.3 W_SUM 归一仍在 app-core', /var W_SUM = 0;/.test(APP)); 
chk('6.4 gradeWindow 未加 c1 归零（单轮口径不含整场 baseline）',
  !/hardParamZero/.test(block(APP, /function gradeWindow/, /function teToSec|function tsToSec/))); 

/* ---------- 7. 需求2：人工复核结论分流（v4.11.67） ---------- */
const API = fs.readFileSync(REPO + '/api/feishu-read.js', 'utf8');
chk('7.1 api 新增 action=review', /action === 'review'/.test(API)); 
chk('7.2 review 只取 4 列白名单', /const FN = \['主播', '日期', '复核违规', '误判内容'\]/.test(API)); 
chk('7.3 review 走与 records 相同的表定位（不硬编码）',
  /ENV_TBL\.daily/.test(API) && /主播日报/.test(API)); 
chk('7.4 review 分页翻全（防表尾漏行）', /has_more/.test(block(API, /action === 'review'/, /\/\/ ② 取记录/))); 

const rvBlk = block(SHELL, /var RV_CACHE_KEY/, /function redlineBanner\(r, root\)\{/);
chk('7.5 复核映射按「主播|日期」行粒度建键', /map\[host \+ '\|' \+ dk\]/.test(rvBlk)); 
chk('7.6 日期支持飞书毫秒时间戳', /\^\\d\{12,13\}\$/.test(rvBlk)); 
chk('7.7 从误判内容提取触发词与规则编号', /触发词「\(\[\^」\]\{1,30\}\)」/.test(rvBlk) && /\\\[\(S\[12\]-\[0-9A-Za-z\]\+\)\\\]/.test(rvBlk)); 
chk('7.8 有缓存（TTL 12h）', /RV_TTL = 12 \* 3600 \* 1000/.test(rvBlk) && /v4_review_cache_v1/.test(rvBlk)); 
chk('7.9 并发去重（RV_WAIT 队列）', /RV_WAIT/.test(rvBlk)); 
chk('7.10 失败不伪装成功（落到空 map，且不反复重试）', /done\(\{\}\)/.test(rvBlk)); 

const rb = block(SHELL, /function redlineBanner\(r, root\)\{/, /window\.v4RedlineBanner = redlineBanner/);
chk('7.11 复核=否 ⇒ 明细置空不再呈现', /_rvNo \? \[\] : _all/.test(rb)); 
chk('7.12 复核=否 ⇒ 明确告知已复核判不违规', /已由人工复核判定/.test(rb)); 
chk('7.13 复核=是 ⇒ 命中条目加「已复核确认违规」徽标', /已复核确认违规/.test(rb)); 
chk('7.14 徽标判据=触发词或规则编号命中', /rvRec\.terms\[x\.term\]/.test(rb) && /rvRec\.codes\[x\.code\]/.test(rb)); 
chk('7.15 数据未就绪时先原样渲染、到位后重渲染（不阻塞首屏）',
  /RVMAP === null/.test(rb) && /rvEnsure\(function\(\)/.test(rb)); 
chk('7.16 已过时文案「已按 -4/处」已改掉', !/已按 -4\/处 计入信息准确性/.test(SHELL)); 

/* ---------- 8. 需求2 不得走「按词条豁免」的错路 ---------- */
// 实测同一触发词两边都有复核结论（飞机悬窗 否41/是26、母婴级 否34/是9、不降价 否26/是6）
// ⇒ 按词条加豁免会漏判真违规场次。本轮必须**完全不碰**规则库。
// ⚠️ 记忆里的指纹一律是 LF 口径；本机文件是 CRLF，直接算 RAW 会对不上（会误判成"被改过"）
const RULES_BUF = fs.readFileSync(REPO + '/v4/violation-rules.js');
const RULES_MD5 = require('crypto').createHash('md5')
  .update(Buffer.from(RULES_BUF.toString('binary').replace(/\r\n/g, '\n'), 'binary')).digest('hex');
chk('8.1 violation-rules.js 未被改动（走行粒度，不碰豁免清单；LF 口径）',
  RULES_MD5 === '704f42a9eb7dc3d45a1962c2ba123822', RULES_MD5); 

console.log('=' .repeat ? '' : '');
console.log('v4.11.67 静态自检结果');
console.log('----------------------------');
if (fails.length) {
  console.log('❌ FAIL ' + fail + ' 项：');
  fails.forEach(f => console.log('   · ' + f));
} else {
  console.log('✅ 全部通过');
}
console.log('PASS ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
