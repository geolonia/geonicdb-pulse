/**
 * app.js — アプリケーションのオーケストレーション
 *
 * GeonicDB SDK を使ったリアルタイムモニターの実装。
 * SDK の API 呼び出し（db.request(), db.getEntities(), db.on(), db.subscribe(),
 * db.connect()）はすべてこのファイルに集約されており、サンプルコードとして
 * SDK の使い方が一目で分かるようになっている。
 *
 * 利用している GeonicDB 機能:
 * - NGSI-LD エンティティの取得（REST API）
 * - Temporal API による時系列データの取得
 * - WebSocket によるリアルタイムのエンティティ作成・更新通知
 * - Bearer JWT 認証とトークンの自動リフレッシュ
 */

import { clearAuth } from './auth.js';
import { flattenTemporal, findGeoProperty, getEntityName, showToast } from './entity.js';
import { initMap } from './map.js';
import { addFeedItem, initFeed, appendFeedItems } from './feed.js';

export function initApp(db, auth) {

// ============================================================
// エンティティタイプの選択
// ============================================================
// URL の ?type= パラメータでモニター対象のエンティティタイプを指定する。
// 未指定の場合はタイプ選択画面を表示し、NGSI-LD /types API から
// 登録済みタイプの一覧を取得してプルダウンに表示する。
var params = new URLSearchParams(location.search);
var ENTITY_TYPE = params.get('type') || null;

if (!ENTITY_TYPE) {
  document.getElementById('type-overlay').classList.remove('hidden');
  document.getElementById('type-form').onsubmit = function(e) {
    e.preventDefault();
    var val = document.getElementById('type-input').value;
    if (val) location.href = '?type=' + encodeURIComponent(val);
  };
  // NGSI-LD /types API でエンティティタイプ一覧を取得（SDK経由で認証ヘッダー自動付与）
  var select = document.getElementById('type-input');
  // db.request() はパース済み JSON を直接返す（Response オブジェクトではない）
  db.request('GET', '/ngsi-ld/v1/types')
  .then(function(types) {
    select.innerHTML = '<option value="" disabled selected>エンティティタイプを選択...</option>';
    types.forEach(function(t) {
      // typeName があればそれを使い、なければ URN の末尾を短縮名とする
      var name = t.typeName || t.id.split(':').pop();
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
  })
  .catch(function(err) {
    // 認証エラーの場合はログイン画面に戻す
    if (isAuthError(err)) { clearAuth(); location.href = location.pathname; return; }
    select.innerHTML = '<option value="" disabled selected>取得に失敗しました</option>';
  });
}

// Temporal API でデータが取得できたかどうかのフラグ
var TEMPORAL = false;

if (!ENTITY_TYPE) ENTITY_TYPE = '__none__';

// UI のタイトル表示を更新
document.title = (ENTITY_TYPE === '__none__' ? '' : ENTITY_TYPE + ' — ') + 'GeonicDB Pulse';

// ヘッダーのエンティティタイプ切り替えプルダウン
var appTypeSelect = document.getElementById('app-type-select');
if (ENTITY_TYPE !== '__none__') {
  // 現在のタイプを初期表示
  var currentOpt = document.createElement('option');
  currentOpt.value = ENTITY_TYPE;
  currentOpt.textContent = ENTITY_TYPE;
  currentOpt.selected = true;
  appTypeSelect.appendChild(currentOpt);

  // タイプ一覧を非同期で取得してプルダウンに追加（SDK経由で認証ヘッダー自動付与）
  // db.request() はパース済み JSON を直接返す（Response オブジェクトではない）
  db.request('GET', '/ngsi-ld/v1/types')
  .then(function(types) {
    appTypeSelect.innerHTML = '';
    types.forEach(function(t) {
      var name = t.typeName || t.id.split(':').pop();
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === ENTITY_TYPE) opt.selected = true;
      appTypeSelect.appendChild(opt);
    });
  })
  .catch(function() {});

  appTypeSelect.addEventListener('change', function() {
    location.href = '?type=' + encodeURIComponent(appTypeSelect.value);
  });
}

if (ENTITY_TYPE === '__none__') {
  document.querySelector('.header').style.display = 'none';
  document.querySelector('.side-panel').style.display = 'none';
}

// ============================================================
// エンティティデータの管理
// ============================================================
var entities = [];       // 現在のエンティティ一覧（REST API + WebSocket で更新）
var temporalRaw = {};    // Temporal API の生レスポンスを保持（ポップアップのスパークライン表示用）

// 地図の初期化（entities/temporalRaw/TEMPORAL への参照を渡す）
var ctx = { entities: entities, temporalRaw: temporalRaw, TEMPORAL: TEMPORAL };
var mapApi = initMap(ctx);
var map = mapApi.map;

// フィード操作に渡す依存オブジェクト
var feedDeps = {
  map: map,
  selectEntity: mapApi.selectEntity,
  getFlyZoom: mapApi.getFlyZoom,
  openPopupForEntity: mapApi.openPopupForEntity
};

// ============================================================
// 認証エラー判定
// ============================================================

/** エラーが認証エラー（401/403）かどうかを判定する */
function isAuthError(err) {
  if (!err) return false;
  var msg = err.message ? String(err.message) : '';
  return /unauthorized|invalid[_ ]token|token expired|expired token|Access denied/i.test(msg) ||
    err.status === 401 || err.status === 403;
}

// トークンリフレッシュ失敗時はセッション切れとしてログイン画面に戻す
db.on('error', function(err) {
  if (isAuthError(err)) {
    db.off('tokenRefresh');
    clearAuth();
    location.href = location.pathname;
  }
});

// ── Visibility change reconnect ──
// PWA がバックグラウンドから復帰した際、OS が WebSocket を切断している場合がある。
// onclose イベントが発火しないケースもあるため、フォアグラウンド復帰時に接続状態を確認し、
// 切断されていれば即座に再接続する。
var wsReconnecting = false;
db.on('connected', function() { wsReconnecting = false; });
db.on('close', function() { wsReconnecting = false; });

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return;
  if (db.isConnected()) return;
  if (!wsReconnecting) {
    wsReconnecting = true;
    db.reconnect();
  }
});

// ============================================================
// Temporal API によるデータ取得
// ============================================================
// NGSI-LD Temporal API は、エンティティの属性値の時系列データを返す。
// 各属性が配列形式（[{value, observedAt}, ...]）になっており、
// 通常のエンティティ形式に変換（フラット化）して地図表示に使う。

/**
 * NGSI-LD Temporal API からエンティティの時系列データを取得する。
 * SDK の request() を使うことで認証ヘッダーが自動付与される。
 *
 * Temporal API は時系列属性のみ返すため、location や name などの
 * 静的属性は通常の entities API から取得してマージする。
 */
function fetchTemporalEntities(type) {
  // db.request() はパース済み JSON を直接返す（Response オブジェクトではない）
  var temporalPromise = db.request('GET', '/ngsi-ld/v1/temporal/entities?type=' + encodeURIComponent(type) + '&limit=1000')
    .then(function(rawEntities) {
      if (!Array.isArray(rawEntities)) rawEntities = [];
      rawEntities.forEach(function(te) { temporalRaw[te.id] = te; });
      return rawEntities;
    });

  // sysAttrs を指定して createdAt/modifiedAt を取得する
  var entitiesPromise = db.request('GET', '/ngsi-ld/v1/entities?type=' + encodeURIComponent(type) + '&limit=1000&options=sysAttrs');

  return Promise.all([temporalPromise, entitiesPromise])
    .then(function(results) {
      var rawEntities = results[0];
      var currentEntities = results[1];

      // 通常エンティティを ID でルックアップできるようにする
      var entityMap = {};
      currentEntities.forEach(function(e) { entityMap[e.id] = e; });

      return rawEntities.map(function(te) {
        var flattened = flattenTemporal(te);
        var current = entityMap[flattened.id];
        if (current) {
          // temporal にない属性を通常エンティティから補完する
          Object.keys(current).forEach(function(key) {
            if (flattened[key] === undefined) {
              flattened[key] = current[key];
            }
          });
        }
        return flattened;
      });
    });
}

// ============================================================
// データ取得（ページネーション対応）
// ============================================================
// GeonicDB はデフォルトで最大 1,000 件を返す。それ以上のデータがある場合は
// offset パラメータで次のページを取得する。
// サイドバーのスクロールをトリガーに追加ページを取得し、地図とフィードの
// 表示件数を常に一致させる。

var PAGE_SIZE = 100;
var hasMore = true;
var paginationOffset = 0; // ページネーション専用の offset（WebSocket 追加分を含まない）

/** createdAt の降順でソート */
function sortByCreatedAt(arr) {
  arr.sort(function(a, b) {
    var ca = a.createdAt || '';
    var cb = b.createdAt || '';
    return ca > cb ? -1 : ca < cb ? 1 : 0;
  });
}

/** 全 entities が収まるように地図のビューを調整する */
function fitBoundsToEntities() {
  if (!entities.length) return;
  var bounds = new geolonia.LngLatBounds();
  entities.forEach(function(e) {
    var geo = findGeoProperty(e);
    if (geo && geo.value && geo.value.coordinates) {
      bounds.extend(geo.value.coordinates);
    }
  });
  if (!bounds.isEmpty()) {
    var isMobile = window.innerWidth <= 768;
    var padding = isMobile
      ? { top: 80, bottom: 60, left: 40, right: 40 }
      : { top: 80, bottom: 40, left: 300, right: 40 };
    map.fitBounds(bounds, { padding: padding, duration: 1000, maxZoom: 18 });
  }
}

/** 通常 entities API から1ページ取得する */
function fetchEntitiesPage(type, offset, limit) {
  return db.request('GET', '/ngsi-ld/v1/entities?type=' + encodeURIComponent(type)
    + '&limit=' + limit + '&offset=' + offset + '&options=sysAttrs');
}

/**
 * 次のページを API から取得し、entities 配列・地図・フィードを更新する。
 * サイドバーの無限スクロールから呼ばれるコールバック。
 */
function loadNextPage() {
  if (!hasMore) return Promise.resolve();
  return fetchEntitiesPage(ENTITY_TYPE, paginationOffset, PAGE_SIZE)
    .then(function(result) {
      if (!Array.isArray(result) || result.length === 0) {
        hasMore = false;
        return;
      }
      if (result.length < PAGE_SIZE) hasMore = false;
      paginationOffset += result.length;
      sortByCreatedAt(result);
      result.forEach(function(e) { entities.push(e); });
      appendFeedItems(result);
      if (mapApi.isMapReady()) mapApi.renderEntities(entities);
      // 追加分を含めて地図のビューを自動調整
      fitBoundsToEntities();
    });
}

// まず Temporal API を試し、時系列データがあればそれを使う。
// なければ通常の NGSI-LD entities API にページネーションでフォールバックする。
var dataPromise = (ENTITY_TYPE !== '__none__')
  ? fetchTemporalEntities(ENTITY_TYPE).then(function(result) {
      if (result.length > 0) {
        TEMPORAL = true;
        ctx.TEMPORAL = true;
        document.title = ENTITY_TYPE + ' (Temporal) — GeonicDB Pulse';
        // Temporal データはページネーション対象外（一括取得済み）
        hasMore = false;
        return result;
      }
      // Temporal データがなければ通常 API の最初のページを取得
      return fetchEntitiesPage(ENTITY_TYPE, 0, PAGE_SIZE);
    }).catch(function() {
      return fetchEntitiesPage(ENTITY_TYPE, 0, PAGE_SIZE);
    })
  : null;

dataPromise && dataPromise
  .then(function(result) {
    if (!Array.isArray(result)) result = [];
    sortByCreatedAt(result);
    // Temporal 以外の場合、返却件数が PAGE_SIZE 未満ならデータ終端
    if (!TEMPORAL && result.length < PAGE_SIZE) hasMore = false;

    entities.length = 0;
    result.forEach(function(e) { entities.push(e); });
    paginationOffset = result.length;

    if (entities.length === 0) {
      mapApi.showError(
        '"' + ENTITY_TYPE + '" が見つかりません',
        'このエンティティタイプのデータが存在しないか、タイプ名が正しくありません。'
      );
      return;
    }
    initFeed(feedDeps, loadNextPage);
    appendFeedItems(entities);
    if (mapApi.isMapReady()) { mapApi.renderEntities(entities); }
    else { mapApi.setPendingRender(entities); }
    // 初期データ取得完了後に WebSocket 接続を開始し、REST スナップショットとの競合を防ぐ
    db.subscribe({ entityTypes: [ENTITY_TYPE] });
    db.connect();
    fitBoundsToEntities();
  })
  .catch(function(err) {
    console.error('データ取得エラー:', err);
    if (isAuthError(err)) {
      clearAuth();
      location.href = location.pathname;
      return;
    }
    mapApi.showError(
      'データの取得に失敗しました',
      err.message || '接続エラーが発生しました。API キーやテナント設定を確認してください。'
    );
  });

// ============================================================
// WebSocket リアルタイム更新
// ============================================================
// GeonicDB の WebSocket は、subscribe() で指定したエンティティタイプの
// 作成（entityCreated）・更新（entityUpdated）イベントをリアルタイムに配信する。

var wsDot = document.getElementById('ws-dot');
var wsLabel = document.getElementById('ws-label');
wsDot.classList.add('connecting');

/**
 * WebSocket メッセージからエンティティオブジェクトを構築する。
 * メッセージ形式は SDK バージョンによって異なるため、両方に対応する。
 */
function parseWsEntity(msg) {
  // 形式1: { entity: {...} } — エンティティが直接含まれる
  if (msg.entity) return msg.entity;
  // 形式2: { entityId, entityType, data: {...} } — 属性差分のみ
  if (msg.data && msg.entityId) {
    var d = msg.data;
    var entity = { id: msg.entityId, type: msg.entityType };
    Object.keys(d).forEach(function(key) {
      var attr = d[key];
      if (attr.type === 'GeoProperty') {
        entity[key] = { type: 'GeoProperty', value: attr.value };
      } else {
        entity[key] = { type: 'Property', value: attr.value };
        if (attr.metadata) {
          if (attr.metadata.observedAt) entity[key].observedAt = attr.metadata.observedAt.value;
          if (attr.metadata.unitCode) entity[key].unitCode = attr.metadata.unitCode.value;
        }
      }
    });
    return entity;
  }
  return null;
}

/** エンティティの作成・更新イベントを処理し、UI を更新する */
function handleEntity(msg, isNew) {
  var entity = parseWsEntity(msg);
  if (!entity || entity.type !== ENTITY_TYPE) return;
  // エンティティ一覧を更新（新規は追加、既存は上書き）
  if (isNew) {
    entities.push(entity);
  } else {
    var found = false;
    for (var i = 0; i < entities.length; i++) {
      if (entities[i].id === entity.id) { entities[i] = entity; found = true; break; }
    }
    if (!found) entities.push(entity);
  }
  if (mapApi.isMapReady()) mapApi.renderEntities(entities);

  addFeedItem(entity, isNew, feedDeps);
  showToast(getEntityName(entity));

  // 更新されたエンティティの位置にカメラを移動
  var geo = findGeoProperty(entity);
  if (geo && geo.value) {
    map.flyTo({ center: geo.value.coordinates, zoom: mapApi.getFlyZoom(16), duration: 1500 });
  }
}

// WebSocket イベントリスナーの登録
db.on('entityCreated', function(msg) { handleEntity(msg, true); });
db.on('entityUpdated', function(msg) { handleEntity(msg, false); });

// WebSocket の接続は dataPromise の then() 内で開始する（REST との競合防止）

// 接続状態の UI 表示
var wsBadge = document.getElementById('ws-badge');

db.on('connected', function() {
  wsDot.className = 'ws-dot connected';
  wsLabel.textContent = 'LIVE';
  wsBadge.classList.remove('tappable');
});
db.on('disconnected', function() {
  wsDot.className = 'ws-dot';
  wsLabel.textContent = 'OFFLINE';
  wsBadge.classList.add('tappable');
});
db.on('reconnecting', function() {
  wsDot.className = 'ws-dot connecting';
  wsLabel.textContent = 'CONNECTING';
  wsBadge.classList.remove('tappable');
});

// OFFLINE 表示をタップして手動再接続
wsBadge.addEventListener('click', function() {
  if (!wsBadge.classList.contains('tappable')) return;
  wsBadge.classList.remove('tappable');
  db.reconnect();
});

} // end initApp
