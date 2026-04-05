/**
 * main.js — エントリポイント
 *
 * 認証フロー:
 *   1. GeonicDB SDK を動的にロード（サーバーから /sdk/v1/geonicdb.js を取得）
 *   2. SDK インスタンスを作成
 *   3. 保存済みトークンがあれば setCredentials() で復元、なければログインフォームを表示
 *   4. initApp(db) でアプリを起動
 */

import './style.css';
import { getStoredAuth, storeAuth, clearAuth, handleLogout, loadGeonicDBSDK } from './auth.js';
import { initApp } from './app.js';

window.handleLogout = handleLogout;

var geonicdbUrl = import.meta.env.VITE_GEONICDB_URL;
if (!geonicdbUrl) {
  document.getElementById('login-error').textContent = 'VITE_GEONICDB_URL が設定されていません';
  throw new Error('VITE_GEONICDB_URL is not configured');
}

// サイドパネルのモバイル用トグル
(function() {
  var toggle = document.getElementById('panel-toggle');
  var panel = document.getElementById('side-panel');
  var overlay = document.getElementById('panel-overlay');
  var icon = document.getElementById('panel-toggle-icon');

  function openPanel() {
    panel.classList.add('open');
    overlay.classList.add('visible');
    icon.innerHTML = '&#10005;';
  }
  function closePanel() {
    panel.classList.remove('open');
    overlay.classList.remove('visible');
    icon.innerHTML = '&#9776;';
  }

  toggle.onclick = function() {
    panel.classList.contains('open') ? closePanel() : openPanel();
  };
  overlay.onclick = closePanel;
})();

/** ログインフォームをDOMから削除してiOSのパスワード自動入力ポップアップを防止 */
function removeLoginForm() {
  var form = document.getElementById('login-form');
  if (form) form.remove();
}

/**
 * SDK がトークンをリフレッシュした際に localStorage と同期するリスナーを登録する。
 * db.login() や db.setCredentials() の後に呼び出す。
 */
function syncTokenRefresh(db, auth) {
  db.on('tokenRefresh', function(creds) {
    auth.accessToken = creds.token;
    if (creds.refreshToken !== undefined) auth.refreshToken = creds.refreshToken;
    if (creds.expiresIn !== undefined) auth.expiresIn = creds.expiresIn;
    storeAuth(auth);
  });
}

// SDK をロードしてから認証フローを開始
loadGeonicDBSDK(geonicdbUrl).then(function() {
  var auth = getStoredAuth();

  if (auth && auth.accessToken) {
    // ── 保存済みトークンで復元 ──
    // 環境変数が変更された場合に備え、常に現在の URL を使用する
    auth.url = geonicdbUrl;
    // SDK にトークンをセットすれば、期限切れ時に自動でリフレッシュされる
    var db = new GeonicDB({ baseUrl: geonicdbUrl, tenant: auth.tenant });
    db.setCredentials({
      token: auth.accessToken,
      tokenType: 'Bearer',
      expiresIn: auth.expiresIn,
      refreshToken: auth.refreshToken,
    });
    syncTokenRefresh(db, auth);
    document.getElementById('login-overlay').classList.add('hidden');
    removeLoginForm();
    initApp(db, auth);
  } else {
    // ── ログインフォームを表示 ──
    document.getElementById('login-overlay').classList.remove('hidden');
    if (auth && auth.tenant) {
      document.getElementById('login-tenant').value = auth.tenant;
    }
    document.getElementById('login-form').onsubmit = function(e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      var tenant = document.getElementById('login-tenant').value.trim();
      if (!tenant || !email || !password) return;

      var loginBtn = document.getElementById('login-btn');
      var errorEl = document.getElementById('login-error');
      loginBtn.disabled = true;
      loginBtn.textContent = 'ログイン中...';
      errorEl.textContent = '';

      // SDK の login() でログイン（認証ヘッダーやトークン管理は SDK が担当）
      var db = new GeonicDB({ baseUrl: geonicdbUrl, tenant: tenant });
      db.login(email, password).then(function(data) {
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
        document.getElementById('login-overlay').classList.add('hidden');
        removeLoginForm();
        initApp(db, auth);
      }).catch(function(err) {
        errorEl.textContent = err.message || 'ログインに失敗しました';
        loginBtn.disabled = false;
        loginBtn.textContent = 'ログイン';
      });
    };
  }
}).catch(function(err) {
  console.error(err);
  document.getElementById('login-error').textContent = err.message;
});
