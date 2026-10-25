/* ETF 细分行业资金流向 · 本地版前端
 * 纯静态实现：数据来自 data.js 中的 window.ETF_DATA，图表用本地 ECharts 渲染。
 */
(function () {
  'use strict';

  var DATA = window.ETF_DATA;
  if (!DATA || !DATA.dates) {
    document.getElementById('panels').innerHTML =
      '<div class="empty">数据未加载：请确认 data.js 与本页面在同一目录。</div>';
    return;
  }

  var DATES = DATA.dates;
  var N = DATES.length;
  var CATS = DATA.categories;
  var BY_ID = {};
  CATS.forEach(function (c) { BY_ID[c.id] = c; });
  var TOTAL_SERIES = CATS.reduce(function (a, c) { return a + c.series.length; }, 0);

  var PALETTE = ['#2563eb', '#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#14b8a6',
    '#6366f1', '#84cc16', '#06b6d4', '#d946ef', '#f97316', '#3b82f6'];

  var BIG = [
    { id: '1_宽基市场', no: 1, name: '宽基市场' },
    { id: '2_风格策略', no: 2, name: '风格策略' },
    { id: '3_科技', no: 3, name: '科技' },
    { id: '4_制造', no: 4, name: '制造' },
    { id: '5_能源', no: 5, name: '能源' },
    { id: '6_资源', no: 6, name: '资源' },
    { id: '7_消费+7_医药', no: 7, name: '医药&消费', parts: ['7_消费', '7_医药'] },
    { id: '8_金融地产', no: 8, name: '金融地产' },
    { id: '9_债券', no: 9, name: '债券' }
  ];
  BIG.forEach(function (b) {
    b.cats = (b.parts || [b.id]).map(function (id) { return BY_ID[id]; });
  });

  var state = {
    range: 3,
    cat: CATS[0].id,
    q: '',
    theme: localStorage.getItem('etf-theme') || 'light'
  };

  function readHash() {
    var p = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return p;
  }
  function syncHash() {
    var parts = ['cat=' + encodeURIComponent(state.cat), 'range=' + state.range];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.theme === 'dark') parts.push('theme=dark');
    try { history.replaceState(null, '', '#' + parts.join('&')); } catch (e) { /* file:// 环境忽略 */ }
  }

  /* ---------------- 基础工具 ---------------- */

  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmt1(v) {
    if (!isNum(v)) return '—';
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  function fmt0(v) {
    if (!isNum(v)) return '—';
    return Math.round(v).toLocaleString('zh-CN');
  }
  function compact(v) {
    if (!isNum(v)) return '';
    if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + '万';
    return String(Math.round(v));
  }
  function signedPct(v, d) {
    if (!isNum(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%';
  }
  function signedNum(v, d) {
    if (!isNum(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(d == null ? 1 : d);
  }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dateMinus(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }
  function dateMinusYears(dateStr, years) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.toISOString().slice(0, 10);
  }
  function firstIndexAtOrAfter(ymd) {
    for (var i = 0; i < N; i++) if (DATES[i] >= ymd) return i;
    return N - 1;
  }

  var LAST = DATES[N - 1];
  var WEEK_START = (function () {
    var i = firstIndexAtOrAfter(dateMinus(LAST, 7));
    return i >= N - 1 ? Math.max(0, N - 2) : i;
  })();
  var WEEK_DAYS = N - WEEK_START;

  function rangeStart(years) {
    if (!years) return 0;
    return firstIndexAtOrAfter(dateMinusYears(LAST, years));
  }

  function totalAt(idx) {
    var t = 0;
    CATS.forEach(function (c) {
      c.series.forEach(function (s) {
        var v = s.values[idx];
        if (isNum(v)) t += v;
      });
    });
    return t;
  }
  function catTotal(cat, idx) {
    return sum(cat.series.map(function (s) { return isNum(s.values[idx]) ? s.values[idx] : 0; }));
  }
  function bigTotal(big, idx) {
    return sum(big.cats.map(function (c) { return catTotal(c, idx); }));
  }
  function colorOf(cat, series) {
    var i = cat.series.indexOf(series);
    return PALETTE[i % PALETTE.length];
  }
  function rows(cat) {
    return cat.series.map(function (s) { return { s: s, color: colorOf(cat, s) }; });
  }
  function filtered(cat) {
    var q = state.q.trim().toLowerCase();
    var list = rows(cat);
    if (!q) return list;
    return list.filter(function (r) { return r.s.name.toLowerCase().indexOf(q) >= 0; });
  }
  function pctChange(a, b) {
    if (!isNum(a) || !isNum(b) || a === 0) return null;
    return (b / a - 1) * 100;
  }
  function pctFrom(v, idx, back) {
    var j = idx - back;
    if (j < 0) return null;
    return pctChange(v[j], v[idx]);
  }

  /* ---------------- 主题 ---------------- */

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    document.getElementById('theme-label').textContent = state.theme === 'dark' ? '浅色' : '深色';
    localStorage.setItem('etf-theme', state.theme);
  }
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------------- 顶部信息 ---------------- */

  function renderHero() {
    var line = document.getElementById('range-line');
    line.innerHTML =
      '数据区间 <b>' + DATA.meta.first_date + '</b> ~ <b>' + LAST + '</b>（' +
      N + ' 个交易日）　｜　近期区间 <b>' + DATES[WEEK_START] + '</b> ~ <b>' + LAST +
      '</b>（' + WEEK_DAYS + ' 个交易日）';

    var staleDays = Math.floor((Date.now() - new Date(LAST + 'T15:00:00+08:00').getTime()) / 86400000);
    var badges = [
      '<span class="badge"><span class="dot"></span>更新至 ' + LAST + '</span>',
      '<span class="badge">' + TOTAL_SERIES + ' 个细分行业</span>',
      '<span class="badge">' + CATS.length + ' 个大类</span>'
    ];
    if (staleDays > 4) {
      badges.push('<span class="badge" style="color:var(--up);border-color:var(--up)">⚠ 已 ' + staleDays + ' 天未更新</span>');
    }
    document.getElementById('hero-badges').innerHTML = badges.join('');
  }

  function renderKpis() {
    var now = totalAt(N - 1);
    var before = totalAt(WEEK_START);
    var diff = now - before;
    var pct = pctChange(before, now);

    var upCount = 0, downCount = 0;
    CATS.forEach(function (c) {
      c.series.forEach(function (s) {
        var d = s.values[N - 1] - s.values[WEEK_START];
        if (d > 0) upCount++;
        else if (d < 0) downCount++;
      });
    });

    var box = document.getElementById('kpis');
    box.innerHTML = [
      kpi('全市场 ETF 总份额', fmt1(now) + ' <small style="font-size:13px;color:var(--muted)">亿份</small>',
        '较 ' + DATES[WEEK_START] + ' ' + spanSigned(diff) + '（' + spanPct(pct) + '）'),
      kpi('近一周净变动', spanSigned(diff) + ' <small style="font-size:13px;color:var(--muted)">亿份</small>',
        WEEK_DAYS + ' 个交易日累计'),
      kpi('增持 / 减持', '<span class="up">' + upCount + '</span> <span style="color:var(--faint);font-weight:400">/</span> <span class="down">' + downCount + '</span>',
        '细分行业家数（按份额变化）'),
      kpi('数据覆盖', N.toLocaleString('zh-CN') + ' <small style="font-size:13px;color:var(--muted)">交易日</small>',
        DATA.meta.first_date + ' 起，每日收盘后更新')
    ].join('');
  }
  function kpi(label, value, sub) {
    return '<div class="kpi"><div class="k-label">' + label + '</div>' +
      '<div class="k-value num">' + value + '</div>' +
      '<div class="k-sub">' + sub + '</div></div>';
  }
  function spanSigned(v) {
    return '<span class="' + cls(v) + '">' + signedNum(v) + '</span>';
  }
  function spanPct(v) {
    return '<span class="' + cls(v) + '">' + signedPct(v) + '</span>';
  }

  /* ---------------- 大类表 ---------------- */

  function renderBigTable() {
    var total = totalAt(N - 1);
    var list = BIG.map(function (b) {
      var now = bigTotal(b, N - 1);
      var before = bigTotal(b, WEEK_START);
      return { b: b, now: now, before: before, pct: pctChange(before, now), share: total ? now / total * 100 : 0 };
    }).sort(function (x, y) { return y.now - x.now; });

    var html = '<table><thead><tr><th>大类</th><th>当前总规模</th><th>区间首日</th><th>变动比例</th><th class="share-cell">占比</th></tr></thead><tbody>';
    list.forEach(function (r) {
      html += '<tr>' +
        '<td><span class="cat-name"><span class="swatch" style="background:' + r.b.cats[0].color + '"></span>' + r.b.no + '. ' + esc(r.b.name) + '</span></td>' +
        '<td class="num">' + fmt1(r.now) + '</td>' +
        '<td class="num" style="color:var(--muted)">' + fmt1(r.before) + '</td>' +
        '<td class="num ' + cls(r.pct) + '" style="font-weight:650">' + signedPct(r.pct) + '</td>' +
        '<td class="share-cell"><div class="share-bar" title="占比 ' + r.share.toFixed(1) + '%"><span style="width:' + clamp(r.share, 1.5, 100) + '%"></span></div></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('big-table').innerHTML = html;
  }

  /* ---------------- 排行 ---------------- */

  function renderRank() {
    var all = [];
    CATS.forEach(function (c) {
      c.series.forEach(function (s) {
        var a = s.values[WEEK_START], b = s.values[N - 1];
        if (!isNum(a) || !isNum(b)) return;
        all.push({ name: s.name, cat: c.name.replace(/^\d\./, ''), diff: b - a, pct: pctChange(a, b) });
      });
    });
    var up = all.slice().sort(function (x, y) { return y.diff - x.diff; }).slice(0, 10);
    var down = all.slice().sort(function (x, y) { return x.diff - y.diff; }).slice(0, 10);
    var maxAbs = Math.max(
      Math.abs(up[0] ? up[0].diff : 1),
      Math.abs(down[0] ? down[0].diff : 1)
    );

    document.getElementById('rank-window').textContent = DATES[WEEK_START] + ' 起 ' + WEEK_DAYS + ' 个交易日';

    document.getElementById('rank-wrap').innerHTML =
      rankCol('增持', up, maxAbs, 'up') + rankCol('减持', down, maxAbs, 'down');
  }

  function rankCol(title, list, maxAbs, dir) {
    var html = '<div class="rank-col"><div class="rank-title">' + title +
      '<span class="tag ' + dir + '">TOP 10</span></div>';
    list.forEach(function (r, i) {
      var w = maxAbs ? Math.abs(r.diff) / maxAbs * 100 : 0;
      html += '<div class="rank-row" title="' + esc(r.cat + ' · ' + r.name) + '">' +
        '<span class="idx num">' + (i + 1) + '</span>' +
        '<span class="nm">' + esc(r.name) + '<small>' + esc(r.cat) + '</small></span>' +
        '<span class="val num ' + cls(r.diff) + '">' + signedNum(r.diff) +
        '<em>' + signedPct(r.pct) + '</em></span>' +
        '<span class="track"><span style="width:' + w + '%;background:var(--' + (dir === 'up' ? 'up' : 'down') + ')"></span></span>' +
        '</div>';
    });
    return html + '</div>';
  }

  /* ---------------- 选项卡 ---------------- */

  function renderTabs() {
    var box = document.getElementById('tabs');
    box.innerHTML = CATS.map(function (c) {
      return '<button data-cat="' + c.id + '"' + (c.id === state.cat ? ' class="active"' : '') + '>' +
        '<span class="swatch" style="background:' + c.color + '"></span>' + esc(c.name) + '</button>';
    }).join('');
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-cat]');
      if (!btn) return;
      state.cat = btn.dataset.cat;
      state.q = '';
      var search = document.getElementById('search');
      if (search) search.value = '';
      var note = document.getElementById('filter-note');
      if (note) note.textContent = '';
      box.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      syncHash();
      showPanel(state.cat);
    });
  }

  function showPanel(catId) {
    var panel = document.getElementById('panel-' + catId);
    if (!panel) return;
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
    panel.classList.add('active');
    if (!panel.dataset.rendered) {
      renderPanel(panel, BY_ID[catId]);
      panel.dataset.rendered = '1';
    }
    resizeVisible(panel);
  }

  function resizeVisible(panel) {
    panel.querySelectorAll('.chart-body').forEach(function (el) {
      var inst = echarts.getInstanceByDom(el);
      if (inst) inst.resize();
    });
  }

  /* ---------------- 面板 ---------------- */

  function renderPanels() {
    var box = document.getElementById('panels');
    box.innerHTML = CATS.map(function (c) {
      return '<section class="panel' + (c.id === state.cat ? ' active' : '') + '" id="panel-' + c.id + '"></section>';
    }).join('');
  }

  function renderPanel(panel, cat) {
    var meta = cat.series.length + ' 个细分行业 · 最新 ' + LAST;
    panel.innerHTML =
      '<div class="panel-head"><h2><span class="bar" style="background:' + cat.color + '"></span>' +
      esc(cat.name) + '</h2><span class="meta">' + meta + '</span></div>' +
      chartCard(cat.id, 1, '份额规模', '各细分行业 ETF 份额，单位：亿份', '') +
      chartCard(cat.id, 2, '区间份额变化率', '区间内首个有效数据 = 100%，比较资金相对流向', '') +
      chartCard(cat.id, 3, '近一周份额变化率', '近 ' + WEEK_DAYS + ' 个交易日，首个交易日 = 100%', ' short') +
      detailBlock(cat);

    bindCsv(panel, cat);
    renderDetail(panel, cat);
    renderChart(panel, cat, 1);
    renderChart(panel, cat, 2);
    renderChart(panel, cat, 3);
  }

  function chartCard(catId, idx, title, desc, extraClass) {
    return '<div class="card chart-card">' +
      '<div class="chart-head"><div><h3>' + title + '</h3><p>' + desc + '</p></div>' +
      '<div class="spacer"></div>' +
      '<button class="link-btn" data-csv="' + idx + '">导出 CSV</button></div>' +
      '<div class="chart-body' + extraClass + '" id="chart-' + catId + '-' + idx + '"></div>' +
      '</div>';
  }

  function detailBlock(cat) {
    return '<div class="card"><details class="detail"><summary>细分行业明细数据（可点击表头排序）</summary>' +
      '<div class="table-scroll"><table id="detail-' + cat.id + '">' +
      '<thead><tr><th data-k="name">细分行业</th><th data-k="last">最新份额</th>' +
      '<th data-k="w1" title="最近 6 个交易日">近一周</th><th data-k="m1" title="最近 20 个交易日">近一月</th>' +
      '<th data-k="m3" title="最近 60 个交易日">近三月</th>' +
      '<th data-k="y1" title="最近 250 个交易日">近一年</th><th data-k="range" title="当前所选区间首日至今">区间</th>' +
      '<th data-k="share">占比</th></tr></thead>' +
      '<tbody></tbody></table></div></details></div>';
  }

  function renderDetail(panel, cat) {
    var table = panel.querySelector('#detail-' + cat.id);
    if (!table) return;
    var start = rangeStart(state.range);
    var total = catTotal(cat, N - 1);

    var data = filtered(cat).map(function (r) {
      var v = r.s.values;
      var last = v[N - 1];
      var w1 = pctChange(v[WEEK_START], last);
      var m1 = pctFrom(v, N - 1, 20);
      var m3 = pctFrom(v, N - 1, 60);
      var y1 = pctFrom(v, N - 1, 250);
      var rg = pctChange(v[start], last);
      return {
        name: r.s.name, color: r.color, last: last,
        w1: w1, m1: m1, m3: m3, y1: y1, range: rg,
        w1d: last - v[WEEK_START],
        share: total ? last / total * 100 : 0
      };
    });

    var sort = table._sort || { key: 'last', dir: -1 };
    table._sort = sort;
    data.sort(function (a, b) {
      if (sort.key === 'name') return String(a.name).localeCompare(String(b.name), 'zh-CN') * sort.dir;
      var av = a[sort.key], bv = b[sort.key];
      if (!isNum(av)) av = -Infinity;
      if (!isNum(bv)) bv = -Infinity;
      return (av - bv) * sort.dir;
    });

    var tbody = table.querySelector('tbody');
    tbody.innerHTML = data.map(function (d) {
      return '<tr><td><span class="cat-name"><span class="swatch" style="background:' + d.color + '"></span>' + esc(d.name) + '</span></td>' +
        '<td class="num">' + fmt1(d.last) + '</td>' +
        '<td class="num ' + cls(d.w1) + '">' + signedPct(d.w1) +
        '<span style="color:var(--faint);font-size:11px;margin-left:5px">' + signedNum(d.w1d) + '</span></td>' +
        '<td class="num ' + cls(d.m1) + '">' + signedPct(d.m1) + '</td>' +
        '<td class="num ' + cls(d.m3) + '">' + signedPct(d.m3) + '</td>' +
        '<td class="num ' + cls(d.y1) + '">' + signedPct(d.y1) + '</td>' +
        '<td class="num ' + cls(d.range) + '">' + signedPct(d.range) + '</td>' +
        '<td class="num" style="color:var(--muted)">' + (isNum(d.share) ? d.share.toFixed(1) + '%' : '—') + '</td></tr>';
    }).join('');

    table.querySelectorAll('th[data-k]').forEach(function (th) {
      th.style.cursor = 'pointer';
      th.onclick = function () {
        var k = th.dataset.k;
        sort = { key: k, dir: table._sort.key === k ? -table._sort.dir : (k === 'name' ? 1 : -1) };
        table._sort = sort;
        renderDetail(panel, cat);
      };
    });
  }

  /* ---------------- 图表 ---------------- */

  function rateSeries(values, start) {
    var base = -1;
    for (var i = start; i < values.length; i++) {
      if (isNum(values[i]) && values[i] > 0) { base = i; break; }
    }
    var out = new Array(values.length).fill(null);
    if (base < 0) return out;
    var b = values[base];
    for (var j = base; j < values.length; j++) {
      if (isNum(values[j])) out[j] = +(values[j] / b * 100).toFixed(2);
    }
    return out;
  }

  function renderChart(panel, cat, idx) {
    var el = panel.querySelector('#chart-' + cat.id + '-' + idx);
    if (!el) return;
    var opt;
    if (idx === 1) opt = levelOption(cat, el);
    else if (idx === 2) opt = rateOption(cat, el);
    else opt = weekOption(cat, el);
    var inst = echarts.getInstanceByDom(el);
    if (!inst) inst = echarts.init(el, null, { renderer: 'canvas' });
    inst.setOption(opt, true);
  }

  function chartTheme() {
    return {
      text: css('--text-2') || '#334155',
      muted: css('--muted') || '#64748b',
      grid: css('--grid') || '#eef2f7',
      panel: css('--panel') || '#fff',
      border: css('--border') || '#e2e8f0'
    };
  }

  function baseOption(dates, t, opts) {
    opts = opts || {};
    var narrow = window.innerWidth < 860;
    return {
      animation: false,
      backgroundColor: 'transparent',
      color: PALETTE,
      textStyle: { fontFamily: 'inherit' },
      grid: {
        left: narrow ? 46 : 58,
        right: narrow ? 16 : (opts.endLabel === false ? 24 : 128),
        top: 44,
        bottom: 52,
        containLabel: false
      },
      legend: {
        type: 'scroll',
        top: 6,
        left: 4,
        right: 8,
        itemWidth: 13,
        itemHeight: 8,
        itemGap: 12,
        icon: 'roundRect',
        textStyle: { color: t.muted, fontSize: 11.5 },
        pageIconColor: t.muted,
        pageIconInactiveColor: t.grid,
        pageTextStyle: { color: t.muted, fontSize: 10 }
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: t.panel,
        borderColor: t.border,
        borderWidth: 1,
        padding: [9, 12],
        textStyle: { color: t.text, fontSize: 12 },
        extraCssText: 'border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.16);',
        axisPointer: { type: 'line', lineStyle: { color: t.muted, opacity: .4 } },
        formatter: opts.tooltipFormatter
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: t.grid } },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: t.grid, type: 'dashed', opacity: .8 } },
        axisLabel: {
          color: t.muted, fontSize: 10.5, hideOverlap: true,
          formatter: opts.shortDates ? function (v) { return v.slice(5); }
            : function (v) { return v.slice(0, 7); }
        },
        axisPointer: { label: { backgroundColor: t.muted } }
      },
      yAxis: {
        type: 'value',
        scale: opts.scale !== false,
        splitLine: { lineStyle: { color: t.grid, type: 'dashed', opacity: .8 } },
        axisLabel: {
          color: t.muted, fontSize: 10.5,
          formatter: opts.yFormatter || function (v) { return compact(v); }
        }
      },
      dataZoom: [
        { type: 'inside', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: true, moveOnMouseWheel: false, throttle: 60 },
        {
          type: 'slider', height: 16, bottom: 8,
          borderColor: 'transparent', backgroundColor: t.grid,
          fillerColor: 'rgba(37,99,235,.14)',
          handleStyle: { color: t.panel, borderColor: t.border },
          moveHandleStyle: { color: t.muted, opacity: .35 },
          textStyle: { color: t.muted, fontSize: 9 },
          brushSelect: false
        }
      ]
    };
  }

  function seriesBase(r, t) {
    return {
      name: r.s.name,
      type: 'line',
      data: r.data,
      showSymbol: !!r.symbols,
      symbol: 'circle',
      symbolSize: 4,
      lineStyle: { width: r.width || 2, opacity: .92 },
      itemStyle: { color: r.color },
      color: r.color,
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
      connectNulls: false,
      endLabel: r.endLabel ? {
        show: true,
        distance: 5,
        color: r.color,
        fontSize: 10,
        fontWeight: 600,
        backgroundColor: t.panel,
        borderRadius: 3,
        padding: [1, 3],
        formatter: r.endLabel
      } : { show: false },
      labelLayout: { moveOverlap: 'shiftY' }
    };
  }

  function levelOption(cat, el) {
    var t = chartTheme();
    var start = rangeStart(state.range);
    var dates = DATES.slice(start);
    var list = filtered(cat);
    var showEnd = el.clientWidth > 700;
    var opt = baseOption(dates, t, {
      endLabel: showEnd,
      tooltipFormatter: function (ps) {
        return tooltipHtml(ps, function (v) { return fmt1(v) + ' 亿份'; });
      }
    });
    var maxLast = 0;
    list.forEach(function (r) { maxLast = Math.max(maxLast, r.s.values[N - 1] || 0); });
    var topIdx = list.map(function (r, i) { return { i: i, v: r.s.values[N - 1] || 0 }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 3).map(function (x) { return x.i; });
    opt.series = list.map(function (r, i) {
      var s = r.s;
      var label = showEnd && (topIdx.indexOf(i) >= 0 || (s.values[N - 1] || 0) >= maxLast * 0.07);
      return seriesBase({
        s: s,
        data: s.values.slice(start).map(function (v) { return isNum(v) ? +v.toFixed(2) : null; }),
        color: r.color,
        endLabel: label ? function (p) { return p.seriesName + ' ' + fmt0(p.value); } : null
      }, t);
    });
    opt.yAxis.axisLabel.formatter = function (v) { return compact(v); };
    if (!list.length) opt.graphic = emptyGraphic(t);
    return opt;
  }

  function rateOption(cat, el) {
    var t = chartTheme();
    var start = rangeStart(state.range);
    var dates = DATES.slice(start);
    var list = filtered(cat);
    var showEnd = el.clientWidth > 700;
    var opt = baseOption(dates, t, {
      endLabel: showEnd,
      yFormatter: function (v) { return v + '%'; },
      scale: false,
      tooltipFormatter: function (ps) {
        return tooltipHtml(ps, function (v) { return v.toFixed(1) + '%'; });
      }
    });
    var allRates = list.map(function (r) { return rateSeries(r.s.values, start).slice(start); });
    var rng = percentRange(allRates);
    opt.yAxis.min = rng[0];
    opt.yAxis.max = rng[1];
    opt.legend.data = list.map(function (r) { return r.s.name; });
    opt.series = list.map(function (r, i) {
      var label = showEnd && list.length <= 8;
      return seriesBase({
        s: r.s,
        data: allRates[i],
        color: r.color,
        endLabel: label ? function (p) { return p.seriesName + ' ' + p.value.toFixed(0) + '%'; } : null
      }, t);
    });
    opt.series.push({
      name: '__base',
      type: 'line',
      data: [],
      silent: true,
      tooltip: { show: false },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        lineStyle: { color: t.muted, type: 'dashed', width: 1, opacity: .7 },
        data: [{ yAxis: 100 }]
      }
    });
    if (!list.length) opt.graphic = emptyGraphic(t);
    return opt;
  }

  function weekOption(cat, el) {
    var t = chartTheme();
    var dates = DATES.slice(WEEK_START);
    var list = filtered(cat);
    var opt = baseOption(dates, t, {
      shortDates: true,
      yFormatter: function (v) { return v + '%'; },
      scale: false,
      endLabel: false,
      tooltipFormatter: function (ps) {
        return tooltipHtml(ps, function (v) { return v.toFixed(2) + '%'; });
      }
    });
    opt.grid.right = el.clientWidth < 860 ? 18 : 58;
    opt.dataZoom = [];
    var allRates = list.map(function (r) { return rateSeries(r.s.values, WEEK_START).slice(WEEK_START); });
    var rng = percentRange(allRates);
    opt.yAxis.min = rng[0];
    opt.yAxis.max = rng[1];
    opt.legend.data = list.map(function (r) { return r.s.name; });
    opt.series = list.map(function (r, i) {
      return seriesBase({
        s: r.s, data: allRates[i], color: r.color, symbols: true, width: 2,
        endLabel: null
      }, t);
    });
    if (!list.length) opt.graphic = emptyGraphic(t);
    return opt;
  }

  function percentRange(seriesList) {
    var mn = 100, mx = 100;
    seriesList.forEach(function (arr) {
      arr.forEach(function (v) {
        if (!isNum(v) || v <= 0) return;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      });
    });
    if (mx - mn < 1) { mn = Math.max(0, mn - 1); mx += 1; }
    var pad = Math.max(1, (mx - mn) * 0.06);
    var lo = Math.max(0, mn - pad), hi = mx + pad;
    var step = niceNum((hi - lo) / 4);
    return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  }

  function niceNum(range) {
    if (!(range > 0)) return 1;
    var exp = Math.floor(Math.log10(range));
    var f = range / Math.pow(10, exp);
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  function tooltipHtml(params, fmt) {
    if (!params || !params.length) return '';
    var list = params.filter(function (p) { return p.value != null && p.seriesName !== '__base'; });
    list.sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
    var head = '<div style="font-weight:650;margin-bottom:6px">' + esc(params[0].axisValue) + '</div>';
    var body = list.slice(0, 14).map(function (p) {
      return '<div style="display:flex;align-items:center;gap:14px;justify-content:space-between;line-height:1.7">' +
        '<span style="display:flex;align-items:center;gap:6px">' + p.marker + '<span>' + esc(p.seriesName) + '</span></span>' +
        '<b style="font-variant-numeric:tabular-nums">' + fmt(p.value) + '</b></div>';
    }).join('');
    return head + body;
  }

  function emptyGraphic(t) {
    return [{
      type: 'text', left: 'center', top: 'middle',
      style: { text: '没有匹配的细分行业', fill: t.muted, fontSize: 13 }
    }];
  }

  /* ---------------- 导出 ---------------- */

  function download(name, text, type, withBom) {
    var blob = new Blob([(withBom ? '\ufeff' : '') + text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function bindCsv(panel, cat) {
    panel.querySelectorAll('[data-csv]').forEach(function (btn) {
      btn.onclick = function () {
        var idx = +btn.dataset.csv;
        var start = idx === 3 ? WEEK_START : rangeStart(state.range);
        var dates = DATES.slice(start);
        var list = filtered(cat);
        var lines = [['日期'].concat(list.map(function (r) { return r.s.name; })).join(',')];
        var rateMap = list.map(function (r) { return rateSeries(r.s.values, start); });
        for (var i = 0; i < dates.length; i++) {
          var row = [dates[i]];
          list.forEach(function (r, j) {
            if (idx === 1) {
              var v = r.s.values[start + i];
              row.push(isNum(v) ? v.toFixed(2) : '');
            } else {
              var rv = rateMap[j][start + i];
              row.push(isNum(rv) ? rv.toFixed(2) : '');
            }
          });
          lines.push(row.join(','));
        }
        var title = idx === 1 ? '份额' : idx === 2 ? '区间变化率' : '近一周变化率';
        download(cat.name.replace(/^\d\./, '') + '_' + title + '_' + LAST + '.csv', lines.join('\n'), 'text/csv;charset=utf-8', true);
      };
    });
  }

  /* ---------------- 交互 ---------------- */

  function bindControls() {
    document.getElementById('ranges').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-years]');
      if (!btn) return;
      state.range = +btn.dataset.years;
      this.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      syncHash();
      rerenderActive();
    });

    var timer = null;
    document.getElementById('search').addEventListener('input', function (e) {
      clearTimeout(timer);
      var v = e.target.value;
      timer = setTimeout(function () {
        state.q = v;
        var cat = BY_ID[state.cat];
        var n = filtered(cat).length;
        document.getElementById('filter-note').textContent = state.q
          ? '“' + state.q + '” 匹配 ' + n + ' / ' + cat.series.length + ' 项' : '';
        syncHash();
        rerenderActive();
      }, 120);
    });

    document.getElementById('btn-theme').addEventListener('click', function () {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      syncHash();
      document.querySelectorAll('.chart-body').forEach(function (el) {
        var inst = echarts.getInstanceByDom(el);
        if (inst) inst.dispose();
      });
      document.querySelectorAll('.panel').forEach(function (p) { p.dataset.rendered = ''; });
      var panel = document.getElementById('panel-' + state.cat);
      renderPanel(panel, BY_ID[state.cat]);
      panel.dataset.rendered = '1';
    });

    document.getElementById('btn-export-all').addEventListener('click', function () {
      download('etf_flow_' + LAST + '.json', JSON.stringify(DATA), 'application/json');
    });

    window.addEventListener('resize', function () {
      clearTimeout(window.__rsz);
      window.__rsz = setTimeout(function () {
        document.querySelectorAll('.chart-body').forEach(function (el) {
          var inst = echarts.getInstanceByDom(el);
          if (inst) inst.resize();
        });
      }, 120);
    });
  }

  function rerenderActive() {
    var panel = document.getElementById('panel-' + state.cat);
    if (!panel) return;
    renderPanel(panel, BY_ID[state.cat]);
    panel.dataset.rendered = '1';
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    var h = readHash();
    if (h.cat && BY_ID[h.cat]) state.cat = h.cat;
    if (h.range !== undefined && [0, 1, 3, 5].indexOf(+h.range) >= 0) state.range = +h.range;
    if (h.theme === 'dark' || h.theme === 'light') state.theme = h.theme;
    if (h.q) state.q = h.q;

    applyTheme();
    renderHero();
    renderKpis();
    renderBigTable();
    renderRank();
    renderTabs();
    renderPanels();
    bindControls();

    document.querySelectorAll('#ranges button').forEach(function (b) {
      b.classList.toggle('active', +b.dataset.years === state.range);
    });
    if (state.q) {
      document.getElementById('search').value = state.q;
      var cat0 = BY_ID[state.cat];
      document.getElementById('filter-note').textContent =
        '“' + state.q + '” 匹配 ' + filtered(cat0).length + ' / ' + cat0.series.length + ' 项';
    }

    showPanel(state.cat);
    syncHash();
    if (h.expand === '1') {
      document.querySelectorAll('details.detail').forEach(function (d) { d.open = true; });
    }

    if (DATA.meta.generated_at) {
      document.getElementById('build-info').textContent =
        DATA.meta.generated_at + ' 构建 · 数据 ' + DATA.meta.first_date + ' ~ ' + LAST + ' · ' + N + ' 个交易日 · ' + TOTAL_SERIES + ' 个细分行业';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
