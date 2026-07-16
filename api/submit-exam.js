// 飞书凭证
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'cli_aaba0a16d7bcdbc3';
const FEISHU_SECRET = process.env.FEISHU_APP_SECRET || 'Z5WUnr1WQptEplbEuAYgubFQOTDv5CgX';
const APP_TOKEN = 'P6tnbCy3oamMx3sSkjBchsYvnLC';
const TABLE_ID = 'tblVq79mDBWm0JZR';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    const tr = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_SECRET })
    }).then(r => r.json());

    if (tr.code !== 0) throw new Error('token: ' + tr.msg);
    const token = tr.tenant_access_token;

    const fields = {
      '姓名': payload.name || '',
      '部门': payload.dept || '',
      '总分': Number(payload.totalScore) || 0,
      '评级': payload.rating || '',
      '答题时间': Date.now(),
      '得分详情': payload.detail || ''
    };

    const wr = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    }).then(r => r.json());

    if (wr.code === 0) {
      return res.json({ code: 0, success: true, record_id: wr.data?.record?.record_id });
    } else {
      return res.json({ code: -1, msg: wr.msg || 'write failed' });
    }
  } catch (e) {
    return res.json({ code: -1, msg: e.message });
  }
};
