/**
 * auth.js — 認証管理
 *
 * GeonicDB は Bearer JWT 認証をサポートしている。
 * /auth/login に email + password を POST すると accessToken と refreshToken が返る。
 * マルチテナント環境では NGSILD-Tenant ヘッダーでテナントを指定する。
 */

var AUTH_STORAGE_KEY = 'gdb-monitor-auth';

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

/** 認証情報を削除 */
export function clearAuth() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
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
 * リフレッシュトークンを使ってアクセストークンを更新する。
 * ページリロード時に呼び出して常に新鮮なトークンでアプリを起動する。
 */
export function refreshAuth(auth) {
  var headers = { 'Content-Type': 'application/json' };
  if (auth.tenant) headers['NGSILD-Tenant'] = auth.tenant;

  return fetch(auth.url + '/auth/refresh', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ refreshToken: auth.refreshToken })
  })
  .then(function(res) {
    if (!res.ok) throw new Error('Token refresh failed');
    return res.json();
  })
  .then(function(data) {
    auth.accessToken = data.accessToken;
    auth.refreshToken = data.refreshToken;
    auth.expiresIn = data.expiresIn || 3600;
    storeAuth(auth);
    return auth;
  });
}

/**
 * GeonicDB /auth/login API を呼び出してログイン
 *
 * レスポンス例:
 *   { accessToken: "eyJ...", refreshToken: "eyJ...", expiresIn: 3600 }
 */
export function handleLogin(email, password, tenant) {
  var geonicdbUrl = import.meta.env.VITE_GEONICDB_URL;
  var loginBtn = document.getElementById('login-btn');
  var errorEl = document.getElementById('login-error');
  loginBtn.disabled = true;
  loginBtn.textContent = 'ログイン中...';
  errorEl.textContent = '';

  var headers = { 'Content-Type': 'application/json' };
  // マルチテナントの場合、NGSILD-Tenant ヘッダーでテナントを指定
  if (tenant) headers['NGSILD-Tenant'] = tenant;

  return fetch(geonicdbUrl + '/auth/login', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ email: email, password: password })
  })
  .then(function(res) {
    if (!res.ok) {
      return res.json().then(function(body) {
        throw new Error(body.message || body.description || body.detail || 'ログインに失敗しました');
      }).catch(function(e) {
        if (e.message && e.message !== 'ログインに失敗しました') throw e;
        throw new Error('ログインに失敗しました（' + res.status + '）');
      });
    }
    return res.json();
  })
  .then(function(data) {
    var auth = {
      email: email,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn || 3600,
      tenant: tenant || '',
      url: geonicdbUrl
    };
    if (!auth.accessToken) throw new Error('認証レスポンスにアクセストークンが含まれていません');
    storeAuth(auth);
    return auth;
  })
  .catch(function(err) {
    errorEl.textContent = err.message;
    loginBtn.disabled = false;
    loginBtn.textContent = 'ログイン';
    throw err;
  });
}
