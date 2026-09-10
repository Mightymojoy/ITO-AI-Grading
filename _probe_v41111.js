/* v4.11.11 壳层接管验证探针（不联网，全部 mock）
 * 覆盖：接管生效 / 云端成功 / 缓存 / _index 表名→逻辑键 / 失败回退 / mergeDaily 优先级与日期归一 / 首页合并 */
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync('v4/v4-shell.js', 'utf8');
const REAL_TABLES = [
  { table_id: 'tblQC7Jfzmxp6QJI', name: '主播日报' },
  { table_id: 'tblOocjnCsM9bjxo', name: '多主播TOP1 评分' },
  { table_id: 'tbljvCsgMJF9efok', name: '周总结' },
  { table_id: 'tblW366zZNF9QF06', name: '周总结-明星主播' },
  { table_id: 'tbl6LQrwRgnHcumu', name: '月总结' },
  { table_id: 'tblbxq2tmII6nKAo', name: '激励记录' },
  { table_id: 'tblspGBwepmzE50j', name: '惩罚记录' },
  { table_id: 'tbluc1Erb4b04PIb', name: '黄金话术库' },
  { table_id: 'tblORA9bSl8M63EO', name: '问题话术库' },
  { table_id: 'tblAcxchmgINgRV1', name: '优秀案例TOP3' },
  { table_id: 'tblkN1e6yCtXl5bG', name: '历史评分' },
  { table_id: 'tblb7HabjqM8TTav', name: '主播名单' },
  { table_id: 'tbl4wrhbweS3qTxB', name: '日评分汇总' },
  { table_id: 'tbl8deLTFJMeDq2F', name: '历史评分汇总' }
];
const EXPECT_KEYS = ['daily', 'top1', 'week', 'weekstar', 'month', 'reward', 'punish',
  'golden', 'problem', 'case', 'history', 'roster', 'dailySum', 'historySum'];

function mockEl(tag) {
  return {
    tagName: tag, style: {}, className: '', id: '', textContent: '', innerHTML: '', value: '',
    children: [], dataset: {}, disabled: false, title: '', checked: false, href: '', src: '',
    appendChild(c) {
      this.children.push(c);
      // 静态快照路径：原实现靠 <script> 的 onload/onerror 收尾，探针需手动触发 onerror
      if (c && c.tagName === 'script') {
        setTimeout(function () { try { if (typeof c.onerror === 'function') c.onerror(new Error('probe: 静态快照不可用')); } catch (e) {} }, 0);
      }
      return c;
    },
    removeChild() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    insertBefore() {}, cloneNode() { return mockEl(tag); },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    parentNode: null
  };
}

function build(fetchImpl, lsSeed) {
  const els = {};
  const store = Object.assign({}, lsSeed || {});
  const calls = [];
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, JSON, Math, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    AbortController,
    localStorage: {
      getItem: k => (k in store ? String(store[k]) : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); }
    },
    location: {
      protocol: 'https:', hostname: 'ito-ai-grading.vercel.app',
      href: 'https://ito-ai-grading.vercel.app/v4/index.html',
      pathname: '/v4/index.html', search: '', hash: ''
    },
    navigator: { userAgent: 'probe', language: 'zh-CN' },
    history: { replaceState() {}, pushState() {} },
    alert() {}, confirm() { return true; }, prompt() { return null; },
    document: {
      readyState: 'complete',
      getElementById(id) { if (!els[id]) { els[id] = mockEl('div'); els[id].id = id; } return els[id]; },
      createElement: t => mockEl(t),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      head: mockEl('head'), body: mockEl('body'), documentElement: mockEl('html'),
      cookie: ''
    },
    XMLHttpRequest: function () { this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {}; }
  };
  sandbox.fetch = function (url, opt) {
    calls.push(String(url));
    return fetchImpl(String(url), opt);
  };
  sandbox.addEventListener = function () {};  sandbox.removeEventListener = function () {};
  sandbox.dispatchEvent = function () { return true; };
  sandbox.matchMedia = function () { return { matches: false, addListener() {}, removeListener() {} }; };
  sandbox.getComputedStyle = function () { return { getPropertyValue() { return ''; } }; };
  sandbox.scrollTo = function () {};
  sandbox.open = function () { return null; };
  sandbox.esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  sandbox.toastErr = function () {};
  sandbox.toastOk = function () {};
  sandbox.toast = function () {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx, { filename: 'v4-shell.js' });
  return { sandbox, els, store, calls };
}

const json = payload => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
function apiImpl(byKey, tableList) {
  return function (url, opt) {
    if (url.indexOf('feishu-read') < 0) return Promise.reject(new Error('not feishu'));
    let body = {};
    try { body = JSON.parse((opt && opt.body) || '{}'); } catch (e) {}
    if (body.action === 'tables') return json({ ok: true, tables: tableList || REAL_TABLES });
    const k = body.key || body.table_id || '';
    if (byKey[k]) return json(Object.assign({ ok: true, key: k, table: { table_id: k, name: k } }, byKey[k]));
    return json({ ok: true, key: k, table: { table_id: k, name: k }, columns: [], rows: [], total: 0 });
  };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

(async function main() {
  console.log('\n=== T1 接管生效 ===');
  {
    const { sandbox } = build(apiImpl({}));
    ok('window.V4CLOUD 已挂载', !!sandbox.V4CLOUD);
    ok('v4FsEnsure 已被接管', typeof sandbox.v4FsEnsure === 'function');
    ok('mergeDaily 已被接管', typeof sandbox.mergeDaily === 'function');
    ok('v4RenderDashboard 已被接管', typeof sandbox.v4RenderDashboard === 'function');
  }

  console.log('\n=== T2 云端成功读取 ===');
  let t2ctx;
  {
    const cv = build(apiImpl({
      history: { columns: ['日期', '主播', '总分'], rows: [{ 主播: '张三', 日期: '2026-9-9', 总分: '88' }], total: 1 }
    }));
    t2ctx = cv;
    const d = await cv.sandbox.v4FsEnsure('history');
    ok('返回 ok=true', d && d.ok === true, JSON.stringify(d && d.ok));
    ok('rows 长度 1', d && d.rows && d.rows.length === 1);
    ok('syncedAt 标记为飞书实时', !!(d && d.syncedAt && d.syncedAt.indexOf('飞书实时') === 0), d && d.syncedAt);
    ok('写回 window.V4FS.history', !!(cv.sandbox.V4FS && cv.sandbox.V4FS.history));
    const n1 = cv.calls.length;
    await cv.sandbox.v4FsEnsure('history');
    ok('60s 内命中缓存不再请求', cv.calls.length === n1, 'calls ' + n1 + ' → ' + cv.calls.length);
    cv.sandbox.v4FsReload();
    await cv.sandbox.v4FsEnsure('history');
    ok('v4FsReload 清缓存后可重取', cv.calls.length > n1, 'calls ' + cv.calls.length);
  }

  console.log('\n=== T3 _index 表名 → 逻辑键映射 ===');
  {
    const cv = build(apiImpl({}));
    const idx = await cv.sandbox.v4FsEnsure('_index');
    const got = (idx.tables || []).map(t => t.key);
    ok('表数量 14', got.length === 14, 'got ' + got.length);
    let allHit = true, diff = [];
    EXPECT_KEYS.forEach((k, i) => { if (got[i] !== k) { allHit = false; diff.push(got[i] + '≠' + k); } });
    ok('逻辑键逐项正确（含 周总结/明星、历史评分/汇总 消歧）', allHit, diff.join(', '));
    ok('_index 挂到 window.V4FS', !!(cv.sandbox.V4FS && cv.sandbox.V4FS['_index']));
    ok('未加载表的 count 显示占位符 —', idx.tables[0].count === '—', String(idx.tables[0].count));
  }

  console.log('\n=== T4 云端失败 → 回退静态快照 ===');
  {
    const cv = build(function () { return Promise.reject(new Error('network down')); });
    let threw = false, res = 'n/a';
    try { res = await cv.sandbox.v4FsEnsure('daily'); } catch (e) { threw = true; }
    ok('不抛异常（回退原实现）', !threw, threw ? 'threw' : '');
    ok('原实现被调用（返回非云端数据）', res === null || (res && !res.syncedAt), 'res=' + JSON.stringify(res));
    const c = cv.sandbox.V4CLOUD.cache['daily'];
    ok('失败结果被短期缓存（避免反复重试）', !!c && c.data === null);
  }

  console.log('\n=== T5 mergeDaily 优先级与日期归一 ===');
  {
    const cv = build(apiImpl({}));
    const md = cv.sandbox.mergeDaily;
    const staleLocal = { 主播: '甘晋铭', 日期: '2026-08-25', 综合评分: 76, _updatedAt: '2026-08-25T10:00:00.000Z' };
    const freshRemote = { 主播: '甘晋铭', 日期: '2026-8-25', 综合评分: 88 };
    const m1 = md([staleLocal], [freshRemote]);
    ok('日期格式不同仍归并为 1 条', m1.length === 1, 'len=' + m1.length);
    ok('远端（飞书）优先，不再被本机旧分盖掉', String(m1[0]['综合评分']) === '88', 'got ' + m1[0]['综合评分']);

    const justLocal = { 主播: '甘晋铭', 日期: '2026-08-25', 综合评分: 91, _updatedAt: new Date().toISOString() };
    const m2 = md([justLocal], [freshRemote]);
    ok('本机 5 分钟内新评的保留本机分', String(m2[0]['综合评分']) === '91', 'got ' + m2[0]['综合评分']);

    const other = { 主播: '曲姝锜', 日期: '2026-08-25', 综合评分: 70, _updatedAt: '2026-08-25T10:00:00.000Z' };
    const m3 = md([other], [freshRemote]);
    ok('远端没有的记录正常并入', m3.length === 2, 'len=' + m3.length);
  }

  console.log('\n=== T6 首页统计合并飞书全员 ===');
  {
    const seed = {
      grading_history_v1: JSON.stringify([
        { host: '李四', date: '2026-09-01', total: 70, c1Score: 60, product: 'PISTACHIO Plus', ts: Date.parse('2026-09-01T08:00:00Z') }
      ])
    };
    const cv = build(apiImpl({
      history: {
        columns: ['日期', '主播', '总分'],
        rows: [{ 主播: '张三', 日期: '2026-9-9', 总分: '88', 'c1产品理解': '77', 产品: 'TRUFFLE PRO' }],
        total: 1
      }
    }), seed);
    cv.sandbox.v4RenderDashboard();
    await new Promise(r => setTimeout(r, 120));
    const nHist = cv.els['dash-stat-history'].textContent;
    ok('历史总数 = 本机 1 + 飞书 1 = 2', String(nHist) === '2', 'got ' + nHist);
    const recent = cv.els['dash-recent'].innerHTML || '';
    ok('最近评分含飞书的张三', recent.indexOf('张三') >= 0);
    ok('最近评分含本机的李四', recent.indexOf('李四') >= 0);
    ok('标注了飞书全员条数', recent.indexOf('飞书全员数据') >= 0);
  }

  console.log('\n=== T7 本地 8791 模式的端点选择 ===');
  {
    const cv = build(apiImpl({}));
    cv.sandbox.location.protocol = 'http:';
    cv.sandbox.location.hostname = '127.0.0.1';
    const p = cv.sandbox.v4FsEnsure('history');
    await p;
    const u = cv.calls[cv.calls.length - 1] || '';
    ok('本地模式直连线上绝对地址（8791 无该路由）', u.indexOf('https://ito-ai-grading.vercel.app/api/feishu-read') === 0, u);
  }

  console.log('\n──────────────────────────────');
  console.log('结果: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
