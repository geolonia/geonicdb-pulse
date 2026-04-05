/**
 * auth.js — 認証管理
 *
 * GeonicDB SDK を使った認証フローを管理する。
 * - ログイン: SDK の db.login() を使用
 * - トークン復元: SDK の db.setCredentials() で localStorage から復元
 * - トークンリフレッシュ: SDK の tokenRefresh イベントで localStorage と同期
 */

var AUTH_STORAGE_KEY = 'gdb-pulse-auth';

/** localStorage から認証情報を復元 */
export function getStoredAuth() {
  try {
    var data = localStorage.getItem(AUTH_STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.warn('認証情報の復元に失敗しました:', e);
    return null;
  }
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

/**
 * SDK がトークンをリフレッシュした際に localStorage と同期するリスナーを登録する。
 */
function syncTokenRefresh(db, auth) {
  db.on('tokenRefresh', function(creds) {
    auth.accessToken = creds.token;
    if (creds.refreshToken !== undefined) auth.refreshToken = creds.refreshToken;
    if (creds.expiresIn !== undefined) auth.expiresIn = creds.expiresIn;
    storeAuth(auth);
  });
}

/**
 * 保存済みトークンから SDK セッションを復元する。
 * SDK にトークンをセットすれば、期限切れ時に自動でリフレッシュされる。
 * @returns {{ db: GeonicDB, auth: object } | null}
 */
export function restoreSession(geonicdbUrl) {
  var auth = getStoredAuth();
  if (!auth || !auth.accessToken) return null;

  // 環境変数が変更された場合に備え、常に現在の URL を使用する
  auth.url = geonicdbUrl;
  var db = new GeonicDB({ baseUrl: geonicdbUrl, tenant: auth.tenant });
  db.setCredentials({
    token: auth.accessToken,
    tokenType: 'Bearer',
    expiresIn: auth.expiresIn,
    refreshToken: auth.refreshToken,
  });
  syncTokenRefresh(db, auth);
  return { db: db, auth: auth };
}

/**
 * SDK の login() でログインし、認証情報を localStorage に保存する。
 * @returns {Promise<{ db: GeonicDB, auth: object }>}
 */
export function loginWithSDK(geonicdbUrl, email, password, tenant) {
  var db = new GeonicDB({ baseUrl: geonicdbUrl, tenant: tenant });
  return db.login(email, password).then(function(data) {
    var auth = {
      email: email,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      tenant: tenant,
      url: geonicdbUrl,
    };
    storeAuth(auth);
    syncTokenRefresh(db, auth);
    return { db: db, auth: auth };
  });
}
