import './style.css';
import { getStoredAuth, clearAuth, handleLogin, handleLogout, loadGeonicDBSDK } from './auth.js';
import { initApp } from './app.js';

// グローバルに公開（HTML の onclick から参照）
window.handleLogout = handleLogout;

// ── 起動時チェック ──
(function() {
  var auth = getStoredAuth();
  if (auth && auth.accessToken) {
    document.getElementById('login-overlay').classList.add('hidden');
    loadGeonicDBSDK(auth.url).then(function() {
      initApp(auth);
    }).catch(function(err) {
      console.error(err);
      clearAuth();
      document.getElementById('login-overlay').classList.remove('hidden');
      document.getElementById('login-error').textContent = 'セッションが無効です。再度ログインしてください。';
    });
  } else {
    document.getElementById('login-overlay').classList.remove('hidden');
  }

  document.getElementById('login-form').onsubmit = function(e) {
    e.preventDefault();
    var email = document.getElementById('login-email').value.trim();
    var password = document.getElementById('login-password').value;
    var tenant = document.getElementById('login-tenant').value.trim();
    if (email && password) {
      handleLogin(email, password, tenant).then(function(auth) {
        return loadGeonicDBSDK(auth.url).then(function() {
          document.getElementById('login-overlay').classList.add('hidden');
          initApp(auth);
        });
      }).catch(function() {
        // エラーは handleLogin 内で表示済み
      });
    }
  };
})();
