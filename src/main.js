/**
 * main.js — エントリポイント
 *
 * 認証フロー:
 *   1. localStorage に保存済みの認証情報があれば復元
 *   2. GeonicDB SDK を動的にロード（サーバーから /sdk/v1/geonicdb.js を取得）
 *   3. initApp() でアプリを起動
 *   未認証の場合はログインフォームを表示する
 */

import './style.css';
import { getStoredAuth, clearAuth, refreshAuth, handleLogin, handleLogout, loadGeonicDBSDK } from './auth.js';
import { initApp } from './app.js';

window.handleLogout = handleLogout;

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

(function() {
  var auth = getStoredAuth();

  /** ログインフォームをDOMから削除してiOSのパスワード自動入力ポップアップを防止 */
  function removeLoginForm() {
    var form = document.getElementById('login-form');
    if (form) form.remove();
  }

  if (auth && auth.accessToken) {
    document.getElementById('login-overlay').classList.add('hidden');
    removeLoginForm();
    // リロード時にトークンをリフレッシュしてから SDK をロード・アプリを起動
    refreshAuth(auth).then(function() {
      return loadGeonicDBSDK(auth.url).then(function() {
        initApp(auth);
      });
    }).catch(function(err) {
      console.error(err);
      clearAuth();
      // フォームは既にDOMから削除済みなのでリロードしてログイン画面を再構築
      location.href = location.pathname;
    });
  } else {
    document.getElementById('login-overlay').classList.remove('hidden');
    // 前回のテナント名を復元
    if (auth && auth.tenant) {
      document.getElementById('login-tenant').value = auth.tenant;
    }
    document.getElementById('login-form').onsubmit = function(e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      var tenant = document.getElementById('login-tenant').value.trim();
      if (tenant && email && password) {
        handleLogin(email, password, tenant).then(function(auth) {
          return loadGeonicDBSDK(auth.url).then(function() {
            document.getElementById('login-overlay').classList.add('hidden');
            removeLoginForm();
            initApp(auth);
          });
        }).catch(function() {
          // エラーは handleLogin 内で UI に表示済み
        });
      }
    };
  }
})();
