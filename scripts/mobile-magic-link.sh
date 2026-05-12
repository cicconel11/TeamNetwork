#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.local; set +a
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/generate_link" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"email\":\"$E2E_ADMIN_EMAIL\",\"options\":{\"redirect_to\":\"teammeet://callback\"}}" \
  | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(json.dumps(d, indent=2))
'
