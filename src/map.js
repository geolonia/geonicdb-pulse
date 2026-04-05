/**
 * map.js — 地図の初期化とレンダリング
 *
 * Geolonia Maps (MapLibre GL) を使った地図の初期化、
 * エンティティの GeoJSON 変換、クラスタリングレイヤー、
 * ポップアップ表示、選択状態の管理を行う。
 */

import { findGeoProperty, getEntityName, getDisplayProperties } from './entity.js';
import { buildSparkline } from './sparkline.js';
import mapStyle from './style.json';

// スプライトURLをデプロイ先に合わせて動的に設定
mapStyle.sprite = location.origin + import.meta.env.BASE_URL + 'sprites/gsi';

// ============================================================
// 地図の状態
// ============================================================

var map = null;
var popup = null;
var selectedEntityId = null;
var mapReady = false;
var pendingRender = null;
var userZoom = null;
var sparkColors = ['#00e5ff', '#76ff03', '#ffab00', '#ff4081', '#7c4dff', '#00e676'];

// ============================================================
// 地図の初期化
// ============================================================

/**
 * 地図を初期化し、操作に必要な関数群を返す。
 * @param {object} ctx - { entities, temporalRaw, TEMPORAL } への参照を持つコンテキスト
 * @returns {object} 地図操作用の関数群
 */
export function initMap(ctx) {
  map = new geolonia.Map({
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

  // コンパスボタン — 現在の回転角度を表示し、タップで北向き（0度）に戻す
  // GeolocateControl の後に追加することで、その上に配置される
  var compassBtn = document.createElement('button');
  compassBtn.className = 'compass-btn';
  compassBtn.setAttribute('aria-label', '北向きに戻す');
  compassBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><polygon points="12,2 16,14 12,11 8,14" fill="#e84130"/><polygon points="12,22 8,14 12,17 16,14" fill="#666"/></svg>';
  compassBtn.style.display = 'none';
  compassBtn.onclick = function() {
    map.easeTo({ bearing: 0, duration: 300 });
  };
  map.on('rotate', function() {
    var bearing = map.getBearing();
    if (Math.abs(bearing) < 0.5) {
      compassBtn.style.display = 'none';
    } else {
      compassBtn.style.display = 'flex';
      compassBtn.querySelector('svg').style.transform = 'rotate(' + (-bearing) + 'deg)';
    }
  });
  map.addControl({
    onAdd: function() {
      var container = document.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      container.appendChild(compassBtn);
      return container;
    },
    onRemove: function() {}
  }, 'bottom-right');

  // ユーザーが手動でズームした場合、そのレベルを記憶して flyTo で使う
  map.on('zoomend', function() {
    if (!map.isMoving || !map._zooming) {
      userZoom = Math.round(map.getZoom());
    }
  });
  map.on('wheel', function() { setTimeout(function() { userZoom = Math.round(map.getZoom()); }, 300); });
  map.on('dragstart', function() { selectEntity(null); popup.remove(); });

  popup = new geolonia.Popup({ offset: 15, closeButton: true, closeOnClick: false, maxWidth: '420px' });
  popup.on('close', function() { selectEntity(null); });

  // マップ準備完了ハンドラ
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
  // GeoJSON 変換と選択管理
  // ============================================================

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
      map.getSource('entities').setData(buildGeoJSON(ctx.entities));
    }
    var feedList = document.getElementById('feed-list');
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

  /**
   * エンティティの詳細ポップアップを表示する。
   * Temporal データがある場合はスパークライン（時系列グラフ）を表示し、
   * 通常データの場合はプロパティのキー・バリュー一覧を表示する。
   */
  /** DOM 要素を生成するヘルパー */
  function el(tag, style, children) {
    var node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (typeof children === 'string') { node.textContent = children; }
    else if (Array.isArray(children)) { children.forEach(function(c) { if (c) node.appendChild(c); }); }
    return node;
  }

  function openPopupForEntity(entityId) {
    var entity = ctx.entities.find(function(e) { return e.id === entityId; });
    if (!entity) return;
    var geo = findGeoProperty(entity);
    if (!geo || !geo.value) return;
    var coords = geo.value.coordinates;
    var name = getEntityName(entity);

    var container = el('div', 'min-width:220px');
    container.appendChild(el('div', 'font-size:15px;font-weight:600;color:#ffffff;margin-bottom:4px', name));
    container.appendChild(el('div', 'font-size:10px;color:rgba(255,255,255,0.25);margin-bottom:10px;font-family:JetBrains Mono,monospace;word-break:break-all', entityId));

    if (ctx.TEMPORAL && ctx.temporalRaw[entityId]) {
      // Temporal モード: 各属性の時系列データをスパークラインで表示
      var raw = ctx.temporalRaw[entityId];
      var skip = ['id', 'type', '@context', 'location', 'position', 'geo', 'name'];
      var ci = 0;
      Object.keys(raw).forEach(function(key) {
        if (skip.indexOf(key) !== -1) return;
        var arr = raw[key];
        if (!Array.isArray(arr) || arr.length < 2) return;
        var color = sparkColors[ci % sparkColors.length]; ci++;
        var unit = arr[0].unitCode || '';
        var row = el('div', 'margin-bottom:8px');
        var header = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:2px', [
          el('span', 'color:rgba(255,255,255,0.5);font-size:11px;font-weight:500', key),
          unit ? el('span', 'color:rgba(255,255,255,0.25);font-size:9px;font-family:JetBrains Mono,monospace', unit) : null
        ]);
        row.appendChild(header);
        // スパークライン SVG は数値データから生成されるため安全
        var svgHtml = buildSparkline(arr, color);
        if (svgHtml) {
          var svgWrapper = document.createElement('div');
          svgWrapper.innerHTML = svgHtml;
          row.appendChild(svgWrapper);
        }
        container.appendChild(row);
      });
    } else {
      // 通常モード: プロパティのキー・バリュー一覧
      getDisplayProperties(entity).forEach(function(prop) {
        var valStr = String(prop.value);
        var isLong = valStr.length > 20;
        var row = el('div', 'display:flex;' + (isLong ? 'flex-direction:column;gap:2px' : 'justify-content:space-between;align-items:baseline;gap:12px') + ';padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)');
        row.appendChild(el('span', 'color:rgba(255,255,255,0.4);font-size:11px;flex-shrink:0;white-space:nowrap', prop.key));
        var valEl = el('span', 'color:#e0f7fa;font-size:11px;font-family:JetBrains Mono,monospace;' + (isLong ? '' : 'text-align:right'));
        valEl.textContent = valStr;
        if (prop.unit) {
          var unitEl = el('span', 'color:rgba(255,255,255,0.3)', ' ' + prop.unit);
          valEl.appendChild(unitEl);
        }
        row.appendChild(valEl);
        container.appendChild(row);
      });
    }

    popup.setLngLat(coords).setDOMContent(container).addTo(map);
    selectEntity(entityId);
  }

  function showPopup(ev) {
    var f = ev.features[0];
    openPopupForEntity(f.properties.id);
  }

  // ============================================================
  // エラー表示
  // ============================================================

  /** データ取得失敗時のエラーオーバーレイを表示する */
  function showError(title, detail) {
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-detail').textContent = detail;
    document.getElementById('error-overlay').classList.remove('hidden');
    document.querySelector('.header').style.display = 'none';
    document.querySelector('.side-panel').style.display = 'none';
  }

  function getFlyZoom(defaultZoom) {
    return userZoom !== null ? userZoom : defaultZoom;
  }

  /** 地図の準備ができているかどうか */
  function isMapReady() { return mapReady; }

  /** 地図ロード前にデータが届いた場合、ロード後に描画するためにデータを保持する */
  function setPendingRender(data) { pendingRender = data; }

  return {
    map: map,
    renderEntities: renderEntities,
    selectEntity: selectEntity,
    openPopupForEntity: openPopupForEntity,
    getFlyZoom: getFlyZoom,
    isMapReady: isMapReady,
    setPendingRender: setPendingRender,
    showError: showError
  };
}
