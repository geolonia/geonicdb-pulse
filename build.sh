#!/bin/bash
set -euo pipefail

# ============================================================
# ビルドスクリプト: 環境変数をHTMLに注入して dist/ に出力
# ============================================================

# 必須環境変数のチェック
: "${GEONICDB_URL:?環境変数 GEONICDB_URL が未設定です}"
: "${GEONICDB_API_KEY:?環境変数 GEONICDB_API_KEY が未設定です}"
: "${GEONICDB_TENANT:?環境変数 GEONICDB_TENANT が未設定です}"

# GEOLONIA_API_KEY はオプション（デフォルト: YOUR-API-KEY）
GEOLONIA_API_KEY="${GEOLONIA_API_KEY:-YOUR-API-KEY}"

echo "=== Building GeonicDB Monitor ==="
echo "  GEONICDB_URL:    ${GEONICDB_URL}"
echo "  GEONICDB_TENANT: ${GEONICDB_TENANT}"
echo "  GEOLONIA_API_KEY: ${GEOLONIA_API_KEY:0:8}..."

# 出力ディレクトリ
rm -rf dist
mkdir -p dist

# プレースホルダーを環境変数で置換
sed \
  -e "s|__GEONICDB_URL__|${GEONICDB_URL}|g" \
  -e "s|__GEONICDB_API_KEY__|${GEONICDB_API_KEY}|g" \
  -e "s|__GEONICDB_TENANT__|${GEONICDB_TENANT}|g" \
  -e "s|__GEOLONIA_API_KEY__|${GEOLONIA_API_KEY}|g" \
  public/index.html > dist/index.html

echo "=== Build complete: dist/index.html ==="
