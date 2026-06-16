import urllib.request, json, os
import datetime

# Read from env (fallback)
APP_TOKEN = os.environ.get("FEISHU_APP_TOKEN", "AH5ewoyPaitFb1kHecOcNiN2nL0")
TABLE_ID = os.environ.get("FEISHU_TABLE_ID", "tblEO7PbkyjcWy3l")

def get_tenant_token(app_id, app_secret):
    body = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=body, headers={"Content-Type": "application/json"}
    )
    res = json.loads(urllib.request.urlopen(req).read())
    if res.get("code") != 0:
        raise Exception(f"token error: {res.get('msg')}")
    return res["tenant_access_token"]

def write_record(token, fields_data):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    record = {"fields": fields_data}
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
        
        # Support both: app_id in body OR env var
        app_id = payload.get("app_id") or os.environ.get("FEISHU_APP_ID", "")
        app_secret = payload.get("app_secret") or os.environ.get("FEISHU_APP_SECRET", "")
        if not app_id or not app_secret:
            return {"statusCode": 400, "body": json.dumps({"error": "Missing credentials"})}
        
        # Required fields
        name = payload.get("name", "")
        dept = payload.get("department", "")
        total = payload.get("totalScore", 0)
        passed_flag = payload.get("passed", False)
        feedback = payload.get("feedback", "")
        
        if not name:
            return {"statusCode": 400, "body": json.dumps({"error": "Missing field: name"})}
        
        # Map to Feishu fields
        today_ms = int(datetime.datetime.now().timestamp() * 1000)
        feishu_fields = {
            "主播姓名": name,
            "部门": dept,
            "日期": today_ms,
            "得分": total,
            "是否及格": "是" if passed_flag else "否",
            "AI评语": feedback,
            "答题用时": payload.get("duration", 0),
            "切屏次数": payload.get("switches", 0)
        }
        
        token = get_tenant_token(app_id, app_secret)
        result = write_record(token, feishu_fields)
        
        if result.get("code") == 0:
            return {
                "statusCode": 200,
                "body": json.dumps({
                    "code": 0,
                    "success": True,
                    "record_id": result["data"]["record"]["record_id"]
                })
            }
        else:
            return {
                "statusCode": 200,
                "body": json.dumps({"code": -1, "msg": result.get("msg", "write failed")})
            }
    except Exception as e:
        return {
            "statusCode": 200,
            "body": json.dumps({"code": -1, "msg": str(e)})
        }
