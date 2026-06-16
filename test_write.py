import urllib.request, json

req = urllib.request.Request(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    data=json.dumps({"app_id":"cli_aaba0a16d7bcdbc3","app_secret":"Z5WUnr1WQptEplbEuAYgubFQOTDv5CgX"}).encode(),
    headers={"Content-Type":"application/json"}
)
token = json.loads(urllib.request.urlopen(req).read())["tenant_access_token"]
headers = {"Authorization":f"Bearer {token}","Content-Type":"application/json"}
base = "AH5ewoyPaitFb1kHecOcNiN2nL0"
table = "tblEO7PbkyjcWy3l"

record = {"fields":{
    "主播姓名":"张三",
    "部门":"抖音直播",
    "日期":1728787200000,
    "得分":86,
    "是否及格":"是",
    "AI评语":"产品知识掌握扎实，话术表达有场景感",
    "答题用时":15,
    "切屏次数":0
}}

data = json.dumps(record, ensure_ascii=True).encode()
req2 = urllib.request.Request(
    f"https://open.feishu.cn/open-apis/bitable/v1/apps/{base}/tables/{table}/records",
    data=data, headers=headers, method="POST"
)
res = json.loads(urllib.request.urlopen(req2).read())
if res["code"] == 0:
    print(f"TEST_OK: record_id={res['data']['record']['record_id']}")
else:
    print(f"ERR: code={res['code']} msg={res['msg']}")
