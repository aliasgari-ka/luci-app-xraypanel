'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require poll';

// Neutral colours use rgba so the page works with light and dark LuCI themes.
var CSS = [
	'.xp-hero{display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:10px;margin-bottom:14px;color:#fff;flex-wrap:wrap}',
	'.xp-hero.ok{background:linear-gradient(135deg,#2e7d32,#43a047)}',
	'.xp-hero.warn{background:linear-gradient(135deg,#e65100,#fb8c00)}',
	'.xp-hero.bad{background:linear-gradient(135deg,#b71c1c,#e53935)}',
	'.xp-hero.off{background:linear-gradient(135deg,#546e7a,#78909c)}',
	'.xp-hero .xp-dot{width:14px;height:14px;border-radius:50%;background:#fff;flex:none}',
	'.xp-hero.ok .xp-dot{animation:xp-pulse 2s infinite}',
	'@keyframes xp-pulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.7)}70%{box-shadow:0 0 0 10px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}',
	'.xp-hero .xp-title{font-size:1.35em;font-weight:700;line-height:1.2}',
	'.xp-hero .xp-sub{opacity:.9;margin-top:2px}',
	'.xp-hero .xp-grow{flex:1;min-width:200px}',
	'.xp-hero .cbi-button{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.5);color:#fff}',
	'.xp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}',
	'.xp-card{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:12px 14px;background:rgba(128,128,128,.05)}',
	'.xp-card .xp-k{font-size:.8em;text-transform:uppercase;letter-spacing:.04em;opacity:.65}',
	'.xp-card .xp-v{font-size:1.45em;font-weight:700;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
	'.xp-card .xp-s{font-size:.85em;opacity:.7;margin-top:2px}',
	'.xp-bar{height:6px;border-radius:3px;background:rgba(128,128,128,.2);margin-top:8px;overflow:hidden}',
	'.xp-bar > div{height:100%;background:#43a047}',
	'.xp-servers{width:100%;border-collapse:collapse}',
	'.xp-servers th{text-align:left;font-weight:600;font-size:.85em;opacity:.7;padding:6px 8px;border-bottom:1px solid rgba(128,128,128,.3)}',
	'.xp-servers td{padding:8px;border-bottom:1px solid rgba(128,128,128,.15);vertical-align:middle}',
	'.xp-pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:.8em;font-weight:600;color:#fff}',
	'.xp-ms{font-weight:700}',
	'.xp-ms.good{color:#2e7d32}.xp-ms.mid{color:#ef6c00}.xp-ms.slow,.xp-ms.fail{color:#c62828}',
	'.xp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
	'.xp-head h3{margin:0}',
	'.xp-log{max-height:24em;overflow:auto;font-size:12px;white-space:pre-wrap;margin:8px 0 0}',
	'.xp-muted{opacity:.6}'
].join('\n');

function fmtKB(n) {
	if (n == null) return '-';
	return (n / 1024).toFixed(1) + ' MB';
}

function fmtBytes(n) {
	if (n == null) return _('missing');
	if (n < 1024) return n + ' B';
	if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
	if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
	return (n / 1073741824).toFixed(2) + ' GB';
}

function fmtAgo(ts, now) {
	if (!ts) return _('never');
	var d = Math.max(0, now - ts);
	if (d < 90) return _('%d seconds ago').format(d);
	if (d < 5400) return _('%d minutes ago').format(Math.round(d / 60));
	if (d < 172800) return _('%d hours ago').format(Math.round(d / 3600));
	return _('%d days ago').format(Math.round(d / 86400));
}

function pill(color, text) {
	return E('span', { 'class': 'xp-pill', 'style': 'background:' + color }, text);
}

function msClass(ms) {
	if (ms == null) return 'fail';
	return ms < 400 ? 'good' : ms < 1000 ? 'mid' : 'slow';
}

// LuCI's E() inserts a plain string as HTML but an array of strings as text.
// Everything that can come from a share link, a log or a script goes through text().
function text(s) {
	return [ s == null ? '' : '' + s ];
}

function card(key, value, sub, extra) {
	return E('div', { 'class': 'xp-card' }, [
		E('div', { 'class': 'xp-k' }, text(key)),
		E('div', { 'class': 'xp-v', 'title': typeof value == 'string' ? value : '' },
			typeof value == 'string' ? text(value) : value),
		sub ? E('div', { 'class': 'xp-s' }, text(sub)) : '',
		extra || ''
	]);
}

var STRATEGY = {
	leastPing: _('lowest latency'),
	roundRobin: _('round robin'),
	random: _('random')
};

return view.extend({
	load: function() {
		return Promise.all([
			// null (not {}) on failure, so a failed call is not shown as "Xray is off".
			L.resolveDefault(fs.exec_direct('/usr/share/xraypanel/status.sh', [], 'json'), null),
			L.resolveDefault(fs.exec_direct('/sbin/logread', [ '-l', '400', '-e', 'xray' ]), '')
		]);
	},

	tail: function(log) {
		var lines = (log || '').trim().split(/\n/).filter(function(l) { return /(xray\[\d+\]|xraypanel):/.test(l); });
		return lines.slice(-60).join('\n') || _('No log entries yet.');
	},

	refresh: function() {
		var self = this;
		return this.load().then(function(d) {
			self.update(d);
		});
	},

	runAction: function(action) {
		var self = this;
		return fs.exec_direct('/usr/share/xraypanel/ctl.sh', [ action ]).then(function(out) {
			out = (out || '').trim();
			var err = /^ERROR/.test(out);
			ui.addNotification(null, E('p', text(out.replace(/^(OK|ERROR):\s*/, '') || _('Done'))), err ? 'error' : 'info');
			return self.refresh();
		}).catch(function(e) {
			ui.addNotification(null, E('p', text(e.message)), 'error');
		});
	},

	renderHero: function(st) {
		var now = st.now || Math.floor(Date.now() / 1000);
		var cls, title, sub;
		var ms = st.last_ok ? Math.round(parseFloat(st.latency || 0) * 1000) : null;

		if (st.unavailable) {
			cls = 'off';
			title = _('Status unavailable');
			sub = _('The router did not answer the status request. It is retried every few seconds.');
		}
		else if (!st.enabled) {
			cls = 'off';
			title = _('Xray is off');
			sub = _('LAN traffic goes direct. Turn on "Enable Xray" on the Servers page.');
		}
		else if (!st.running) {
			cls = 'bad';
			title = _('Xray is not running');
			sub = _('LAN traffic goes direct so the internet keeps working.');
		}
		else if (st.active) {
			cls = 'ok';
			title = _('LAN traffic goes through Xray');
			sub = ms != null
				? _('Proxy answered in %d ms, %s').format(ms, fmtAgo(st.last_ok, now))
				: _('Proxy is answering');
		}
		else {
			cls = 'warn';
			title = _('LAN traffic goes direct for now');
			sub = st.fails > 0
				? _('The proxy did not answer %d time(s). The router switches back as soon as it does.').format(st.fails)
				: _('Waiting for the first proxy check.');
		}

		return E('div', { 'class': 'xp-hero ' + cls }, [
			E('div', { 'class': 'xp-dot' }),
			E('div', { 'class': 'xp-grow' }, [
				E('div', { 'class': 'xp-title' }, title),
				E('div', { 'class': 'xp-sub' }, sub)
			]),
			E('button', {
				'class': 'cbi-button',
				'click': ui.createHandlerFn(this, 'runAction', 'restart')
			}, _('Restart'))
		]);
	},

	renderCards: function(st) {
		var now = st.now || Math.floor(Date.now() / 1000);
		var servers = st.servers || [];
		var byName = {};
		servers.forEach(function(s) { byName[s.name] = s; });

		var inUse = (st.in_use || []).map(function(n) { return byName[n] ? byName[n].label : n; });
		var proxyDown = 0, proxyUp = 0;
		servers.forEach(function(s) { proxyDown += s.down || 0; proxyUp += s.up || 0; });
		var direct = st.direct || {};
		var directTotal = (direct.down || 0) + (direct.up || 0);
		var proxyTotal = proxyDown + proxyUp;
		var share = (proxyTotal + directTotal) ? Math.round(proxyTotal * 100 / (proxyTotal + directTotal)) : 0;

		var mode = st.mode == 'single' || (st.nodes || 0) < 2
			? _('one server')
			: _('balancing, %s').format(STRATEGY[st.strategy] || st.strategy);

		var ms = st.last_ok ? Math.round(parseFloat(st.latency || 0) * 1000) : null;

		return E('div', { 'class': 'xp-cards' }, [
			card(_('Latency'),
				ms != null ? E('span', { 'class': 'xp-ms ' + msClass(ms) }, ms + ' ms') : '-',
				st.last_ok ? _('checked %s').format(fmtAgo(st.last_ok, now)) : _('not checked yet')),
			card(_('Server in use'),
				inUse.length ? inUse.join(', ') : '-',
				_('%d enabled, %s').format(st.nodes || 0, mode)),
			card(_('Through proxy'),
				fmtBytes(proxyDown),
				_('down, %s up').format(fmtBytes(proxyUp)),
				E('div', { 'class': 'xp-bar', 'title': _('%d%% of traffic since Xray started').format(share) },
					E('div', { 'style': 'width:' + share + '%' }))),
			card(_('Direct'),
				fmtBytes(direct.down || 0),
				_('down, %s up (Iranian sites and local)').format(fmtBytes(direct.up || 0))),
			card(_('Memory'),
				fmtKB(st.rss_kb),
				_('Xray %s').format(st.version || '-')),
			card(_('Geo files'),
				fmtBytes(st.geo ? st.geo.geosite : null),
				_('updated %s').format(fmtAgo(st.geo_updated, now)))
		]);
	},

	renderServers: function(st) {
		var now = st.now || Math.floor(Date.now() / 1000);
		var inUse = {};
		(st.in_use || []).forEach(function(n) { inUse[n] = true; });
		var servers = st.servers || [];

		if (!servers.length)
			return E('p', { 'class': 'xp-muted' }, _('No servers yet. Add them on the Servers page.'));

		var rows = servers.map(function(s) {
			var t = s.test, lat;
			if (!s.enabled)
				lat = E('span', { 'class': 'xp-muted' }, _('disabled'));
			else if (!t)
				lat = E('span', { 'class': 'xp-muted' }, _('not tested'));
			else if (t.ok)
				lat = E('span', {}, [ E('span', { 'class': 'xp-ms ' + msClass(t.ms) }, t.ms + ' ms'),
					' ', E('span', { 'class': 'xp-muted' }, fmtAgo(t.at, now)) ]);
			else
				lat = E('span', {}, [ E('span', { 'class': 'xp-ms fail' }, t.code ? _('HTTP %d').format(t.code) : _('no answer')),
					' ', E('span', { 'class': 'xp-muted' }, fmtAgo(t.at, now)) ]);

			var state;
			if (!s.enabled) state = pill('#90a4ae', _('Off'));
			else if (s.active === false) state = pill('#c62828', _('Skipped'));
			else if (inUse[s.name]) state = pill('#2e7d32', _('In use'));
			else if (t && !t.ok) state = pill('#c62828', _('Down'));
			else state = pill('#1976d2', _('Ready'));

			return E('tr', {}, [
				E('td', {}, E('strong', {}, text(s.label))),
				E('td', {}, state),
				E('td', {}, lat),
				E('td', {}, s.enabled ? '%s ↓ / %s ↑'.format(fmtBytes(s.down || 0), fmtBytes(s.up || 0)) : '-')
			]);
		});

		return E('table', { 'class': 'xp-servers' }, [
			E('tr', {}, [ E('th', {}, _('Server')), E('th', {}, _('State')), E('th', {}, _('Latency')), E('th', {}, _('Traffic')) ])
		].concat(rows));
	},

	renderAlerts: function(st) {
		var out = [];
		if (st.error)
			out.push(E('div', { 'class': 'alert-message error', 'style': 'white-space:pre-wrap' }, text(st.error)));
		if (st.warnings)
			out.push(E('div', { 'class': 'alert-message warning', 'style': 'white-space:pre-wrap' }, text(st.warnings)));
		if (st.geo_result)
			out.push(E('div', { 'class': 'alert-message ' + (/^ERROR/.test(st.geo_result) ? 'error' : 'info'), 'style': 'white-space:pre-wrap' },
				text(_('Geo update: %s').format(st.geo_result.replace(/^(OK|ERROR):\s*/, '')))));
		return out;
	},

	update: function(d) {
		var st = d[0] || { unavailable: true };
		dom.content(this.heroBox, this.renderHero(st));
		dom.content(this.alertBox, this.renderAlerts(st));
		dom.content(this.cardBox, this.renderCards(st));
		dom.content(this.serverBox, this.renderServers(st));
		this.logBox.textContent = this.tail(d[1]);
	},

	render: function(data) {
		var self = this;

		this.heroBox = E('div');
		this.alertBox = E('div');
		this.cardBox = E('div');
		this.serverBox = E('div');
		this.logBox = E('pre', { 'class': 'xp-log' });
		this.update(data);

		poll.add(function() { return self.refresh(); }, 5);

		return E([], [
			E('style', {}, CSS),
			E('h2', _('Xray')),
			this.heroBox,
			this.alertBox,
			this.cardBox,
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'xp-head' }, [
					E('h3', _('Servers')),
					E('div', {}, [
						E('button', {
							'class': 'cbi-button cbi-button-action',
							'click': ui.createHandlerFn(this, 'runAction', 'test')
						}, _('Test all servers')),
						' ',
						E('button', {
							'class': 'cbi-button cbi-button-neutral',
							'click': ui.createHandlerFn(this, 'runAction', 'geo')
						}, _('Update geo files'))
					])
				]),
				this.serverBox
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('details', {}, [
					E('summary', { 'style': 'cursor:pointer;font-weight:600' }, _('Log')),
					this.logBox
				])
			]),
			E('p', { 'class': 'xp-muted', 'style': 'font-size:.85em' },
				_('LAN traffic only goes through Xray while the proxy answers. If it stops answering, the router switches LAN back to direct automatically. Traffic counters reset when Xray restarts.'))
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
