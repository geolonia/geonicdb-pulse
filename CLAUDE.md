# GeonicDB Pulse

GeonicDB のエンティティをリアルタイムに地図上で可視化するモニターアプリ。

## プロジェクトの趣旨

このアプリは **GeonicDB SDK のサンプルプロジェクト**である。主な目的は2つ:

1. **開発者向けリファレンス実装** — GeonicDB SDK を使ったアプリケーションの作り方を、実動するコードで示す。SDK の API（認証、エンティティ取得、WebSocket、Temporal API など）がコード上で直接見える形を維持する。ヘルパー関数やラッパーで SDK 呼び出しを隠さない。
2. **SDK へのフィードバック** — サンプルアプリを実際に開発・運用する中で発見した SDK の不足・改善点を `geolonia/geonicdb` に issue としてフィードバックする。SDK の使いにくさやAPIの欠落はサンプル側で回避するのではなく、SDK 側の改善を促す。

### コードを書く際の判断基準

- **サンプルとしての明快さ** > プロダクション品質の堅牢性
- SDK の API がそのまま読めることを最優先する
- bot レビュー（CodeRabbit 等）の指摘はプロジェクトの趣旨に照らして取捨選択する
- SDK に不足しているメソッドやイベントを見つけたら `geolonia/geonicdb` に issue を立てる

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
