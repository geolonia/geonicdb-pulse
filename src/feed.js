/**
 * feed.js — サイドパネルのライブフィード
 *
 * WebSocket から受信したエンティティの更新を時系列で表示するフィード。
 * 各アイテムをクリック（またはキーボード操作）すると地図上の該当エンティティにフライ＆ポップアップ表示する。
 */

import { getEntityName, findGeoProperty, formatTime, formatDateTime } from './entity.js';

var feedList = null;

// 無限スクロール用の状態
var feedState = {
  deps: null,
  onLoadMore: null,
  loading: false
};

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

/** エンティティ1件分のフィード項目を作成して返す */
function createEntityFeedItem(e, deps) {
  var name = getEntityName(e);
  var dates = e.createdAt ? 'createdAt: ' + formatDateTime(e.createdAt) : '';
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

  return item;
}

/** スクロールイベントハンドラ — 底付近で次ページの API 取得をトリガー */
function onFeedScroll() {
  var list = getFeedList();
  if (feedState.loading) return;
  if (list.scrollTop + list.clientHeight >= list.scrollHeight - 100) {
    if (feedState.onLoadMore) {
      feedState.loading = true;
      feedState.onLoadMore().then(function() {
        feedState.loading = false;
      }).catch(function() {
        feedState.loading = false;
      });
    }
  }
}

/**
 * WebSocket から受信したエンティティをフィードに追加（最新が上）。
 * @param {object} entity - NGSI-LD エンティティ
 * @param {boolean} isNew - 新規作成の場合 true
 * @param {object} deps - { map, selectEntity, getFlyZoom, openPopupForEntity }
 */
export function addFeedItem(entity, isNew, deps) {
  var list = getFeedList();
  var name = getEntityName(entity);
  var time = formatTime(new Date().toISOString());
  var dates = entity.modifiedAt ? 'modifiedAt: ' + formatDateTime(entity.modifiedAt) : '';
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
  setTimeout(function() { item.classList.remove('new'); }, 2000);
}

/**
 * 取得済みエンティティをフィード末尾に追加する。
 * API から新しいページが取得されるたびに app.js から呼ばれる。
 * @param {Array} newEntities - 追加するエンティティの配列
 */
export function appendFeedItems(newEntities) {
  var list = getFeedList();
  newEntities.forEach(function(e) {
    list.appendChild(createEntityFeedItem(e, feedState.deps));
  });
}

/**
 * フィードを初期化する。
 * @param {object} deps - { map, selectEntity, getFlyZoom, openPopupForEntity }
 * @param {Function} onLoadMore - 次ページを取得する関数（Promise を返す）
 */
export function initFeed(deps, onLoadMore) {
  var list = getFeedList();
  list.innerHTML = '';
  list.removeEventListener('scroll', onFeedScroll);

  feedState.deps = deps;
  feedState.onLoadMore = onLoadMore;
  feedState.loading = false;

  list.addEventListener('scroll', onFeedScroll);
}
