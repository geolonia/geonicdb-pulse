#!/bin/bash
set -euo pipefail

# ============================================================
# GeonicDB 地震データ セットアップスクリプト
# geonic CLI を使用してテナント・ユーザー・エンティティ・APIキーを作成
# ============================================================

# --- 設定 ---
TENANT_NAME="earthquake_monitor"
TENANT_DESC="地震モニタリングシステム"
SUPER_ADMIN_EMAIL="${GDB_SUPER_ADMIN_EMAIL:-admin@example.com}"
SUPER_ADMIN_PASSWORD="${GDB_SUPER_ADMIN_PASSWORD:-YourSecurePassword2026}"
TENANT_ADMIN_EMAIL="eq-admin@example.com"
TENANT_ADMIN_PASSWORD="EqAdmin2026Secure"
TENANT_USER_EMAIL="eq-user@example.com"
TENANT_USER_PASSWORD="EqUser2026Secure"
SERVER_URL="https://geonicdb.geolonia.com"
APP_ORIGIN="http://localhost:8080"

echo "=== Step 1: CLI 接続設定 ==="
geonic config set url "$SERVER_URL"
geonic health

echo ""
echo "=== Step 2: スーパー管理者でログイン ==="
geonic profile create super-admin 2>/dev/null || true
geonic profile use super-admin
geonic config set url "$SERVER_URL"
GDB_EMAIL="$SUPER_ADMIN_EMAIL" GDB_PASSWORD="$SUPER_ADMIN_PASSWORD" geonic auth login
geonic me

echo ""
echo "=== Step 3: テナントを作成 ==="
TENANT_RESULT=$(geonic admin tenants create '{
  "name": "'"$TENANT_NAME"'",
  "description": "'"$TENANT_DESC"'",
  "settings": {
    "features": {
      "apiKeysEnabled": true,
      "oauthClientsEnabled": true
    }
  }
}')
echo "$TENANT_RESULT"
TENANT_ID=$(echo "$TENANT_RESULT" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
echo "テナントID: $TENANT_ID"

echo ""
echo "=== Step 4: テナント管理者を作成 ==="
geonic admin users create '{
  "email": "'"$TENANT_ADMIN_EMAIL"'",
  "password": "'"$TENANT_ADMIN_PASSWORD"'",
  "role": "tenant_admin",
  "tenantId": "'"$TENANT_ID"'"
}'

echo ""
echo "=== Step 5: テナント管理者でログインし直す ==="
geonic profile create tenant-admin 2>/dev/null || true
geonic profile use tenant-admin
geonic config set url "$SERVER_URL"
GDB_EMAIL="$TENANT_ADMIN_EMAIL" GDB_PASSWORD="$TENANT_ADMIN_PASSWORD" geonic auth login
geonic config set service "$TENANT_NAME"

echo ""
echo "=== Step 6: テナントユーザーを作成 ==="
geonic admin users create '{
  "email": "'"$TENANT_USER_EMAIL"'",
  "password": "'"$TENANT_USER_PASSWORD"'",
  "role": "user",
  "tenantId": "'"$TENANT_ID"'"
}'

echo ""
echo "=== Step 7: テナントユーザーでログイン ==="
geonic profile create user 2>/dev/null || true
geonic profile use user
geonic config set url "$SERVER_URL"
GDB_EMAIL="$TENANT_USER_EMAIL" GDB_PASSWORD="$TENANT_USER_PASSWORD" geonic auth login
geonic config set service "$TENANT_NAME"

echo ""
echo "=== Step 7.1: 地震エンティティを作成 ==="

# 日本の主要地震データ（サンプル）
geonic entities create '{
  "id": "urn:ngsi-ld:Earthquake:20260318_001",
  "type": "Earthquake",
  "epicenter": {
    "type": "Property",
    "value": "石川県能登地方"
  },
  "magnitude": {
    "type": "Property",
    "value": 5.2,
    "unitCode": "MMS",
    "observedAt": "2026-03-18T02:14:00Z"
  },
  "depth": {
    "type": "Property",
    "value": 10,
    "unitCode": "KMT"
  },
  "maxIntensity": {
    "type": "Property",
    "value": "5弱"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [136.85, 37.50]
    }
  }
}'

geonic entities create '{
  "id": "urn:ngsi-ld:Earthquake:20260317_001",
  "type": "Earthquake",
  "epicenter": {
    "type": "Property",
    "value": "茨城県南部"
  },
  "magnitude": {
    "type": "Property",
    "value": 4.1,
    "unitCode": "MMS",
    "observedAt": "2026-03-17T14:30:00Z"
  },
  "depth": {
    "type": "Property",
    "value": 50,
    "unitCode": "KMT"
  },
  "maxIntensity": {
    "type": "Property",
    "value": "3"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [140.10, 36.05]
    }
  }
}'

geonic entities create '{
  "id": "urn:ngsi-ld:Earthquake:20260316_001",
  "type": "Earthquake",
  "epicenter": {
    "type": "Property",
    "value": "宮城県沖"
  },
  "magnitude": {
    "type": "Property",
    "value": 6.0,
    "unitCode": "MMS",
    "observedAt": "2026-03-16T08:45:00Z"
  },
  "depth": {
    "type": "Property",
    "value": 40,
    "unitCode": "KMT"
  },
  "maxIntensity": {
    "type": "Property",
    "value": "5強"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [142.20, 38.30]
    }
  }
}'

geonic entities create '{
  "id": "urn:ngsi-ld:Earthquake:20260315_001",
  "type": "Earthquake",
  "epicenter": {
    "type": "Property",
    "value": "熊本県熊本地方"
  },
  "magnitude": {
    "type": "Property",
    "value": 3.8,
    "unitCode": "MMS",
    "observedAt": "2026-03-15T20:10:00Z"
  },
  "depth": {
    "type": "Property",
    "value": 15,
    "unitCode": "KMT"
  },
  "maxIntensity": {
    "type": "Property",
    "value": "2"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [130.75, 32.80]
    }
  }
}'

geonic entities create '{
  "id": "urn:ngsi-ld:Earthquake:20260315_002",
  "type": "Earthquake",
  "epicenter": {
    "type": "Property",
    "value": "千葉県東方沖"
  },
  "magnitude": {
    "type": "Property",
    "value": 4.5,
    "unitCode": "MMS",
    "observedAt": "2026-03-15T11:22:00Z"
  },
  "depth": {
    "type": "Property",
    "value": 30,
    "unitCode": "KMT"
  },
  "maxIntensity": {
    "type": "Property",
    "value": "3"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [140.90, 35.40]
    }
  }
}'

geonic entities create '{
  "id": "urn:ngsi-ld:Earthquake:20260314_001",
  "type": "Earthquake",
  "epicenter": {
    "type": "Property",
    "value": "紀伊水道"
  },
  "magnitude": {
    "type": "Property",
    "value": 3.5,
    "unitCode": "MMS",
    "observedAt": "2026-03-14T05:50:00Z"
  },
  "depth": {
    "type": "Property",
    "value": 20,
    "unitCode": "KMT"
  },
  "maxIntensity": {
    "type": "Property",
    "value": "2"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [135.10, 33.90]
    }
  }
}'

geonic entities create '{
  "id": "urn:ngsi-ld:Earthquake:20260313_001",
  "type": "Earthquake",
  "epicenter": {
    "type": "Property",
    "value": "北海道胆振地方中東部"
  },
  "magnitude": {
    "type": "Property",
    "value": 4.8,
    "unitCode": "MMS",
    "observedAt": "2026-03-13T16:33:00Z"
  },
  "depth": {
    "type": "Property",
    "value": 35,
    "unitCode": "KMT"
  },
  "maxIntensity": {
    "type": "Property",
    "value": "4"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [141.90, 42.75]
    }
  }
}'

geonic entities create '{
  "id": "urn:ngsi-ld:Earthquake:20260312_001",
  "type": "Earthquake",
  "epicenter": {
    "type": "Property",
    "value": "福島県沖"
  },
  "magnitude": {
    "type": "Property",
    "value": 5.5,
    "unitCode": "MMS",
    "observedAt": "2026-03-12T22:05:00Z"
  },
  "depth": {
    "type": "Property",
    "value": 55,
    "unitCode": "KMT"
  },
  "maxIntensity": {
    "type": "Property",
    "value": "4"
  },
  "location": {
    "type": "GeoProperty",
    "value": {
      "type": "Point",
      "coordinates": [141.50, 37.10]
    }
  }
}'

echo ""
echo "=== エンティティ確認 ==="
geonic entities list --type Earthquake --count

echo ""
echo "=== Step 8: 読み取り専用 API キーを発行 ==="
API_KEY_RESULT=$(geonic me api-keys create \
  --name "地震モニター読み取り用" \
  --scopes read:entities \
  --origins "$APP_ORIGIN" \
  --entity-types Earthquake)
echo "$API_KEY_RESULT"

echo ""
echo "============================================================"
echo "セットアップ完了！"
echo ""
echo "上記レスポンスの 'key' 値を index.html の YOUR_API_KEY に設定してください。"
echo "テナント名: $TENANT_NAME"
echo ""
echo "アプリ起動:"
echo "  npx serve -l 8080 ."
echo "============================================================"
