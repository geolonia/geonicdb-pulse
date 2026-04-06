/**
 * entity.js — NGSI-LD エンティティのユーティリティ
 *
 * エンティティの表示名取得、位置情報の検索、プロパティ一覧の抽出など、
 * NGSI-LD エンティティを扱うための純粋なヘルパー関数群。
 * 地図や DB への依存はない。
 */

/** ISO 8601 文字列を HH:MM:SS 形式に変換 */
export function formatTime(isoString) {
  var d = new Date(isoString);
  return String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0');
}

/** ISO 8601 文字列を YYYY/MM/DD HH:MM (JST) 形式に変換 */
export function formatDateTime(isoString) {
  if (!isoString) return '-';
  var d = new Date(isoString);
  var offset = d.getTimezoneOffset();
  var abs = Math.abs(offset);
  var hours = Math.floor(abs / 60);
  var minutes = abs % 60;
  var tz = offset === -540 ? ' JST' : ' (UTC' + (offset <= 0 ? '+' : '-') + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ')';
  return d.getFullYear() + '/' +
    String(d.getMonth() + 1).padStart(2, '0') + '/' +
    String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + tz;
}

/** 画面右下にトースト通知を表示 */
export function showToast(message) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 3500);
}

/**
 * エンティティの表示名を取得する。
 * NGSI-LD エンティティの name 属性、なければ ID の末尾を使う。
 */
export function getEntityName(e) {
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
export function findGeoProperty(e) {
  var geoKeys = ['location', 'position', 'geo', 'coordinates', 'place'];
  for (var i = 0; i < geoKeys.length; i++) {
    var attr = e[geoKeys[i]];
    if (attr && attr.type === 'GeoProperty' && attr.value) return attr;
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
export function getDisplayProperties(e) {
  var skip = ['id', 'type', '@context', 'location', 'position', 'geo', 'coordinates', 'place', 'createdAt', 'modifiedAt'];
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

/**
 * Temporal エンティティを通常のエンティティ形式にフラット化する。
 * 配列の先頭が最新値（API は降順で返す）。
 */
export function flattenTemporal(te) {
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
