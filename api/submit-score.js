const https = require('https');

// 飞书凭证从环境变量读取（Vercel后台配置），前端不感知
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_SECRET = process.env.FEISHU_APP_SECRET || '';
const APP_TOKEN = process.env.FEISHU_APP_TOKEN || 'AH5ewoyPaitFb1kHecOcNiN2nL0';
const TABLE_ID = process.env.FEISHU_TABLE_ID || 'tblEO7PbkyjcWy3l';

function feishuFetch(url, options) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('parse: ' + data.substring(0,200))); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!FEISHU_APP_ID || !FEISHU_SECRET) {
    return res.json({ code: -2, msg: 'Server not configured - contact admin' });
  }

  try {
    const payload = req.body || {};

    // 1) 获取飞书token
    const tr = await feishuFetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_SECRET })}
    );
    if (tr.code !== 0) throw new Error('token: ' + tr.msg);
    const token = tr.tenant_access_token;

    // 2) 写入飞书
    const fields = {
      '主播姓名': payload.name || '',
      '部门': payload.department || '',
      '日期': Date.now(),
      '得分': payload.totalScore || 0,
      '是否及格': payload.passed ? '是' : '否',
      'AI评语': payload.feedback || '',
      '答题用时': payload.duration || 0,
      '切屏次数': payload.switches || 0
    };

    const wr = await feishuFetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`,
      { method:'POST',
        headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
        body: JSON.stringify({fields})}
    );

    if (wr.code === 0) {
      return res.json({ code: 0, success: true, record_id: wr.data.record.record_id });
    } else {
      return res.json({ code: -1, msg: wr.msg || 'write failed' });
    }
  } catch(e) {
    return res.json({ code: -1, msg: e.message });
  }
};
