/**
 * auth.js — 認証情報の永続化
 *
 * GeonicDB SDK の認証情報を localStorage で永続化するためのヘルパー。
 * ログインやトークンリフレッシュは SDK が担当する。
 */

var AUTH_STORAGE_KEY = 'gdb-pulse-auth';

/** localStorage から認証情報を復元 */
export function getStoredAuth() {
  try {
    var data = localStorage.getItem(AUTH_STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) { return null; }
}

/** 認証情報を localStorage に保存 */
export function storeAuth(auth) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

/** 認証情報を削除（テナント名は保持して次回ログイン時に復元する） */
export function clearAuth() {
  var data = getStoredAuth();
  if (data && data.tenant) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ tenant: data.tenant }));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

/** ログアウト — 認証クリア後にトップへリダイレクト */
export function handleLogout() {
  clearAuth();
  location.href = location.pathname;
}

/**
 * GeonicDB SDK を動的にロード
 * SDK は GeonicDB サーバー自体が /sdk/v1/geonicdb.js で配信しており、
 * ロードするとグローバルに GeonicDB クラスが登録される。
 */
export function loadGeonicDBSDK(url) {
  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = url + '/sdk/v1/geonicdb.js';
    script.onload = resolve;
    script.onerror = function() { reject(new Error('GeonicDB SDK の読み込みに失敗しました')); };
    document.head.appendChild(script);
  });
}
