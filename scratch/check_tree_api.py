import urllib.request, json

url = "http://localhost:8000/api/assets-vault/tree"
try:
    req = urllib.request.urlopen(url)
    data = json.loads(req.read().decode('utf-8'))
    print("=== BACKEND /api/assets-vault/tree RESPONSE ===")
    print(json.dumps(data, indent=2))
except Exception as e:
    print("ERROR FETCHING API:", e)
