#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.local; set +a
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/generate_link" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"email\":\"$E2E_ADMIN_EMAIL\"}" \
  | python3 -c '
import sys, json, urllib.parse
d = json.load(sys.stdin)
props = d.get("properties", d)
h = props.get("hashed_token") or d.get("hashed_token")
if not h:
    print("NO_TOKEN:", json.dumps(d))
    sys.exit(1)
qs = urllib.parse.urlencode({
    "token_hash": h,
    "type": "magiclink",
    "next": "/upenn-sprint-football",
})
print(f"http://localhost:3001/auth/confirm?{qs}")
'
