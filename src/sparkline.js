/**
 * sparkline.js — SVG スパークライン生成
 *
 * Temporal データのポップアップ内に表示するミニ折れ線グラフ。
 * 外部ライブラリを使わず、SVG を直接組み立てる。
 */

/**
 * 時系列データポイントの配列から SVG スパークラインを生成する。
 * @param {Array} dataPoints - {value, observedAt} の配列
 * @param {string} color - 線の色（例: '#00e5ff'）
 * @returns {string} SVG 文字列（データが2点未満の場合は空文字列）
 */
export function buildSparkline(dataPoints, color) {
  if (!dataPoints || dataPoints.length < 2) return '';
  var sorted = dataPoints.slice().sort(function(a, b) {
    return new Date(a.observedAt) - new Date(b.observedAt);
  });
  // 数値に変換できないデータポイントを除外
  sorted = sorted.filter(function(d) { return !isNaN(Number(d.value)); });
  if (sorted.length < 2) return '';
  var values = sorted.map(function(d) { return Number(d.value); });
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
