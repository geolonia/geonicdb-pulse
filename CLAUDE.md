# GeonicDB Pulse

GeonicDB のエンティティをリアルタイムに地図上で可視化するモニターアプリ。

- **技術スタック**: Vanilla JS + Vite + Geolonia Maps (MapLibre GL) + GeonicDB SDK
- **認証**: Bearer JWT（email/password でログイン → accessToken + refreshToken）
- **リアルタイム**: WebSocket で entityCreated / entityUpdated イベントを受信
- **地図スタイル**: GSI Japan ベースのダークグレーモノクロ（`src/style.json`）
- **ホスティング**: GitHub Pages (`geolonia.github.io/geonicdb-pulse`)
- **GeonicDB サーバー**: `geonicdb.geolonia.com`（ソースは `/Users/miya/repos/geonicdb`、リポジトリは `geolonia/geonicdb`）

## 主要ファイル
- `index.html` — HTML構造（ログイン画面、地図、サイドパネル、オーバーレイ）
- `src/main.js` — エントリポイント（認証フロー、トークンリフレッシュ）
- `src/auth.js` — 認証管理（ログイン、リフレッシュ、ログアウト）
- `src/app.js` — アプリ本体（地図初期化、GeonicDB SDK、WebSocket、クラスタリング）
- `src/style.css` — UIスタイル（ダークグレーテーマ）
- `src/style.json` — 地図スタイル（GSIベースのダークグレーモノクロ）

# Development Rules

## ワークツリーとdevサーバー
- ファイル編集は必ずワークツリー上で行う
- devサーバーはそのワークツリーから起動する（`npm install` を忘れない）
- ワークツリーが変わったらサーバーを再起動する
- `pwd` で現在のディレクトリを常に意識する
