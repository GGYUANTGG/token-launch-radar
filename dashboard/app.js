// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked pre-token board, a Live view of the tokened peers the values were fitted from, a Model
// view with the fit itself, and a detail drawer per protocol: the whole valuation arithmetic, the
// peer comps and the farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var params = new URLSearchParams(location.search);

  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    watch: params.get('watch') === '1',
    tab: params.get('tab') || 'pre-token',
    sort: params.get('sort') || 'implied',
    selected: params.get('slug') || null,
  };
  if (params.get('view') === 'filtered' && state.category === 'all') state.category = 'Dexs';
  if (params.get('view') === 'detail' && !state.selected && DATA.rows.length) state.selected = DATA.rows[0].slug;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return '×' + Number(n).toFixed(2); }

  // The model, recomputed on the page: a row's implied value from the fitted parameters and the
  // row's own shipped breakdown, so the page's arithmetic and board.json's are visibly the same.
  function impliedOf(row) {
    var m = row.model;
    return Math.max(1, Math.round(m.peer_base_usd * m.momentum_multiplier * m.tenure_multiplier * m.breadth_multiplier));
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    }
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function tdNum(text, cls) { var t = el('td', { 'class': 'num' + (cls ? ' ' + cls : '') }, text); return t; }

  /* ---------- header ---------- */
  function renderHead() {
    var head = el('div', { 'class': 'head' });
    var brand = el('div', { 'class': 'brand' });
    brand.appendChild(el('div', { 'class': 'ring' }));
    var titles = el('div');
    titles.appendChild(el('h1', null, 'Launch Radar'));
    titles.appendChild(el('p', { 'class': 'sub' },
      'Protocols that record no token yet, ranked by what a token would be worth if they issued one ' +
      'and their record stayed as it is — valued against the protocols whose tokens already trade.'));
    brand.appendChild(titles);
    head.appendChild(brand);
    var stats = el('div', { 'class': 'stats' });
    [
      [String(DATA.board_size), 'ranked pre-token'],
      [String(DATA.watchlist_size) + ' / ' + String(DATA.watchlist_size), 'watchlist covered'],
      [String(DATA.fit.peers_used), 'peers fitted'],
      [DATA.as_of, 'snapshot date'],
    ].forEach(function (pair) {
      var s = el('div', { 'class': 'stat' });
      s.appendChild(el('b', null, pair[0]));
      s.appendChild(el('span', null, pair[1]));
      stats.appendChild(s);
    });
    head.appendChild(stats);
    app.appendChild(head);

    var strip = el('p', { 'class': 'modelstrip' });
    strip.appendChild(el('b', null, 'Model ' + DATA.model_version + ' — peer fit: '));
    strip.appendChild(document.createTextNode('implied = exp('));
    var a = el('span', { 'class': 'num' }, String(DATA.fit.alpha));
    var b = el('span', { 'class': 'num' }, String(DATA.fit.beta));
    strip.appendChild(a);
    strip.appendChild(document.createTextNode(' + '));
    strip.appendChild(b);
    strip.appendChild(document.createTextNode(' · ln TVL) × category offset × momentum × tenure × breadth, fitted on '));
    strip.appendChild(el('span', { 'class': 'num' }, String(DATA.fit.peers_used)));
    strip.appendChild(document.createTextNode(' of '));
    strip.appendChild(el('span', { 'class': 'num' }, String(DATA.fit.peers_total)));
    strip.appendChild(document.createTextNode(' tokened peers (wild prints trimmed). No name is scored by hand.'));
    app.appendChild(strip);
  }

  /* ---------- controls ---------- */
  function allCategories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }
  function allChains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = 1; }); });
    return Object.keys(seen).sort();
  }
  function renderControls() {
    var bar = el('div', { 'class': 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Search name or category', value: state.q });
    search.addEventListener('input', function () { state.q = search.value; refresh(); });
    bar.appendChild(search);

    var cat = el('select');
    cat.appendChild(el('option', { value: 'all' }, 'All categories'));
    allCategories().forEach(function (c) {
      var o = el('option', { value: c }, c);
      if (state.category === c) o.setAttribute('selected', 'selected');
      cat.appendChild(o);
    });
    cat.addEventListener('change', function () { state.category = cat.value; refresh(); });
    bar.appendChild(cat);

    var chain = el('select');
    chain.appendChild(el('option', { value: 'all' }, 'All chains'));
    allChains().forEach(function (c) {
      var o = el('option', { value: c }, c);
      if (state.chain === c) o.setAttribute('selected', 'selected');
      chain.appendChild(o);
    });
    chain.addEventListener('change', function () { state.chain = chain.value; refresh(); });
    bar.appendChild(chain);

    var sort = el('select');
    [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7d change'], ['age', 'Sort: time tokenless'], ['ratio', 'Sort: value / TVL']].forEach(function (pair) {
      var o = el('option', { value: pair[0] }, pair[1]);
      if (state.sort === pair[0]) o.setAttribute('selected', 'selected');
      sort.appendChild(o);
    });
    sort.addEventListener('change', function () { state.sort = sort.value; refresh(); });
    bar.appendChild(sort);

    var lab = el('label', { 'class': 'check' });
    var box = el('input', { type: 'checkbox' });
    if (state.watch) box.setAttribute('checked', 'checked');
    box.addEventListener('change', function () { state.watch = box.checked; refresh(); });
    lab.appendChild(box);
    lab.appendChild(document.createTextNode('Watchlist only'));
    bar.appendChild(lab);

    var tabs = el('div', { 'class': 'tabs' });
    [['pre-token', 'Pre-token board'], ['live', 'Live tokens'], ['model', 'Model']].forEach(function (pair) {
      var btn = el('button', { 'aria-pressed': state.tab === pair[0] ? 'true' : 'false' }, pair[1]);
      btn.addEventListener('click', function () { state.tab = pair[0]; refresh(); });
      tabs.appendChild(btn);
    });
    bar.appendChild(tabs);
    app.appendChild(bar);
  }

  /* ---------- board table ---------- */
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + (r.category || '') + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      ratio: function (r) { return r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0; },
    }[state.sort];
    rows.sort(function (x, y) { return key(y) - key(x) || x.rank - y.rank; });
    return rows;
  }

  function renderBoard() {
    var rows = visibleRows();
    app.appendChild(el('p', { 'class': 'count' },
      'Showing ' + rows.length + ' of ' + DATA.board_size + ' ranked protocols · ' +
      DATA.watchlist_size + ' watchlist protocols all covered · click a row for its valuation and farm plan'));
    var table = el('table');
    var thead = el('thead');
    var htr = el('tr');
    ['#', 'Protocol', 'TVL', '7d', 'Tokenless', 'Implied value', ''].forEach(function (h) { htr.appendChild(el('th', null, h)); });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', state.selected === r.slug ? { 'class': 'sel' } : null);
      tr.appendChild(el('td', { 'class': 'rank' }, String(r.rank)));
      var name = el('td', { 'class': 'name' });
      var b = el('b', null, r.name);
      name.appendChild(b);
      if (r.watchlist) name.appendChild(el('span', { 'class': 'badge' }, 'WATCHLIST'));
      name.appendChild(el('span', { 'class': 'cat' }, (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')));
      tr.appendChild(name);
      tr.appendChild(tdNum(fmtUsd(r.tvl_usd)));
      var ch = tdNum(fmtPct(r.change_7d), r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg');
      tr.appendChild(ch);
      tr.appendChild(tdNum(fmtAge(r.age_days)));
      var val = el('td', { 'class': 'val' });
      val.appendChild(el('b', null, fmtUsd(r.implied_value_usd)));
      val.appendChild(el('span', { 'class': 'ratio' }, (r.tvl_usd > 0 ? (r.implied_value_usd / r.tvl_usd).toFixed(2) : '0') + ' × TVL'));
      tr.appendChild(val);
      var planCell = el('td');
      var btn = el('button', { 'class': 'plan' }, 'Farm plan');
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); state.selected = r.slug; refresh(); });
      planCell.appendChild(btn);
      tr.appendChild(planCell);
      tr.addEventListener('click', function () { state.selected = r.slug; refresh(); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    app.appendChild(table);
  }

  /* ---------- detail drawer ---------- */
  function wrow(label, amount, maxAmt, total) {
    var row = el('div', { 'class': 'wrow' + (total ? ' total' : '') });
    row.appendChild(el('span', { 'class': 'lab' }, label));
    var bar = el('div', { 'class': 'bar' });
    var pct = amount > 0 ? Math.max(3, Math.round(100 * amount / maxAmt)) : 3;
    var fill = el('i');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el('span', { 'class': 'amt' }, fmtUsd(amount)));
    return row;
  }

  function renderDrawer() {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === state.selected) r = x; });
    if (!r) return;
    var m = r.model;
    var d = el('section', { 'class': 'drawer' });
    var top = el('div', { 'class': 'top' });
    top.appendChild(el('h2', null, r.name));
    if (r.watchlist) top.appendChild(el('span', { 'class': 'badge' }, 'WATCHLIST'));
    top.appendChild(el('span', { 'class': 'prov' },
      'DefiLlama records no token for ' + r.name + ' in the snapshot of ' + DATA.as_of + '.'));
    d.appendChild(top);

    var grid = el('div', { 'class': 'grid' });
    [
      ['Rank', '#' + r.rank],
      ['Implied value', fmtUsd(r.implied_value_usd)],
      ['TVL', fmtUsd(r.tvl_usd)],
      ['Value / TVL', r.tvl_usd > 0 ? (r.implied_value_usd / r.tvl_usd).toFixed(2) + ' ×' : 'n/a'],
      ['7d TVL change', fmtPct(r.change_7d)],
      ['Tokenless for', fmtAge(r.age_days)],
      ['Category', r.category || 'Uncategorised'],
      ['Chains', r.chains.length ? r.chains.slice(0, 4).join(', ') + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) + ' more' : '') : 'none recorded'],
    ].forEach(function (pair) {
      var cell = el('div');
      cell.appendChild(el('span', null, pair[0]));
      cell.appendChild(el('b', null, pair[1]));
      grid.appendChild(cell);
    });
    d.appendChild(grid);

    var cols = el('div', { 'class': 'cols' });
    var water = el('div', { 'class': 'water' });
    water.appendChild(el('h3', null, 'How the value is built'));
    var curve = m.category_offset > 0 ? m.peer_base_usd / m.category_offset : m.peer_base_usd;
    var run1 = m.peer_base_usd;
    var run2 = run1 * m.momentum_multiplier;
    var run3 = run2 * m.tenure_multiplier;
    var run4 = run3 * m.breadth_multiplier;
    var maxAmt = Math.max(curve, run1, run2, run3, run4, r.implied_value_usd, 10);
    water.appendChild(wrow('Peer size curve at its TVL', Math.round(curve), maxAmt, false));
    water.appendChild(wrow('Category offset ' + fmtMult(m.category_offset) + ' — ' + m.category_peers + ' ' + (r.category || '') + (m.category_peers === 1 ? ' peer' : ' peers'), Math.round(run1), maxAmt, false));
    water.appendChild(wrow('Momentum ' + fmtMult(m.momentum_multiplier) + ' — ' + fmtPct(m.momentum_pct) + ' TVL in 7 days', Math.round(run2), maxAmt, false));
    water.appendChild(wrow('Tenure ' + fmtMult(m.tenure_multiplier) + ' — ' + fmtAge(m.age_days) + ' with no token', Math.round(run3), maxAmt, false));
    water.appendChild(wrow('Breadth ' + fmtMult(m.breadth_multiplier) + ' — TVL on ' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains'), Math.round(run4), maxAmt, false));
    water.appendChild(wrow('Implied value', r.implied_value_usd, maxAmt, true));
    var recomputed = impliedOf(r);
    var drift = r.implied_value_usd > 0 ? Math.abs(recomputed - r.implied_value_usd) / r.implied_value_usd : 0;
    water.appendChild(el('p', { 'class': 'foot' },
      'This page recomputes the row from the shipped fit: ' + fmtUsd(recomputed) +
      (drift < 0.01 ? ' — it agrees with board.json within rounding.' : '.')));
    cols.appendChild(water);

    var farm = el('div', { 'class': 'farm' });
    farm.appendChild(el('h3', null, 'Farm plan — what to do, what it costs, how long it takes'));
    var ol = el('ol', { 'class': 'farm' });
    r.farm_steps.forEach(function (s) { ol.appendChild(el('li', null, s)); });
    farm.appendChild(ol);
    cols.appendChild(farm);
    d.appendChild(cols);
    if (r.peers && r.peers.length) {
      var peers = el('div', { 'class': 'peers' });
      peers.appendChild(el('h3', null, 'The peers it was valued against — ' + (r.category || 'its category') + ', tokens already trading'));
      var pt = el('table');
      var ph = el('tr');
      ['Protocol', 'TVL', 'Market cap', 'Cap / TVL'].forEach(function (h) { ph.appendChild(el('th', null, h)); });
      pt.appendChild(ph);
      r.peers.forEach(function (p) {
        var tr = el('tr');
        var nm = el('td', null, p.name); nm.style.textAlign = 'left'; tr.appendChild(nm);
        tr.appendChild(tdNum(fmtUsd(p.tvl_usd)));
        tr.appendChild(tdNum(fmtUsd(p.mcap_usd)));
        tr.appendChild(tdNum(p.ratio.toFixed(2) + ' ×'));
        pt.appendChild(tr);
      });
      peers.appendChild(pt);
      d.appendChild(peers);
    }

    app.appendChild(d);
  }

  /* ---------- live + model views ---------- */
  function renderLive() {
    app.appendChild(el('p', { 'class': 'count' },
      'The comp set: protocols whose token already trades. The board never ranks these — their market ' +
      'caps are what the peer fit was made from. Shown by market cap, top ' + DATA.live.length + '.'));
    var table = el('table');
    var htr = el('tr');
    ['Protocol', 'TVL', 'Market cap', 'Cap / TVL', '7d'].forEach(function (h) { htr.appendChild(el('th', null, h)); });
    table.appendChild(htr);
    DATA.live.forEach(function (p) {
      var tr = el('tr');
      var name = el('td', { 'class': 'name' });
      name.appendChild(el('b', null, p.name));
      name.appendChild(el('span', { 'class': 'cat' }, p.category || 'Uncategorised'));
      tr.appendChild(name);
      tr.appendChild(tdNum(fmtUsd(p.tvl_usd)));
      tr.appendChild(tdNum(fmtUsd(p.mcap_usd)));
      tr.appendChild(tdNum(p.ratio === null ? 'n/a' : p.ratio.toFixed(2) + ' ×'));
      tr.appendChild(tdNum(fmtPct(p.change_7d), p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg'));
      table.appendChild(tr);
    });
    app.appendChild(table);
  }

  function renderModel() {
    app.appendChild(el('p', { 'class': 'count' },
      'The fit, made from the snapshot at run time: ln(market cap) = ' + DATA.fit.alpha + ' + ' + DATA.fit.beta +
      ' · ln(TVL) over ' + DATA.fit.peers_used + ' trimmed peers of ' + DATA.fit.peers_total +
      ' tokened protocols. Global median cap/TVL ' + DATA.fit.global_median_ratio.toFixed(2) + ' ×. ' +
      'A category offset is its peers’ median residual from the line, shrunk by n/(n+6) and capped to [0.15, 6].'));
    var table = el('table', { 'class': 'cats' });
    var htr = el('tr');
    ['Category', 'Peers', 'Median cap / TVL', 'Offset vs curve'].forEach(function (h) { htr.appendChild(el('th', null, h)); });
    table.appendChild(htr);
    DATA.categories.forEach(function (c) {
      var tr = el('tr');
      var name = el('td', { 'class': 'name' });
      name.appendChild(el('b', null, c.category));
      tr.appendChild(name);
      tr.appendChild(tdNum(String(c.peers)));
      tr.appendChild(tdNum(c.median_ratio === null ? 'n/a' : c.median_ratio.toFixed(2) + ' ×'));
      tr.appendChild(tdNum(fmtMult(c.offset)));
      table.appendChild(tr);
    });
    app.appendChild(table);
  }

  /* ---------- boot ---------- */
  function renderView() {
    if (state.tab === 'live') { renderLive(); return; }
    if (state.tab === 'model') { renderModel(); return; }
    renderDrawer();
    renderBoard();
  }
  function refresh() {
    var hadSearch = document.activeElement && document.activeElement.type === 'search';
    app.innerHTML = '';
    renderHead();
    renderControls();
    renderView();
    if (hadSearch) {
      var s = app.querySelector('input[type="search"]');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
  }
  renderHead();
  renderControls();
  renderView();
  app.setAttribute('aria-busy', 'false');
  app.appendChild(el('p', { 'class': 'foot' }, DATA.source + ' · Board and page were generated by the same run of the entry program; the values are the board’s own claims, not predictions.'));
})();
