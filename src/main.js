/**
 * main.js — エントリポイント
 *
 * 認証フロー:
 *   1. GeonicDB SDK を動的にロード（サーバーから /sdk/v1/geonicdb.js を取得）
 *   2. 保存済みトークンがあれば restoreSession() で復元、なければログインフォームを表示
 *   3. initApp(db, auth) でアプリを起動
 */

import './style.css';
import { getStoredAuth, clearAuth, handleLogout, loadGeonicDBSDK, restoreSession, loginWithSDK } from './auth.js';
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

// SDK をロードしてから認証フローを開始
loadGeonicDBSDK(geonicdbUrl).then(function() {
  var session = restoreSession(geonicdbUrl);

  if (session) {
    // ── 保存済みトークンで復元 ──
    // initApp 成功後にログイン UI を閉じる
    initApp(session.db, session.auth);
    document.getElementById('login-overlay').classList.add('hidden');
    removeLoginForm();
  } else {
    // ── ログインフォームを表示 ──
    document.getElementById('login-overlay').classList.remove('hidden');
    var auth = getStoredAuth();
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

      loginWithSDK(geonicdbUrl, email, password, tenant).then(function(session) {
        // initApp 成功後にログイン UI を閉じる
        initApp(session.db, session.auth);
        document.getElementById('login-overlay').classList.add('hidden');
        removeLoginForm();
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
