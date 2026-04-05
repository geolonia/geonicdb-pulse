# GeonicDB Pulse — サンプルアプリケーション

![GeonicDB Pulse](screenshot.png)

GeonicDB SDK を使った Vite ベースの Web アプリケーションのサンプルです。
GeonicDB に保存されたエンティティを地図上にリアルタイム表示します。

## 利用している GeonicDB SDK の機能

| SDK API | 説明 |
|---------|------|
| `new GeonicDB({ baseUrl, tenant })` | SDK インスタンスの作成 |
| `db.login(email, password)` | メール + パスワードでログイン（Bearer JWT） |
| `db.setCredentials({ token, ... })` | 保存済みトークンからセッションを復元 |
| `db.on('tokenRefresh', callback)` | トークン自動リフレッシュ時の通知 |
| `db.getEntities({ type, limit })` | NGSI-LD エンティティの一覧取得 |
| `db.request('GET', path)` | 汎用 REST API 呼び出し（パース済み JSON を返す） |
| `db.subscribe({ entityTypes })` | WebSocket でエンティティの変更を購読 |
| `db.connect()` / `db.reconnect()` | WebSocket 接続の開始・再接続 |
| `db.on('entityCreated', callback)` | エンティティ作成イベントの受信 |
| `db.on('entityUpdated', callback)` | エンティティ更新イベントの受信 |
| `db.on('connected', callback)` | WebSocket 接続状態の監視 |

## ファイル構成

```
index.html          HTML マークアップ
src/
  main.js           エントリポイント（SDK ロード・認証フロー）
  auth.js           認証情報の永続化（localStorage ヘルパー・SDK ローダー）
  app.js            SDK 呼び出しのオーケストレーション（データ取得・WebSocket・エラー処理）
  map.js            地図の初期化・レイヤー描画・ポップアップ・コンパスボタン
  feed.js           サイドパネルのライブフィード
  entity.js         NGSI-LD エンティティのユーティリティ関数
  sparkline.js      SVG スパークライン生成
  style.css         スタイル
vite.config.js      Vite 設定
.env.example        環境変数のテンプレート
```

### SDK の使い方を知りたい場合

`main.js` と `app.js` を読んでください。SDK の API（`db.login()`, `db.getEntities()`, `db.subscribe()` など）がラッパーなしで直接呼び出されています。

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して GeonicDB サーバーの URL を設定します:

```
VITE_GEONICDB_URL=https://geonicdb.geolonia.com
VITE_GEOLONIA_API_KEY=YOUR-API-KEY    # Geolonia Maps の API キー（任意）
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザでログイン画面が表示されます。GeonicDB のメールアドレスとパスワードを入力してログインしてください。マルチテナント環境の場合はテナント名も入力します。

## サンプルデータの作成

[geonic CLI](https://www.npmjs.com/package/@geolonia/geonicdb-cli) を使って、`location`（GeoProperty）を持つエンティティを作成すると地図上に表示されます。

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

## ビルド

```bash
npm run build     # dist/ にプロダクションビルドを出力
npm run preview   # ビルド結果のプレビュー
```

## デプロイ

### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `VITE_GEONICDB_URL` | Yes | GeonicDB サーバーの URL |
| `VITE_GEOLONIA_API_KEY` | No | Geolonia Maps の API キー |

### Vercel

1. リポジトリを GitHub にプッシュし、Vercel にインポート
2. 環境変数を設定
3. デプロイ（Vite が自動検出されます）

## 使い方

1. ログイン画面でメールアドレス・パスワード（・テナント名）を入力
2. エンティティタイプを選択して「Open」
3. 地図上のマーカーをクリックするとプロパティ詳細をポップアップ表示
4. 左側の Live Feed をクリック（またはキーボード操作）するとエンティティにフォーカス
5. WebSocket 接続中はリアルタイムでエンティティの追加・更新が反映
6. 時系列データがある場合はスパークラインチャートで自動表示
7. 地図を回転させるとコンパスボタンが表示され、タップで北向きに戻る

## ライセンス

MIT
