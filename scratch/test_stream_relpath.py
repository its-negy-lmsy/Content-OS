import urllib.request

url = "http://localhost:8000/api/assets-vault/stream/imports/vidssave.com%20Introducing%20Aside%201080P.mp4"
try:
    req = urllib.request.urlopen(url)
    print("=== TESTING FASTAPI STREAM WITH CORRECT REL_PATH ===")
    print("HTTP STATUS:", req.status)
    print("CONTENT-TYPE:", req.headers.get('Content-Type'))
    print("CONTENT-LENGTH:", req.headers.get('Content-Length'))
except Exception as e:
    print("ERROR FETCHING STREAM:", e)
