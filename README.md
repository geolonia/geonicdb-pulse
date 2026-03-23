# GeonicDB リアルタイムモニター

GeonicDB に保存されたエンティティを地図上にリアルタイム表示する Web アプリケーションです。

- エンティティタイプを選択して地図上に表示
- WebSocket によるリアルタイム更新
- Temporal API 対応（時系列データのスパークラインチャート表示）
- Geolonia Maps によるダークテーマの地図表示

## セットアップ

### 1. geonic CLI のインストール

```bash
npm install -g @geolonia/geonicdb-cli
```

### 2. GeonicDB サーバーへの接続

```bash
geonic config set url https://geonicdb.geolonia.com
geonic health
```

### 3. テナント管理者としてログイン

```bash
geonic auth login
```

メールアドレスとパスワードを入力してログインします。

テナントを設定します:

```bash
geonic config set service <your-tenant-name>
```

### 4. XACML ポリシーの作成

API キーに紐付ける読み取り専用の XACML ポリシーを作成します。

```bash
geonic me policies create '{
  "policyId": "ngsi-ld-readonly",
  "target": {
    "resources": [{"attributeId": "path", "matchValue": "/ngsi-ld/**", "matchFunction": "glob"}]
  },
  "rules": [
    {"ruleId": "allow-get", "effect": "Permit", "target": {"actions": [{"attributeId": "method", "matchValue": "GET"}]}},
    {"ruleId": "deny-others", "effect": "Deny"}
  ]
}'
```

- `/ngsi-ld/**` への GET のみ許可し、それ以外はすべて Deny します

### 5. API キーの発行

アプリで使用する DPoP 対応の API キーを発行します。

```bash
geonic me api-keys create \
  --name "monitor-app" \
  --origins "https://your-app.vercel.app" \
  --dpop-required \
  --policy "ngsi-ld-readonly"
```

- `--origins` — API キーの利用を許可するオリジン。デプロイ先のドメインを指定します。ローカル開発中は `"http://localhost:8080"` の代わりに `"*"` を使用してください（WAF が localhost URL を含むリクエストをブロックするため）
- `--dpop-required` — DPoP (Demonstration of Proof-of-Possession) トークンバインディングを有効化。SDK がブラウザ側で自動的に DPoP Proof を生成するため、万が一 API キーが漏洩しても第三者は利用できません
- `--policy` — 手順 4 で作成した XACML ポリシーを紐付けます

レスポンスに含まれる `key` の値を控えておいてください（`gdb_` で始まる文字列です）。

### 5. サンプルデータの作成（オプション）

`location`（GeoProperty）を持つエンティティを作成すると地図上に表示されます。

```bash
geonic entities create '{
  "id": "urn:ngsi-ld:Sensor:example-001",
  "type": "Sensor",
  "name": { "type": "Property", "value": "温度センサー A" },
  "temperature": { "type": "Property", "value": 22.5, "unitCode": "CEL" },
  "location": {
    "type": "GeoProperty",
    "value": { "type": "Point", "coordinates": [139.7671, 35.6812] }
  }
}'
```

## デプロイ

### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `VITE_GEONICDB_URL` | Yes | GeonicDB サーバーの URL（例: `https://geonicdb.geolonia.com`） |
| `VITE_GEONICDB_API_KEY` | Yes | 手順 5 で発行した API キー |
| `VITE_GEONICDB_TENANT` | Yes | テナント名 |
| `VITE_GEOLONIA_API_KEY` | No | Geolonia Maps の API キー |

### Vercel へのデプロイ

1. このリポジトリを GitHub にプッシュし、Vercel にインポート（フレームワーク: Vite が自動検出されます）
2. Vercel のプロジェクト設定で上記の環境変数を設定
3. デプロイ

### ローカルで確認

```bash
cp .env.example .env
# .env を編集して実際の値を設定

npm install
npm run dev       # 開発サーバー
npm run build     # プロダクションビルド
npm run preview   # ビルド結果のプレビュー
```

## 使い方

- トップページでエンティティタイプを選択
- 左側の Live Feed をクリックするとエンティティにフォーカス
- 地図上のマーカーをクリックするとプロパティ詳細をポップアップ表示
- WebSocket 接続中はリアルタイムでエンティティの追加・更新が反映
- 時系列データ（Temporal API）がある場合は自動的にスパークラインチャートで表示
