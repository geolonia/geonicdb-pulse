/**
 * feed.js — サイドパネルのライブフィード
 *
 * WebSocket から受信したエンティティの更新を時系列で表示するフィード。
 * 各アイテムをクリック（またはキーボード操作）すると地図上の該当エンティティにフライ＆ポップアップ表示する。
 */

import { getEntityName, findGeoProperty, formatTime, formatDateTime } from './entity.js';

var feedList = null;

/** feedList 要素を取得（初回呼び出し時にキャッシュ） */
function getFeedList() {
  if (!feedList) feedList = document.getElementById('feed-list');
  return feedList;
}

/** フィード項目の DOM を組み立てる（textContent でエスケープ） */
function buildFeedItem(name, meta, dates) {
  var item = document.createElement('div');
  item.className = 'feed-item';
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');

  var marker = document.createElement('div');
  marker.className = 'feed-marker';
  item.appendChild(marker);

  var info = document.createElement('div');
  info.className = 'feed-info';

  var nameEl = document.createElement('div');
  nameEl.className = 'feed-name';
  nameEl.textContent = name;
  info.appendChild(nameEl);

  var metaEl = document.createElement('div');
  metaEl.className = 'feed-meta';
  metaEl.textContent = meta;
  info.appendChild(metaEl);

  if (dates) {
    var datesEl = document.createElement('div');
    datesEl.className = 'feed-dates';
    datesEl.textContent = dates;
    info.appendChild(datesEl);
  }

  item.appendChild(info);
  return item;
}

/** クリックまたは Enter/Space でコールバックを呼ぶハンドラを設定 */
function onActivate(el, callback) {
  el.onclick = callback;
  el.onkeydown = function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      callback();
    }
  };
}

/**
 * WebSocket から受信したエンティティをフィードに追加（最新が上、最大50件）。
 * @param {object} entity - NGSI-LD エンティティ
 * @param {boolean} isNew - 新規作成の場合 true
 * @param {object} deps - { map, selectEntity, getFlyZoom, openPopupForEntity }
 */
export function addFeedItem(entity, isNew, deps) {
  var list = getFeedList();
  var name = getEntityName(entity);
  var time = formatTime(new Date().toISOString());
  var dates = '';
  if (entity.createdAt || entity.modifiedAt) {
    dates = '作成: ' + formatDateTime(entity.createdAt) + ' / 更新: ' + formatDateTime(entity.modifiedAt);
  }
  var item = buildFeedItem(name, time, dates);
  item.setAttribute('data-id', entity.id);
  if (isNew) item.classList.add('new');

  onActivate(item, function() {
    var geo = findGeoProperty(entity);
    if (geo && geo.value) {
      deps.selectEntity(entity.id);
      deps.map.flyTo({ center: geo.value.coordinates, zoom: 16, duration: 1200 });
      setTimeout(function() { deps.openPopupForEntity(entity.id); }, 1300);
    }
  });

  list.insertBefore(item, list.firstChild);
  while (list.children.length > 50) {
    list.removeChild(list.lastChild);
  }
  setTimeout(function() { item.classList.remove('new'); }, 2000);
}

/**
 * 初期データ（REST API から取得）でフィードを初期化（直近20件を表示）。
 * @param {Array} entities - エンティティの配列
 * @param {object} deps - { map, selectEntity, getFlyZoom, openPopupForEntity }
 */
export function initFeed(entities, deps) {
  var list = getFeedList();
  list.innerHTML = '';
  // modifiedAt 降順でソート済みなので先頭20件を表示
  entities.slice(0, 20).forEach(function(e) {
    var name = getEntityName(e);
    var dates = '';
    if (e.createdAt || e.modifiedAt) {
      dates = '作成: ' + formatDateTime(e.createdAt) + ' / 更新: ' + formatDateTime(e.modifiedAt);
    }
    var item = buildFeedItem(name, e.id, dates);
    item.setAttribute('data-id', e.id);

    onActivate(item, function() {
      var geo = findGeoProperty(e);
      if (geo && geo.value) {
        deps.selectEntity(e.id);
        deps.map.flyTo({ center: geo.value.coordinates, zoom: 16, duration: 1200 });
        setTimeout(function() { deps.openPopupForEntity(e.id); }, 1300);
      }
    });

    list.appendChild(item);
  });
}
