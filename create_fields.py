import urllib.request, json, sys

def main():
    # 1. get token
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=json.dumps({"app_id":"cli_aaba0a16d7bcdbc3","app_secret":"Z5WUnr1WQptEplbEuAYgubFQOTDv5CgX"}).encode(),
        headers={"Content-Type":"application/json"}
    )
    token = json.loads(urllib.request.urlopen(req).read())["tenant_access_token"]
    headers = {"Authorization":f"Bearer {token}","Content-Type":"application/json"}
    base = "AH5ewoyPaitFb1kHecOcNiN2nL0"
    table = "tblEO7PbkyjcWy3l"
    
    # 2. list current fields
    req2 = urllib.request.Request(f"https://open.feishu.cn/open-apis/bitable/v1/apps/{base}/tables/{table}/fields?page_size=20", headers=headers)
    exist = json.loads(urllib.request.urlopen(req2).read())
    print("=== Existing fields ===")
    for f in exist["data"]["items"]:
        print(f"  {f['field_id']} = {f['field_name']}")
    
    exist_names = [f["field_name"] for f in exist["data"]["items"]]
    
    # 3. create missing fields
    fields = [
        {"field_name":"主播姓名","type":1},
        {"field_name":"部门","type":1},
        {"field_name":"日期","type":5},
        {"field_name":"得分","type":2},
        {"field_name":"是否及格","type":3,"property":{"options":[{"name":"是","color":0},{"name":"否","color":1}]}},
        {"field_name":"AI评语","type":1},
        {"field_name":"答题用时","type":2},
        {"field_name":"切屏次数","type":2}
    ]
    
    created = 0
    for f in fields:
        if f["field_name"] in exist_names:
            print(f"SKIP: {f['field_name']} (already exists)")
            continue
        data = json.dumps(f, ensure_ascii=True).encode()
        req3 = urllib.request.Request(
            f"https://open.feishu.cn/open-apis/bitable/v1/apps/{base}/tables/{table}/fields",
            data=data, headers=headers, method="POST"
        )
        try:
            res = json.loads(urllib.request.urlopen(req3).read())
            if res["code"] == 0:
                print(f"OK: {f['field_name']} -> {res['data']['field']['field_id']}")
                created += 1
            else:
                print(f"FAIL: {f['field_name']} -> {res['msg']}")
        except Exception as e:
            print(f"ERR: {f['field_name']} -> {e}")
    print(f"\n=== Created: {created}/{len(fields)} ===")

if __name__ == "__main__":
    main()
