import { storeAuth, clearAuth } from './auth.js';

// ============================================================
// アプリケーション初期化（認証後に呼び出し）
// ============================================================
export function initApp(auth) {

// ── 設定 ──
var params = new URLSearchParams(location.search);
var ENTITY_TYPE = params.get('type') || null;

// タイプ未指定 → 選択画面を表示
if (!ENTITY_TYPE) {
  document.getElementById('type-overlay').classList.remove('hidden');
  document.getElementById('type-form').onsubmit = function(e) {
    e.preventDefault();
    var val = document.getElementById('type-input').value;
    if (val) location.href = '?type=' + encodeURIComponent(val);
  };
  // エンティティタイプ一覧を取得してプルダウンに設定
  var select = document.getElementById('type-input');
  fetch(auth.url + '/ngsi-ld/v1/types', {
    headers: { 'Authorization': 'Bearer ' + auth.accessToken }
  })
  .then(function(res) { return res.json(); })
  .then(function(types) {
    select.innerHTML = '<option value="" disabled selected>エンティティタイプを選択...</option>';
    types.forEach(function(t) {
      var name = t.typeName || t.id.split(':').pop();
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
  })
  .catch(function() {
    select.innerHTML = '<option value="" disabled selected>取得に失敗しました</option>';
  });
}

var TEMPORAL = false;

if (!ENTITY_TYPE) ENTITY_TYPE = '__none__';

document.getElementById('app-title').textContent = ENTITY_TYPE === '__none__' ? 'GeonicDB Monitor' : ENTITY_TYPE;
document.getElementById('panel-title').textContent = ENTITY_TYPE === '__none__' ? '-' : ENTITY_TYPE;
document.title = (ENTITY_TYPE === '__none__' ? '' : ENTITY_TYPE + ' — ') + 'GeonicDB Monitor';
if (ENTITY_TYPE === '__none__') {
  document.querySelector('.header').style.display = 'none';
  document.querySelector('.side-panel').style.display = 'none';
}

// ── 地図初期化 ──
var map = new geolonia.Map({
  container: 'map',
  style: 'geolonia/midnight',
  center: [139.7414, 35.6581],
  zoom: 10,
  minZoom: 2,
  maxZoom: 16,
  renderWorldCopies: false
});

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

// ── GeonicDB クライアント初期化 ──
var db = new GeonicDB({
  baseUrl: auth.url,
  tenant: auth.tenant
});
// SDK ネイティブの Bearer JWT サポートを利用
db._token = auth.accessToken;
db._tokenExpiry = Date.now() + 3500 * 1000;
db._tokenType = 'Bearer';
db._refreshToken = auth.refreshToken;

// トークン更新時に localStorage を同期
var _origEnsureToken = GeonicDB.prototype._ensureToken.bind(db);
db._ensureToken = function() {
  return _origEnsureToken().then(function(token) {
    auth.accessToken = db._token;
    auth.refreshToken = db._refreshToken;
    storeAuth(auth);
    return token;
  }).catch(function(err) {
    clearAuth();
    location.href = location.pathname;
    throw err;
  });
};

// Bearer JWT で WebSocket 接続（SDK デフォルトの DPoP PoW 待ちをスキップ）
db.connect = function() {
  var self = this;
  self._wsIntentionalClose = false;
  self._reconnectAttempts = 0;
  return self._ensureToken().then(function(token) {
    return self._discoverWsEndpoint().then(function(endpoint) {
      return new Promise(function(resolve, reject) {
        var wsUrl = endpoint;
        if (self._tenant) {
          wsUrl += (endpoint.indexOf('?') === -1 ? '?' : '&') +
            'tenant=' + encodeURIComponent(self._tenant);
        }
        var ws = new WebSocket(wsUrl, ['access_token', token]);
        self._ws = ws;
        ws.onopen = function() {
          if (self._ws !== ws) return;
          self._reconnectAttempts = 0;
          if (self._subscription) ws.send(JSON.stringify(self._subscription));
          self._emit('open');
          self._emit('connected');
          resolve();
        };
        ws.onmessage = function(event) {
          if (self._ws !== ws) return;
          var msg;
          try { msg = JSON.parse(event.data); } catch (e) { return; }
          if (msg.type === 'pong') return;
          if (msg.type === 'error') { self._emit('error', new Error(msg.message)); return; }
          self._emit(msg.type, msg);
          self._emit('message', msg);
        };
        ws.onclose = function(event) {
          if (self._ws !== ws) return;
          self._clearTimers();
          if (self._wsIntentionalClose) { self._emit('close', event); return; }
          self._emit('close', event);
          self._emit('disconnected');
          self._reconnect();
        };
        ws.onerror = function(err) {
          if (self._ws !== ws) return;
          self._emit('error', err);
          if (ws.readyState !== WebSocket.OPEN) reject(new Error('WebSocket connection failed'));
        };
      });
    });
  }).catch(function(err) {
    self._emit('error', err);
  });
};

var entities = [];
var temporalRaw = {};

// ── Temporal ヘルパー ──
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

function fetchTemporalEntities(type) {
  return db._request('GET', '/ngsi-ld/v1/temporal/entities?type=' + encodeURIComponent(type) + '&limit=1000')
    .then(function(res) {
      if (!res.ok) return res.json().then(function(e) { throw new Error(e.detail || 'Temporal query failed'); });
      return res.json();
    })
    .then(function(rawEntities) {
      if (!Array.isArray(rawEntities)) rawEntities = [];
      rawEntities.forEach(function(te) { temporalRaw[te.id] = te; });
      return rawEntities.map(flattenTemporal);
    });
}

// ── SVG スパークライン ──
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

// ── ユーティリティ ──
function formatTime(isoString) {
  var d = new Date(isoString);
  return String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0');
}

function showToast(message) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 3500);
}

function getEntityName(e) {
  if (e.name && e.name.value) return e.name.value;
  if (e.epicenter && e.epicenter.value) return e.epicenter.value;
  return e.id.split(':').pop();
}

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

// ── ライブフィード ──
var feedList = document.getElementById('feed-list');

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
        '<div class="feed-meta">loaded</div>' +
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

// ── GeoJSON ──
var selectedEntityId = null;

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

// ── 統計 ──
var latestTime = null;

function updateStats(list) {
  document.getElementById('stat-count').textContent = list.length;
  document.getElementById('stat-latest').textContent =
    latestTime ? formatTime(latestTime) : '--:--';
}

// ── レイヤー描画 ──
function renderEntities(list) {
  var geojson = buildGeoJSON(list);
  if (map.getSource('entities')) {
    map.getSource('entities').setData(geojson);
  } else {
    map.addSource('entities', { type: 'geojson', data: geojson });

    map.addLayer({
      id: 'entity-glow',
      type: 'circle',
      source: 'entities',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 32, 24],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#ff1744', '#00b0ff'],
        'circle-opacity': ['case', ['==', ['get', 'selected'], 1], 0.15, 0.08],
        'circle-blur': 1
      }
    });
    map.addLayer({
      id: 'entity-pulse',
      type: 'circle',
      source: 'entities',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 18, 14],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#ff1744', '#00b0ff'],
        'circle-opacity': ['case', ['==', ['get', 'selected'], 1], 0.2, 0.12]
      }
    });
    map.addLayer({
      id: 'entity-points',
      type: 'circle',
      source: 'entities',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], 1], 8, 6],
        'circle-color': ['case', ['==', ['get', 'selected'], 1], '#ff5252', '#00e5ff'],
        'circle-opacity': 0.9,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0.5)']
      }
    });
    map.addLayer({
      id: 'entity-labels',
      type: 'symbol',
      source: 'entities',
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': ['Noto Sans CJK JP Bold'],
        'text-offset': [0, -1.5],
        'text-allow-overlap': false,
        'text-max-width': 10
      },
      paint: {
        'text-color': 'rgba(224,247,250,0.8)',
        'text-halo-color': 'rgba(6,10,23,0.85)',
        'text-halo-width': 1.5
      }
    });
  }
  updateStats(list);
}

// ── ポップアップ ──
var popup = new geolonia.Popup({ offset: 15, closeButton: true, closeOnClick: false, maxWidth: '420px' });
var sparkColors = ['#00e5ff', '#76ff03', '#ffab00', '#ff4081', '#7c4dff', '#00e676'];

popup.on('close', function() { selectEntity(null); });

function openPopupForEntity(entityId) {
  var entity = entities.find(function(e) { return e.id === entityId; });
  if (!entity) return;
  var geo = findGeoProperty(entity);
  if (!geo || !geo.value) return;
  var coords = geo.value.coordinates;
  var name = getEntityName(entity);
  var contentHtml = '';

  if (TEMPORAL && temporalRaw[entityId]) {
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
    '<div style="font-size:15px;font-weight:600;color:#00e5ff;margin-bottom:4px">' + name + '</div>' +
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

// ── マップ準備 ──
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
  if (pendingRender) {
    renderEntities(pendingRender);
    pendingRender = null;
  }
}
map.on('load', onMapReady);
map.on('style.load', function() { if (!mapReady) onMapReady(); });

// ── データ取得 ──
if (ENTITY_TYPE === '__none__') {
  document.getElementById('stat-count').textContent = '-';
  document.getElementById('stat-latest').textContent = '--:--';
}

var dataPromise = (ENTITY_TYPE !== '__none__')
  ? fetchTemporalEntities(ENTITY_TYPE).then(function(result) {
      if (result.length > 0) {
        TEMPORAL = true;
        document.getElementById('app-title').textContent = ENTITY_TYPE + ' (Temporal)';
        document.title = ENTITY_TYPE + ' (Temporal) — GeonicDB Monitor';
        return result;
      }
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
    latestTime = new Date().toISOString();
    initFeed(entities);
    if (mapReady) { renderEntities(entities); }
    else { pendingRender = entities; updateStats(entities); }
    if (entities.length) {
      var bounds = new geolonia.LngLatBounds();
      entities.forEach(function(e) {
        var geo = findGeoProperty(e);
        if (geo && geo.value && geo.value.coordinates) {
          bounds.extend(geo.value.coordinates);
        }
      });
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: { top: 80, bottom: 40, left: 300, right: 40 }, duration: 1000, maxZoom: 16 });
      }
    }
  })
  .catch(function(err) {
    console.error('データ取得エラー:', err);
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

// ── WebSocket ──
var wsDot = document.getElementById('ws-dot');
var wsLabel = document.getElementById('ws-label');
wsDot.classList.add('connecting');

function parseWsEntity(msg) {
  if (msg.entity) return msg.entity;
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

function handleEntity(msg, isNew) {
  var entity = parseWsEntity(msg);
  if (!entity || entity.type !== ENTITY_TYPE) return;
  if (isNew) {
    entities.push(entity);
  } else {
    var found = false;
    for (var i = 0; i < entities.length; i++) {
      if (entities[i].id === entity.id) { entities[i] = entity; found = true; break; }
    }
    if (!found) entities.push(entity);
  }
  latestTime = new Date().toISOString();
  if (mapReady) renderEntities(entities);
  else updateStats(entities);

  addFeedItem(entity, isNew);
  showToast(getEntityName(entity));

  var geo = findGeoProperty(entity);
  if (geo && geo.value) {
    map.flyTo({ center: geo.value.coordinates, zoom: getFlyZoom(16), duration: 1500 });
  }
}

db.on('entityCreated', function(msg) { handleEntity(msg, true); });
db.on('entityUpdated', function(msg) { handleEntity(msg, false); });

if (ENTITY_TYPE !== '__none__') {
  db.subscribe({ entityTypes: [ENTITY_TYPE] });
  db.connect();
}

db.on('connected', function() {
  wsDot.className = 'ws-dot connected';
  wsLabel.textContent = 'LIVE';
});
db.on('disconnected', function() {
  wsDot.className = 'ws-dot';
  wsLabel.textContent = 'OFFLINE';
});
db.on('reconnecting', function() {
  wsDot.className = 'ws-dot connecting';
  wsLabel.textContent = 'RECONNECTING';
});
db.on('error', function(err) {
  if (err && /token|unauthorized|expired|invalid/i.test(err.message)) {
    clearAuth();
    location.href = location.pathname;
  }
});

} // end initApp
