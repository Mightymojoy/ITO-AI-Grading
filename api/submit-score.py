import urllib.request, json, os
import datetime

# Read from env
APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
APP_TOKEN = os.environ.get("FEISHU_APP_TOKEN", "AH5ewoyPaitFb1kHecOcNiN2nL0")
TABLE_ID = os.environ.get("FEISHU_TABLE_ID", "tblEO7PbkyjcWy3l")

def get_tenant_token():
    body = json.dumps({"app_id": APP_ID, "app_secret": APP_SECRET}).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=body, headers={"Content-Type": "application/json"}
    )
    res = json.loads(urllib.request.urlopen(req).read())
    if res.get("code") != 0:
        raise Exception(f"token error: {res.get('msg')}")
    return res["tenant_access_token"]

def write_record(token, data):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    record = {"fields": data}
    body = json.dumps(record, ensure_ascii=True).encode()
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    res = json.loads(urllib.request.urlopen(req).read())
    return res

def handler(request):
    try:
        method = request.get("httpMethod", "GET")
        if method != "POST":
            return {"statusCode": 405, "body": json.dumps({"error": "Method not allowed"})}
        
        body_raw = request.get("body", "{}")
        payload = json.loads(body_raw)
        
        # Required fields
        required = ["name", "department", "totalScore", "passed"]
        for r in required:
            if r not in payload or payload[r] is None:
                return {"statusCode": 400, "body": json.dumps({"error": f"Missing field: {r}"})}
        
        # Map to Feishu fields
        today_ms = int(datetime.datetime.now().timestamp() * 1000)
        feishu_fields = {
            "主播姓名": payload.get("name", ""),
            "部门": payload.get("department", ""),
            "日期": today_ms,
            "得分": payload.get("totalScore", 0),
            "是否及格": "是" if payload.get("passed") else "否",
            "AI评语": payload.get("feedback", ""),
            "答题用时": payload.get("duration", 0),
            "切屏次数": payload.get("switches", 0)
        }
        
        token = get_tenant_token()
        result = write_record(token, feishu_fields)
        
        if result.get("code") == 0:
            return {
                "statusCode": 200,
                "body": json.dumps({
                    "success": True,
                    "record_id": result["data"]["record"]["record_id"]
                })
            }
        else:
            return {
                "statusCode": 500,
                "body": json.dumps({"error": f"Feishu error: {result.get('msg')}"})
            }
    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }
