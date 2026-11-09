# -*- coding: utf-8 -*-
"""
v4.11.63 线上实测：接口部署是否生效 + 日报页真实取数表现。
铁律：耗时/条数一律现测，不引用本机数据；失败必须看 HTTP 状态码，不吞异常。
"""
import json
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(errors='replace')
OP = urllib.request.build_opener()
BASE = 'https://ito-ai-grading.vercel.app/api/feishu-read'
PASS, FAIL = [], []


def chk(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print('%s %-50s %s' % ('  OK ' if cond else ' FAIL', name, detail))


def post(body, timeout=180, tries=2):
    last = None
    for i in range(tries):
        req = urllib.request.Request(
            BASE, data=json.dumps(body).encode(), method='POST',
            headers={'Content-Type': 'application/json', 'Cache-Control': 'no-cache',
                     'User-Agent': 'ito-agent'})
        t0 = time.time()
        try:
            r = OP.open(req, timeout=timeout)
            raw = r.read()
            return time.time() - t0, r.status, json.loads(raw.decode('utf-8')), len(raw)
        except urllib.error.HTTPError as e:
            return time.time() - t0, e.code, {'error': e.read()[:200].decode('utf-8', 'replace')}, 0
        except Exception as e:
            last = '%s %s' % (type(e).__name__, e)
            print('    (第 %d 次失败：%s，重试)' % (i + 1, last[:70]))
    return None, None, {'error': last}, 0


print('=== 1. 线上接口是否已部署 v4.11.62+ 的 omit 能力 ===')
dt, code, j, size = post({'action': 'records', 'key': 'daily', 'limit': 5})
chk('1.1 小请求通', code == 200 and j.get('ok') is True, 'HTTP=%s %.1fs' % (code, dt or -1))
chk('1.2 新字段 omitted 已存在（=已部署新版）', 'omitted' in j,
    'omitted=%r fieldFiltered=%r' % (j.get('omitted'), j.get('fieldFiltered')))
chk('1.3 未传 omit 时 omitted 为空', j.get('omitted') == [], 'omitted=%r' % (j.get('omitted'),))

print()
print('=== 2. 日报全量：不带 omit（旧行为基线）===')
dt2, code2, j2, size2 = post({'action': 'records', 'key': 'daily', 'limit': 1200, 'stop_at': 1})
if code2 == 200 and j2.get('ok'):
    rows2 = j2.get('rows') or []
    has_rep = any(isinstance(r.get('完整主播报告'), str) and len(r['完整主播报告']) > 20 for r in rows2)
    print('  耗时 %.1fs  行=%d  列=%d  payload=%.2f MB  含报告列=%s'
          % (dt2, len(rows2), len(j2.get('columns') or []), size2 / 1048576.0, has_rep))
    chk('2.1 全量取到 400+ 行', len(rows2) > 400, 'rows=%d' % len(rows2))
    chk('2.2 基线确实含报告列', has_rep)
    base_rows, base_has_rep = len(rows2), has_rep
else:
    print('  失败:', j2)
    base_rows, base_has_rep = 0, None
    chk('2.1 全量请求成功', False, str(j2)[:120])

print()
print('=== 3. 日报全量：带 omit=完整主播报告（日报页实际路径）===')
dt3, code3, j3, size3 = post({'action': 'records', 'key': 'daily', 'limit': 1200,
                              'omit': ['完整主播报告'], 'stop_at': 1})
if code3 == 200 and j3.get('ok'):
    rows3 = j3.get('rows') or []
    has_rep3 = any(isinstance(r.get('完整主播报告'), str) and len(r['完整主播报告']) > 20 for r in rows3)
    dates = sorted({str(r.get('日期') or '')[:10] for r in rows3 if r.get('日期')})
    hosts = {str(r.get('主播') or '').strip() for r in rows3 if r.get('主播')}
    print('  耗时 %.1fs  行=%d  列=%d  payload=%.2f MB  含报告列=%s'
          % (dt3, len(rows3), len(j3.get('columns') or []), size3 / 1048576.0, has_rep3))
    print('  最新日期=%s  最早日期=%s  主播数=%d' % (dates[-1] if dates else 'N/A',
                                                dates[0] if dates else 'N/A', len(hosts)))
    chk('3.1 行数与不带 omit 一致（一条不少）', len(rows3) == base_rows,
        '%d vs %d' % (len(rows3), base_rows))
    chk('3.2 报告列确已剔除', not has_rep3)
    chk('3.3 omitted 回显正确', j3.get('omitted') == ['完整主播报告'], str(j3.get('omitted')))
    chk('3.4 fieldFiltered=true（飞书侧就没返回）', j3.get('fieldFiltered') is True,
        str(j3.get('fieldFiltered')))
    # 日报表真实存在且前端要用到的列（「等级」在历史评分表，日报表无此列 —— 实测确认）
    _need = ['日期', '主播', '直播间', '主播最终综合评分', '未记录 违规-综合评分',
             '标准日期', '复核违规', '主播数据看板-评分', '退款率', '退后ROI']
    _miss = [c for c in _need if c not in (j3.get('columns') or [])]
    chk('3.5 关键列仍在', not _miss, 'cols=%d 缺=%s' % (len(j3.get('columns') or []), _miss))
    chk('3.6 体积显著下降', size3 < size2 * 0.3 if size2 else False,
        '%.2f MB → %.2f MB' % (size2 / 1048576.0, size3 / 1048576.0))
    print('  耗时对比：不带 omit %.1fs → 带 omit %.1fs' % (dt2 or -1, dt3))
else:
    print('  失败:', j3)
    chk('3.1 带 omit 请求成功', False, str(j3)[:120])

print()
print('=== 4. 历史评分：带 omit（历史页第一批）===')
dt4, code4, j4, size4 = post({'action': 'records', 'key': 'history', 'limit': 1200,
                              'omit': ['完整主播报告']})
if code4 == 200 and j4.get('ok'):
    rows4 = j4.get('rows') or []
    hosts4 = {str(r.get('主播') or '').strip() for r in rows4 if r.get('主播')}
    tot = [r for r in rows4 if r.get('总分') not in (None, '', '—')]
    print('  耗时 %.1fs  行=%d  列=%d  payload=%.2f MB  主播数=%d  有总分=%d'
          % (dt4, len(rows4), len(j4.get('columns') or []), size4 / 1048576.0, len(hosts4), len(tot)))
    chk('4.1 历史全量 500+ 行', len(rows4) > 500, 'rows=%d' % len(rows4))
    chk('4.2 总分列有值', len(tot) > 500, 'with_total=%d' % len(tot))
    chk('4.3 完整主播报告列已剔除',
        not any(isinstance(r.get('完整主播报告'), str) and len(r['完整主播报告']) > 20 for r in rows4))
    # 历史评分表特有列：等级 / c1产品理解（历史页字段映射依赖）
    _miss4 = [c for c in ['日期', '主播', '总分', '等级', 'c1产品理解'] if c not in (j4.get('columns') or [])]
    chk('4.4 历史关键列仍在', not _miss4, 'cols=%d 缺=%s' % (len(j4.get('columns') or []), _miss4))
else:
    print('  失败:', j4)
    chk('4.1 历史带 omit 成功', False, str(j4)[:120])

print()
print('===== 合计 %d PASS / %d FAIL =====' % (len(PASS), len(FAIL)))
if FAIL:
    print('FAILED:', FAIL)
sys.exit(0 if not FAIL else 1)
