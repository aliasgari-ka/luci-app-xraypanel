'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require poll';

function fmtKB(n) {
	if (n == null) return '-';
	return (n / 1024).toFixed(1) + ' MB';
}

function fmtBytes(n) {
	if (n == null) return _('missing');
	if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
	return (n / 1048576).toFixed(1) + ' MB';
}

function fmtAgo(ts, now) {
	if (!ts) return _('never');
	var d = Math.max(0, now - ts);
	if (d < 90) return _('%d seconds ago').format(d);
	if (d < 5400) return _('%d minutes ago').format(Math.round(d / 60));
	if (d < 172800) return _('%d hours ago').format(Math.round(d / 3600));
	return _('%d days ago').format(Math.round(d / 86400));
}

function badge(ok, text) {
	return E('span', {
		style: 'display:inline-block;padding:1px 8px;border-radius:4px;font-weight:600;color:#fff;background:' +
			(ok === true ? '#2e7d32' : ok === false ? '#c62828' : '#888')
	}, text);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.exec_direct('/usr/share/xraypanel/status.sh', [], 'json'), {}),
			L.resolveDefault(fs.exec_direct('/sbin/logread', [ '-l', '400', '-e', 'xray' ]), '')
		]);
	},

	tail: function(log) {
		var lines = (log || '').trim().split(/\n/).filter(function(l) { return /(xray\[\d+\]|xraypanel):/.test(l); });
		return lines.slice(-60).join('\n') || _('No log entries yet.');
	},

	runAction: function(action) {
		return fs.exec_direct('/usr/share/xraypanel/ctl.sh', [ action ]).then(function(out) {
			out = (out || '').trim();
			var err = /^ERROR/.test(out);
			ui.addNotification(null, E('p', out.replace(/^(OK|ERROR):\s*/, '') || _('Done')), err ? 'error' : 'info');
		}).catch(function(e) {
			ui.addNotification(null, E('p', e.message), 'error');
		});
	},

	renderStatus: function(st) {
		var now = st.now || Math.floor(Date.now() / 1000);
		var routing;

		if (!st.enabled)
			routing = badge(null, _('Off'));
		else if (st.active)
			routing = badge(true, _('Through Xray'));
		else if (st.running)
			routing = badge(false, st.fails > 0 ? _('Direct (proxy not answering)') : _('Direct (checking proxy)'));
		else
			routing = badge(false, _('Direct (Xray stopped)'));

		var rows = [
			[ _('Service'), st.enabled
				? (st.running ? badge(true, _('Running')) : badge(false, _('Not running')))
				: badge(null, _('Disabled')) ],
			[ _('LAN traffic'), routing ],
			[ _('Proxy check'), st.last_ok
				? _('%s ms, last success %s').format(Math.round(parseFloat(st.latency || 0) * 1000), fmtAgo(st.last_ok, now))
				: (st.enabled ? _('waiting for first check') : '-') ],
			[ _('Servers'), _('%d enabled').format(st.nodes || 0) ],
			[ _('Memory used by Xray'), fmtKB(st.rss_kb) ],
			[ _('Geo files'), 'geoip %s, geosite %s, %s'.format(
				fmtBytes(st.geo ? st.geo.geoip : null),
				fmtBytes(st.geo ? st.geo.geosite : null),
				_('updated %s').format(fmtAgo(st.geo_updated, now))) ],
			[ _('Xray version'), st.version || '-' ]
		];

		var table = E('table', { 'class': 'table' }, rows.map(function(r) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '30%' }, r[0]),
				E('td', { 'class': 'td left' }, r[1])
			]);
		}));

		var extra = [];
		if (st.error)
			extra.push(E('div', { 'class': 'alert-message error', 'style': 'white-space:pre-wrap' }, st.error));
		if (st.warnings)
			extra.push(E('div', { 'class': 'alert-message warning', 'style': 'white-space:pre-wrap' }, st.warnings));
		if (st.balancer)
			extra.push(E('div', { 'class': 'cbi-section' }, [
				E('h3', _('Load balancer')),
				E('pre', { 'style': 'font-size:12px;white-space:pre-wrap' }, st.balancer)
			]));

		return E('div', {}, [ table ].concat(extra));
	},

	render: function(data) {
		var self = this;
		var statusBox = E('div', {}, this.renderStatus(data[0] || {}));
		var logBox = E('pre', {
			'style': 'max-height:28em;overflow:auto;font-size:12px;white-space:pre-wrap'
		}, this.tail(data[1]));

		poll.add(function() {
			return self.load().then(function(d) {
				dom.content(statusBox, self.renderStatus(d[0] || {}));
				logBox.textContent = self.tail(d[1]);
			});
		}, 5);

		return E([], [
			E('h2', _('Xray')),
			E('div', { 'class': 'cbi-map-descr' },
				_('LAN traffic only goes through Xray while the proxy answers. If it stops answering, the router switches LAN back to direct automatically.')),
			E('div', { 'class': 'cbi-section' }, statusBox),
			E('div', { 'class': 'cbi-section' }, [
				E('button', {
					'class': 'cbi-button cbi-button-apply',
					'click': ui.createHandlerFn(this, 'runAction', 'restart')
				}, _('Restart')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(this, 'runAction', 'geo')
				}, _('Update geo files now'))
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', _('Log')),
				logBox
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
