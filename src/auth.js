var AUTH_STORAGE_KEY = 'gdb-monitor-auth';

export function getStoredAuth() {
  try {
    var data = localStorage.getItem(AUTH_STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) { return null; }
}

export function storeAuth(auth) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function handleLogout() {
  clearAuth();
  location.href = location.pathname;
}

// GeonicDB SDK を動的にロードする
export function loadGeonicDBSDK(url) {
  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = url + '/sdk/v1/geonicdb.js';
    script.onload = resolve;
    script.onerror = function() { reject(new Error('GeonicDB SDK の読み込みに失敗しました')); };
    document.head.appendChild(script);
  });
}

// ログイン処理
export function handleLogin(email, password, tenant) {
  var geonicdbUrl = import.meta.env.VITE_GEONICDB_URL;
  var loginBtn = document.getElementById('login-btn');
  var errorEl = document.getElementById('login-error');
  loginBtn.disabled = true;
  loginBtn.textContent = 'ログイン中...';
  errorEl.textContent = '';

  var headers = { 'Content-Type': 'application/json' };
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
