/**
 * app.js — アプリケーション本体
 *
 * GeonicDB SDK を使ったリアルタイムモニターの実装。
 * 以下の GeonicDB 機能を利用している:
 *
 * - NGSI-LD エンティティの取得（REST API）
 * - Temporal API による時系列データの取得
 * - WebSocket によるリアルタイムのエンティティ作成・更新通知
 * - Bearer JWT 認証とトークンの自動リフレッシュ
 */

import { storeAuth, clearAuth } from './auth.js';
import mapStyle from './style.json';

// スプライトURLをデプロイ先に合わせて動的に設定
mapStyle.sprite = location.origin + import.meta.env.BASE_URL + 'sprites/gsi';

export function initApp(auth) {

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
  // NGSI-LD /types API でエンティティタイプ一覧を取得
  var select = document.getElementById('type-input');
  fetch(auth.url + '/ngsi-ld/v1/types', {
    headers: { 'Authorization': 'Bearer ' + auth.accessToken }
  })
  .then(function(res) {
    if (res.status === 401 || res.status === 403) {
      clearAuth();
      location.href = location.pathname;
      throw new Error('Unauthorized');
    }
    return res.json();
  })
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
    if (err.message === 'Unauthorized') return;
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

  // タイプ一覧を非同期で取得してプルダウンに追加
  fetch(auth.url + '/ngsi-ld/v1/types', {
    headers: { 'Authorization': 'Bearer ' + auth.accessToken }
  })
  .then(function(res) { return res.json(); })
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
// Geolonia Maps 初期化
// ============================================================
var map = new geolonia.Map({
  container: 'map',
  style: mapStyle,
  center: [139.7414, 35.6581],
  zoom: 10,
  minZoom: 2,
  maxZoom: 16,
  renderWorldCopies: false,
  dragRotate: false,
  touchPitch: false,
  pitchWithRotate: false
});


// モバイルではアトリビューションを畳む
if (window.innerWidth <= 768) {
  map.on('load', function() {
    var mapEl = document.getElementById('map');
    if (mapEl.geoloniaMap && mapEl.geoloniaMap._controls) {
      mapEl.geoloniaMap._controls.forEach(function(ctrl) {
        if (ctrl._toggleAttribution) ctrl._toggleAttribution();
      });
    }
  });
}

map.addControl(new geolonia.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true
}), 'bottom-right');

// ユーザーが手動でズームした場合、そのレベルを記憶して flyTo で使う
var userZoom = null;
map.on('zoomend', function() {
  if (!map.isMoving || !map._zooming) {
    userZoom = Math.round(map.getZoom());
  }
});
map.on('wheel', function() { setTimeout(function() { userZoom = Math.round(map.getZoom()); }, 300); });
map.on('dragstart', function() { selectEntity(null); popup.remove(); });

function getFlyZoom(defaultZoom) {
  return userZoom !== null ? userZoom : defaultZoom;
}

// ============================================================
// GeonicDB クライアント初期化
// ============================================================
// GeonicDB SDK のインスタンスを作成し、Bearer JWT トークンをセットする。
// SDK はデフォルトで DPoP (Proof of Work) 認証を使うが、
// ログイン API で取得した Bearer トークンを直接セットすることで DPoP をスキップできる。
var db = new GeonicDB({
  baseUrl: auth.url,
  tenant: auth.tenant
});

// Bearer JWT トークンを SDK 公開 API でセット（DPoP フローをスキップ）
db.setCredentials({
  token: auth.accessToken,
  tokenType: 'Bearer',
  expiresIn: auth.expiresIn,
  refreshToken: auth.refreshToken,
});

// SDK がトークンをリフレッシュした際に localStorage と同期する
db.onTokenRefresh(function(creds) {
  auth.accessToken = creds.token;
  if (creds.refreshToken !== undefined) auth.refreshToken = creds.refreshToken;
  if (creds.expiresIn !== undefined) auth.expiresIn = creds.expiresIn;
  storeAuth(auth);
});

// トークンリフレッシュ失敗時はセッション切れとしてログイン画面に戻す
db.on('error', function(err) {
  if (!err) return;
  var msg = err.message ? String(err.message) : '';
  var isAuthError =
    /unauthorized|invalid[_ ]token|token expired|expired token/i.test(msg) ||
    err.status === 401 || err.status === 403;
  if (isAuthError) {
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
// エンティティデータの管理
// ============================================================
var entities = [];       // 現在のエンティティ一覧（REST API + WebSocket で更新）
var temporalRaw = {};    // Temporal API の生レスポンスを保持（ポップアップのスパークライン表示用）

// ── Temporal API ──
// NGSI-LD Temporal API は、エンティティの属性値の時系列データを返す。
// 各属性が配列形式（[{value, observedAt}, ...]）になっており、
// 通常のエンティティ形式に変換（フラット化）して地図表示に使う。

/**
 * Temporal エンティティを通常のエンティティ形式にフラット化する。
 * 配列の先頭が最新値（API は降順で返す）。
 */
function flattenTemporal(te) {
  var entity = { id: te.id, type: te.type };
  Object.keys(te).forEach(function(key) {
    if (key === 'id' || key === 'type' || key === '@context') return;
    var attr = te[key];
    if (!Array.isArray(attr) || attr.length === 0) { entity[key] = attr; return; }
    var latest = attr[0];
    entity[key] = {
      type: latest.type || 'Property',
      value: latest.value,
      observedAt: latest.observedAt,
      unitCode: latest.unitCode
    };
  });
  return entity;
}

/**
 * NGSI-LD Temporal API からエンティティの時系列データを取得する。
 * SDK の request() を使うことで認証ヘッダーが自動付与される。
 *
 * Temporal API は時系列属性のみ返すため、location や name などの
 * 静的属性は通常の entities API から取得してマージする。
 */
function fetchTemporalEntities(type) {
  var temporalPromise = db.request('GET', '/ngsi-ld/v1/temporal/entities?type=' + encodeURIComponent(type) + '&limit=1000')
    .then(function(res) {
      if (!res.ok) return res.json().then(function(e) { throw new Error(e.detail || 'Temporal query failed'); });
      return res.json();
    })
    .then(function(rawEntities) {
      if (!Array.isArray(rawEntities)) rawEntities = [];
      rawEntities.forEach(function(te) { temporalRaw[te.id] = te; });
      return rawEntities;
    });

  var entitiesPromise = db.getEntities({ type: type, limit: 1000 });

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
// SVG スパークライン生成
// ============================================================
// Temporal データのポップアップ内に表示するミニ折れ線グラフ。
// 外部ライブラリを使わず、SVG を直接組み立てる。

function buildSparkline(dataPoints, color) {
  if (!dataPoints || dataPoints.length < 2) return '';
  var sorted = dataPoints.slice().sort(function(a, b) {
    return new Date(a.observedAt) - new Date(b.observedAt);
  });
  var values = sorted.map(function(d) { return d.value; });
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  var range = max - min || 1;
  var w = 200, h = 48, pad = 4;
  var points = values.map(function(v, i) {
    var x = pad + (i / (values.length - 1)) * (w - pad * 2);
    var y = h - pad - ((v - min) / range) * (h - pad * 2);
    return x + ',' + y;
  });
  var first = sorted[0].observedAt ? new Date(sorted[0].observedAt) : null;
  var last = sorted[sorted.length - 1].observedAt ? new Date(sorted[sorted.length - 1].observedAt) : null;
  var tl = first ? String(first.getUTCHours()).padStart(2,'0') + ':00' : '';
  var tr = last ? String(last.getUTCHours()).padStart(2,'0') + ':00' : '';
  var latestVal = values[values.length - 1];

  return '<svg width="' + w + '" height="' + (h + 14) + '" style="display:block;margin:4px 0">' +
    '<defs><linearGradient id="g-' + color.replace('#','') + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.3"/>' +
    '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
    '</linearGradient></defs>' +
    '<polygon points="' + pad + ',' + h + ' ' + points.join(' ') + ' ' + (w - pad) + ',' + h + '" fill="url(#g-' + color.replace('#','') + ')"/>' +
    '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + points[points.length - 1].split(',')[0] + '" cy="' + points[points.length - 1].split(',')[1] + '" r="3" fill="' + color + '"/>' +
    '<text x="' + pad + '" y="' + (h + 12) + '" font-size="9" fill="rgba(255,255,255,0.3)" font-family="JetBrains Mono,monospace">' + tl + '</text>' +
    '<text x="' + (w - pad) + '" y="' + (h + 12) + '" font-size="9" fill="rgba(255,255,255,0.3)" font-family="JetBrains Mono,monospace" text-anchor="end">' + tr + '</text>' +
    '<text x="' + (w - pad) + '" y="12" font-size="11" fill="' + color + '" font-family="JetBrains Mono,monospace" text-anchor="end" font-weight="600">' + latestVal + '</text>' +
    '</svg>';
}

// ============================================================
// NGSI-LD エンティティのユーティリティ
// ============================================================

/** ISO 8601 文字列を HH:MM:SS 形式に変換 */
function formatTime(isoString) {
  var d = new Date(isoString);
  return String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0');
}

/** 画面右下にトースト通知を表示 */
function showToast(message) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 3500);
}

/**
 * エンティティの表示名を取得する。
 * NGSI-LD エンティティの name 属性、なければ ID の末尾を使う。
 */
function getEntityName(e) {
  if (e.name && e.name.value) return e.name.value;
  if (e.epicenter && e.epicenter.value) return e.epicenter.value;
  return e.id.split(':').pop();
}

/**
 * エンティティから GeoProperty を検索する。
 * NGSI-LD では位置情報は GeoProperty 型で表現される。
 * よく使われる属性名（location, position, geo 等）を優先的にチェックし、
 * 見つからなければ全属性を走査する。
 */
function findGeoProperty(e) {
  var geoKeys = ['location', 'position', 'geo', 'coordinates', 'place'];
  for (var i = 0; i < geoKeys.length; i++) {
    if (e[geoKeys[i]] && e[geoKeys[i]].value) return e[geoKeys[i]];
  }
  var keys = Object.keys(e);
  for (var j = 0; j < keys.length; j++) {
    var attr = e[keys[j]];
    if (attr && attr.type === 'GeoProperty' && attr.value) return attr;
  }
  return null;
}

/**
 * エンティティのポップアップに表示するプロパティ一覧を取得する。
 * GeoProperty やメタ属性（id, type, @context）は除外する。
 */
function getDisplayProperties(e) {
  var skip = ['id', 'type', '@context', 'location', 'position', 'geo', 'coordinates', 'place'];
  var props = [];
  Object.keys(e).forEach(function(key) {
    if (skip.indexOf(key) !== -1) return;
    var attr = e[key];
    if (!attr || typeof attr !== 'object') return;
    if (attr.type === 'GeoProperty') return;
    var val = attr.value !== undefined ? attr.value : attr;
    if (typeof val === 'object') val = JSON.stringify(val);
    props.push({ key: key, value: val, unit: attr.unitCode || '' });
  });
  return props;
}

// ============================================================
// ライブフィード（サイドパネル）
// ============================================================

var feedList = document.getElementById('feed-list');

/** WebSocket から受信したエンティティをフィードに追加（最新が上、最大50件） */
function addFeedItem(entity, isNew) {
  var name = getEntityName(entity);
  var time = formatTime(new Date().toISOString());
  var item = document.createElement('div');
  item.className = 'feed-item' + (isNew ? ' new' : '');
  item.setAttribute('data-id', entity.id);
  item.innerHTML =
    '<div class="feed-marker"></div>' +
    '<div class="feed-info">' +
      '<div class="feed-name">' + name + '</div>' +
      '<div class="feed-meta">' + time + '</div>' +
    '</div>';
  item.onclick = function() {
    var geo = findGeoProperty(entity);
    if (geo && geo.value) {
      selectEntity(entity.id);
      map.flyTo({ center: geo.value.coordinates, zoom: getFlyZoom(16), duration: 1200 });
      setTimeout(function() { openPopupForEntity(entity.id); }, 1300);
    }
  };
  feedList.insertBefore(item, feedList.firstChild);
  while (feedList.children.length > 50) {
    feedList.removeChild(feedList.lastChild);
  }
  setTimeout(function() { item.classList.remove('new'); }, 2000);
}

/** 初期データ（REST API から取得）でフィードを初期化（直近20件を表示） */
function initFeed(list) {
  feedList.innerHTML = '';
  list.slice(-20).reverse().forEach(function(e) {
    var name = getEntityName(e);
    var item = document.createElement('div');
    item.className = 'feed-item';
    item.setAttribute('data-id', e.id);
    item.innerHTML =
      '<div class="feed-marker"></div>' +
      '<div class="feed-info">' +
        '<div class="feed-name">' + name + '</div>' +
        '<div class="feed-meta">' + e.id + '</div>' +
      '</div>';
    item.onclick = (function(ent) {
      return function() {
        var geo = findGeoProperty(ent);
        if (geo && geo.value) {
          selectEntity(ent.id);
          map.flyTo({ center: geo.value.coordinates, zoom: getFlyZoom(16), duration: 1200 });
          setTimeout(function() { openPopupForEntity(ent.id); }, 1300);
        }
      };
    })(e);
    feedList.appendChild(item);
  });
}

// ============================================================
// GeoJSON 変換と地図上の選択管理
// ============================================================

var selectedEntityId = null;

/**
 * NGSI-LD エンティティの配列を GeoJSON FeatureCollection に変換する。
 * 各 Feature の geometry には GeoProperty の値をそのまま使用する
 * （NGSI-LD の GeoProperty は GeoJSON 形式で格納されている）。
 */
function buildGeoJSON(list) {
  return {
    type: 'FeatureCollection',
    features: list.map(function(e) {
      var geo = findGeoProperty(e);
      if (!geo) return null;
      return {
        type: 'Feature', id: e.id,
        geometry: geo.value,
        properties: { id: e.id, name: getEntityName(e), entityType: e.type, selected: e.id === selectedEntityId ? 1 : 0 }
      };
    }).filter(Boolean)
  };
}

/** 地図上のエンティティを選択（ハイライト + フィードのスクロール） */
function selectEntity(id) {
  selectedEntityId = id;
  if (map.getSource('entities')) {
    map.getSource('entities').setData(buildGeoJSON(entities));
  }
  var items = feedList.querySelectorAll('.feed-item');
  for (var i = 0; i < items.length; i++) {
    if (id && items[i].getAttribute('data-id') === id) {
      items[i].classList.add('active');
      items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      items[i].classList.remove('active');
    }
  }
}

// ============================================================
// 地図レイヤー描画
// ============================================================
// MapLibre GL の data-driven styling を使い、選択状態に応じて
// ポイントの色・サイズを動的に切り替えている。

function renderEntities(list) {
  var geojson = buildGeoJSON(list);
  if (map.getSource('entities')) {
    // ソースが既にある場合はデータのみ更新
    map.getSource('entities').setData(geojson);
  } else {
    // 初回はソースとレイヤーを作成（クラスタリング有効）
    map.addSource('entities', {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50
    });

    // クラスタ円レイヤー（外側のグロー）
    map.addLayer({
      id: 'entity-cluster-glow',
      type: 'circle',
      source: 'entities',
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 28, 10, 36, 50, 44],
        'circle-color': 'rgba(0, 180, 255, 0.1)',
        'circle-blur': 0.8
      }
    });

    // クラスタ円レイヤー（メイン）
    map.addLayer({
      id: 'entity-clusters',
      type: 'circle',
      source: 'entities',
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 50, 32],
        'circle-color': 'rgba(0, 180, 255, 0.25)',
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(0, 200, 255, 0.6)'
      }
    });

    // クラスタ数ラベル
    map.addLayer({
      id: 'entity-cluster-count',
      type: 'symbol',
      source: 'entities',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 13,
        'text-font': ['Noto Sans CJK JP Bold']
      },
      paint: {
        'text-color': '#ffffff'
      }
    });

    // グローレイヤー（背景のぼかし円）— 非クラスタのみ
    map.addLayer({
      id: 'entity-glow',
      type: 'circle',
      source: 'entities',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 32, 24],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#ff1744', '#00b0ff'],
        'circle-opacity': ['case', ['==', ['get', 'selected'], 1], 0.15, 0.08],
        'circle-blur': 1
      }
    });
    // パルスレイヤー（中間の円）— 非クラスタのみ
    map.addLayer({
      id: 'entity-pulse',
      type: 'circle',
      source: 'entities',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 18, 14],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#ff1744', '#00b0ff'],
        'circle-opacity': ['case', ['==', ['get', 'selected'], 1], 0.2, 0.12]
      }
    });
    // ポイントレイヤー（メインの円）— 非クラスタのみ
    map.addLayer({
      id: 'entity-points',
      type: 'circle',
      source: 'entities',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 8, 6],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#ff5252', '#00e5ff'],
        'circle-opacity': 0.9,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0.5)']
      }
    });
    // ラベルレイヤー（エンティティ名）— 非クラスタのみ
    map.addLayer({
      id: 'entity-labels',
      type: 'symbol',
      source: 'entities',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': ['Noto Sans CJK JP Bold'],
        'text-offset': [0, -1.5],
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-max-width': 10,
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 1.2
      },
      paint: {
        'text-color': 'rgba(224,247,250,0.8)',
        'text-halo-color': 'rgba(6,10,23,0.85)',
        'text-halo-width': 1.5
      }
    });

    // クラスタをクリックしたらズームイン
    map.on('click', 'entity-clusters', function(e) {
      var features = map.queryRenderedFeatures(e.point, { layers: ['entity-clusters'] });
      var clusterId = features[0].properties.cluster_id;
      map.getSource('entities').getClusterExpansionZoom(clusterId, function(err, zoom) {
        if (err) return;
        map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
      });
    });
    map.on('mouseenter', 'entity-clusters', function() { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'entity-clusters', function() { map.getCanvas().style.cursor = ''; });
  }
}

// ============================================================
// ポップアップ
// ============================================================

var popup = new geolonia.Popup({ offset: 15, closeButton: true, closeOnClick: false, maxWidth: '420px' });
var sparkColors = ['#00e5ff', '#76ff03', '#ffab00', '#ff4081', '#7c4dff', '#00e676'];

popup.on('close', function() { selectEntity(null); });

/**
 * エンティティの詳細ポップアップを表示する。
 * Temporal データがある場合はスパークライン（時系列グラフ）を表示し、
 * 通常データの場合はプロパティのキー・バリュー一覧を表示する。
 */
function openPopupForEntity(entityId) {
  var entity = entities.find(function(e) { return e.id === entityId; });
  if (!entity) return;
  var geo = findGeoProperty(entity);
  if (!geo || !geo.value) return;
  var coords = geo.value.coordinates;
  var name = getEntityName(entity);
  var contentHtml = '';

  if (TEMPORAL && temporalRaw[entityId]) {
    // Temporal モード: 各属性の時系列データをスパークラインで表示
    var raw = temporalRaw[entityId];
    var skip = ['id', 'type', '@context', 'location', 'position', 'geo', 'name'];
    var ci = 0;
    Object.keys(raw).forEach(function(key) {
      if (skip.indexOf(key) !== -1) return;
      var arr = raw[key];
      if (!Array.isArray(arr) || arr.length < 2) return;
      var color = sparkColors[ci % sparkColors.length]; ci++;
      var unit = arr[0].unitCode || '';
      contentHtml +=
        '<div style="margin-bottom:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">' +
        '<span style="color:rgba(255,255,255,0.5);font-size:11px;font-weight:500">' + key + '</span>' +
        (unit ? '<span style="color:rgba(255,255,255,0.25);font-size:9px;font-family:JetBrains Mono,monospace">' + unit + '</span>' : '') +
        '</div>' +
        buildSparkline(arr, color) +
        '</div>';
    });
  } else {
    // 通常モード: プロパティのキー・バリュー一覧
    getDisplayProperties(entity).forEach(function(prop) {
      var unit = prop.unit ? ' <span style="color:rgba(255,255,255,0.3)">' + prop.unit + '</span>' : '';
      var valStr = String(prop.value);
      var isLong = valStr.length > 20;
      contentHtml +=
        '<div style="display:flex;' + (isLong ? 'flex-direction:column;gap:2px' : 'justify-content:space-between;align-items:baseline;gap:12px') + ';padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">' +
        '<span style="color:rgba(255,255,255,0.4);font-size:11px;flex-shrink:0;white-space:nowrap">' + prop.key + '</span>' +
        '<span style="color:#e0f7fa;font-size:11px;font-family:JetBrains Mono,monospace;' + (isLong ? '' : 'text-align:right') + '">' + prop.value + unit + '</span>' +
        '</div>';
    });
  }
  var html =
    '<div style="min-width:220px">' +
    '<div style="font-size:15px;font-weight:600;color:#ffffff;margin-bottom:4px">' + name + '</div>' +
    '<div style="font-size:10px;color:rgba(255,255,255,0.25);margin-bottom:10px;font-family:JetBrains Mono,monospace;word-break:break-all">' + entityId + '</div>' +
    (contentHtml ? '<div>' + contentHtml + '</div>' : '') +
    '</div>';
  popup.setLngLat(coords).setHTML(html).addTo(map);
  selectEntity(entityId);
}

function showPopup(ev) {
  var f = ev.features[0];
  openPopupForEntity(f.properties.id);
}

// ============================================================
// マップ準備完了ハンドラ
// ============================================================

var mapReady = false;
var pendingRender = null;

function onMapReady() {
  mapReady = true;
  if (map.getLayer('road_shield')) {
    map.setLayoutProperty('road_shield', 'visibility', 'none');
  }
  map.on('click', 'entity-points', showPopup);
  map.on('mouseenter', 'entity-points', function() { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'entity-points', function() { map.getCanvas().style.cursor = ''; });
  // データ取得が地図ロードより先に完了していた場合、ここで描画する
  if (pendingRender) {
    renderEntities(pendingRender);
    pendingRender = null;
  }
}
map.on('load', onMapReady);
map.on('style.load', function() { if (!mapReady) onMapReady(); });

// ============================================================
// データ取得
// ============================================================
// まず Temporal API を試し、時系列データがあればそれを使う。
// なければ通常の NGSI-LD entities API にフォールバックする。
// SDK の db.getEntities() は内部で認証ヘッダーを自動付与する。

var dataPromise = (ENTITY_TYPE !== '__none__')
  ? fetchTemporalEntities(ENTITY_TYPE).then(function(result) {
      if (result.length > 0) {
        TEMPORAL = true;
        document.title = ENTITY_TYPE + ' (Temporal) — GeonicDB Pulse';
        return result;
      }
      // Temporal データがなければ通常 API にフォールバック
      return db.getEntities({ type: ENTITY_TYPE, limit: 1000 });
    }).catch(function() {
      return db.getEntities({ type: ENTITY_TYPE, limit: 1000 });
    })
  : null;

function showError(title, detail) {
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-detail').textContent = detail;
  document.getElementById('error-overlay').classList.remove('hidden');
  document.querySelector('.header').style.display = 'none';
  document.querySelector('.side-panel').style.display = 'none';
}

dataPromise && dataPromise
  .then(function(result) {
    entities = result;
    if (entities.length === 0) {
      showError(
        '"' + ENTITY_TYPE + '" が見つかりません',
        'このエンティティタイプのデータが存在しないか、タイプ名が正しくありません。'
      );
      return;
    }
    initFeed(entities);
    if (mapReady) { renderEntities(entities); }
    else { pendingRender = entities; }
    // 全エンティティが収まるように地図のビューを自動調整
    if (entities.length) {
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
        map.fitBounds(bounds, { padding: padding, duration: 1000, maxZoom: 16 });
      }
    }
  })
  .catch(function(err) {
    console.error('データ取得エラー:', err);
    // 認証エラーの場合はログイン画面に戻す
    if (/Access denied|Unauthorized|token/i.test(err.message)) {
      clearAuth();
      location.href = location.pathname;
      return;
    }
    showError(
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
  if (mapReady) renderEntities(entities);

  addFeedItem(entity, isNew);
  showToast(getEntityName(entity));

  // 更新されたエンティティの位置にカメラを移動
  var geo = findGeoProperty(entity);
  if (geo && geo.value) {
    map.flyTo({ center: geo.value.coordinates, zoom: getFlyZoom(16), duration: 1500 });
  }
}

// WebSocket イベントリスナーの登録
db.on('entityCreated', function(msg) { handleEntity(msg, true); });
db.on('entityUpdated', function(msg) { handleEntity(msg, false); });

// エンティティタイプが選択されている場合、WebSocket で購読して接続
if (ENTITY_TYPE !== '__none__') {
  db.subscribe({ entityTypes: [ENTITY_TYPE] });
  db.connect();
}

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
