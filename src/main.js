/**
 * main.js — エントリポイント
 *
 * 認証フロー:
 *   1. 保存済みトークンが Bearer なら db.setCredentials() で復元
 *      (DPoP-bound トークンは秘密鍵がページリロードで失われるため復元不可)
 *   2. なければログインフォームで db.login(..., { dpop: true }) を呼ぶ
 *      (RFC 9449 DPoP 送信者制約セッション、XSS 漏洩耐性のため)
 *   3. initApp(db, auth) でアプリを起動
 */

import './style.css';
import GeonicDB from '@geolonia/geonicdb-sdk';
import { getStoredAuth, storeAuth, clearAuth, handleLogout } from './auth.js';
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

// 認証フローを開始
var auth = getStoredAuth();

// DPoP-bound セッション (RFC 9449) はクライアントの非抽出 ECDSA 秘密鍵に
// 紐付くトークンを発行する。秘密鍵はメモリ上 (Web Crypto の non-extractable
// CryptoKey) にしか存在せず、ページリロードで失われる。
// 残った accessToken / refreshToken も鍵なしでは proof を作れず使用不能
// なので、潔くクリアしてログイン画面に戻す。これが「鍵を持つセッションだけが
// 正当」という DPoP の本質に即した挙動。
if (auth && auth.tokenType === 'DPoP' && auth.accessToken) {
  clearAuth();
  auth = getStoredAuth();
}

if (auth && auth.accessToken && auth.tenant) {
  // ── 保存済み Bearer トークンで復元 ──
  // (DPoP は上で弾かれているのでここに来るのは Bearer のみ)
  // 環境変数が変更された場合に備え、常に現在の URL を使用する
  auth.url = geonicdbUrl;

  var db = new GeonicDB({ baseUrl: geonicdbUrl, tenant: auth.tenant });

  // SDK にトークンをセットすれば、期限切れ時に自動でリフレッシュされる
  // expiresAt（絶対時刻）から残り秒数を算出して SDK に渡す。
  // 既に期限切れの場合は expiresIn: 0 で即座にリフレッシュさせる。
  var remainingSec = auth.expiresAt
    ? Math.max(0, Math.floor((auth.expiresAt - Date.now()) / 1000))
    : 0;
  db.setCredentials({
    token: auth.accessToken,
    tokenType: 'Bearer',
    expiresIn: remainingSec,
    refreshToken: auth.refreshToken,
  });

  // SDK がトークンをリフレッシュした際に localStorage と同期する
  db.on('tokenRefresh', function(creds) {
    auth.accessToken = creds.token;
    if (creds.refreshToken !== undefined) auth.refreshToken = creds.refreshToken;
    if (creds.expiresIn !== undefined) auth.expiresAt = Date.now() + creds.expiresIn * 1000;
    storeAuth(auth);
  });

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

    // SDK の db.login() でログイン
    // { dpop: true } で /auth/dpop-bind を経由して DPoP 送信者制約セッション
    // (RFC 9449) に交換する。SDK 0.9.0 以降。トークンが localStorage から
    // XSS で漏洩しても、SDK インスタンスの非抽出秘密鍵がなければ再利用不可。
    var db = new GeonicDB({ baseUrl: geonicdbUrl, tenant: tenant });
    db.login(email, password, { dpop: true }).then(function(data) {
      var auth = {
        email: email,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + data.expiresIn * 1000,
        tokenType: data.tokenType,  // 'DPoP' — 次回ロード時の復元判定に使う
        tenant: tenant,
        url: geonicdbUrl,
      };
      storeAuth(auth);

      // SDK がトークンをリフレッシュした際に localStorage と同期する
      db.on('tokenRefresh', function(creds) {
        auth.accessToken = creds.token;
        if (creds.tokenType !== undefined) auth.tokenType = creds.tokenType;
        if (creds.refreshToken !== undefined) auth.refreshToken = creds.refreshToken;
        if (creds.expiresIn !== undefined) auth.expiresAt = Date.now() + creds.expiresIn * 1000;
        storeAuth(auth);
      });

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
