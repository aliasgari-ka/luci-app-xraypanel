'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require uci';

var MODE_PROXY = 'proxy', MODE_DIRECT = 'direct';

function toArray(v) {
	if (v == null) return [];
	if (Array.isArray(v)) return v;
	return String(v).split(/\s+/).filter(function(s) { return s.length; });
}

function badge(kind, text) {
	var bg = kind === MODE_PROXY ? '#2e7d32' : kind === MODE_DIRECT ? '#ef6c00' : '#757575';
	return E('span', {
		style: 'display:inline-block;padding:2px 10px;border-radius:10px;font-weight:600;font-size:90%;color:#fff;white-space:nowrap;background:' + bg
	}, text);
}

function modeLabel(mode) {
	return mode === MODE_DIRECT ? _('Direct (bypass)') : _('Through proxy (routing rules)');
}

function devName(d) {
	return d.host ? d.host + ' (' + d.ip + ')' : d.ip;
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.exec_direct('/usr/share/xraypanel/devices.sh', [], 'json'), []),
			uci.load('xraypanel')
		]);
	},

	// The pending choice of each manageable device, keyed by IP.
	pending: null,
	devs: null,

	changes: function() {
		var self = this;
		return this.devs.filter(function(d) {
			return self.pending[d.ip] != null && self.pending[d.ip] !== (d.bypassed ? MODE_DIRECT : MODE_PROXY);
		});
	},

	updateBar: function() {
		var n = this.changes().length;
		this.saveBtn.disabled = !n;
		this.resetBtn.disabled = !n;
		dom.content(this.statusText, n
			? E('strong', { style: 'color:#ef6c00' }, n === 1 ? _('1 unsaved change') : _('%d unsaved changes').format(n))
			: E('span', { style: 'opacity:.7' }, _('No unsaved changes')));
	},

	onSelect: function(d, row, ev) {
		var mode = ev.target.value;
		this.pending[d.ip] = mode;
		var changed = mode !== (d.bypassed ? MODE_DIRECT : MODE_PROXY);
		row.style.background = changed ? 'rgba(239,108,0,.12)' : '';
		row.style.boxShadow = changed ? 'inset 4px 0 0 #ef6c00' : '';
		dom.content(row.querySelector('.xp-now'), badge(mode, mode === MODE_DIRECT ? _('Direct') : _('Proxy')));
		this.updateBar();
	},

	resetChanges: function() {
		this.pending = {};
		dom.content(this.tableBox, this.renderTable());
		this.updateBar();
	},

	// Shows what will change and asks before saving.
	confirmSave: function() {
		var self = this, list = this.changes();
		if (!list.length) return;

		ui.showModal(_('Save routing changes?'), [
			E('p', _('These devices will change:')),
			E('ul', {}, list.map(function(d) {
				var to = self.pending[d.ip];
				return E('li', { style: 'margin:4px 0' }, [
					E('strong', devName(d)), ': ',
					badge(d.bypassed ? MODE_DIRECT : MODE_PROXY, d.bypassed ? _('Direct') : _('Proxy')),
					' → ',
					badge(to, to === MODE_DIRECT ? _('Direct') : _('Proxy'))
				]);
			})),
			E('p', { style: 'opacity:.8' }, _('It applies right away. Xray is not restarted and other devices are not interrupted.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.hideModal }, _('Cancel')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-positive important',
					'click': ui.createHandlerFn(this, function() { return self.save(); })
				}, _('Confirm and save'))
			])
		]);
	},

	// Rebuild the bypass list: keep whatever this table does not manage
	// (e.g. CIDR ranges set on the Settings page), then add the devices set to direct.
	save: function() {
		var self = this, managed = {}, direct = [];
		this.devs.forEach(function(d) {
			if (!(d.proxied || d.bypassed)) return;
			managed[d.ip] = true;
			var mode = self.pending[d.ip] || (d.bypassed ? MODE_DIRECT : MODE_PROXY);
			if (mode === MODE_DIRECT) direct.push(d.ip);
		});

		var seen = {}, list = [];
		toArray(uci.get('xraypanel', 'main', 'bypass_src')).filter(function(ip) {
			return !managed[ip];
		}).concat(direct).forEach(function(ip) {
			if (!seen[ip]) { seen[ip] = true; list.push(ip); }
		});

		return fs.exec_direct('/usr/share/xraypanel/ctl.sh', [ 'bypass' ].concat(list)).then(function(out) {
			out = (out || '').trim();
			ui.hideModal();
			var err = !/^OK/.test(out);
			ui.addNotification(null, E('p', err ? (out.replace(/^ERROR:\s*/, '') || _('Saving failed')) :
				_('Saved and applied: %s').format(out.replace(/^OK:\s*/, ''))), err ? 'error' : 'info');
			return self.refresh();
		}).catch(function(e) {
			ui.hideModal();
			ui.addNotification(null, E('p', e.message), 'error');
		});
	},

	refresh: function() {
		var self = this;
		uci.unload('xraypanel');
		return Promise.all([
			L.resolveDefault(fs.exec_direct('/usr/share/xraypanel/devices.sh', [], 'json'), []),
			uci.load('xraypanel')
		]).then(function(d) {
			self.setDevs(d[0]);
			dom.content(self.tableBox, self.renderTable());
			dom.content(self.summaryBox, self.renderSummary());
			self.updateBar();
		});
	},

	setDevs: function(list) {
		var devs = Array.isArray(list) ? list : [];
		// Order: proxied network first, then direct-by-network, then offline; by IP within.
		devs.sort(function(a, b) {
			var ra = a.proxied ? 0 : (a.online ? 1 : 2);
			var rb = b.proxied ? 0 : (b.online ? 1 : 2);
			if (ra !== rb) return ra - rb;
			return (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true });
		});
		this.devs = devs;
		this.pending = {};
	},

	renderSummary: function() {
		var p = 0, dr = 0, net = 0;
		this.devs.forEach(function(d) {
			if (d.bypassed) dr++;
			else if (d.proxied) p++;
			else net++;
		});
		return E('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px' }, [
			badge(MODE_PROXY, _('Through proxy: %d').format(p)),
			badge(MODE_DIRECT, _('Direct (bypass): %d').format(dr)),
			badge('net', _('Direct by Wi-Fi network: %d').format(net))
		]);
	},

	renderTable: function() {
		var self = this;

		if (!this.devs.length)
			return E('div', { 'class': 'cbi-value' }, _('No devices found yet. Connect a device or press Refresh.'));

		var rows = this.devs.map(function(d) {
			var row = E('tr', { 'class': 'tr' });
			var control, now;

			if (d.proxied || d.bypassed) {
				var cur = d.bypassed ? MODE_DIRECT : MODE_PROXY;
				var sel = E('select', {
					'class': 'cbi-input-select',
					'data-ip': d.ip,
					style: 'min-width:15em',
					'change': function(ev) { self.onSelect(d, row, ev); }
				}, [ MODE_PROXY, MODE_DIRECT ].map(function(m) {
					var a = { value: m };
					if (m === cur) a.selected = 'selected';
					return E('option', a, modeLabel(m));
				}));
				control = sel;
				now = badge(cur, cur === MODE_DIRECT ? _('Direct') : _('Proxy'));
			} else {
				control = E('em', { style: 'opacity:.75' }, _('Direct: its Wi-Fi is not routed through Xray'));
				now = badge('net', _('Direct'));
			}

			var name = d.host || E('span', { style: 'opacity:.6' }, _('unnamed'));
			var where = d.iface ? d.iface : E('span', { style: 'opacity:.6' }, _('offline'));

			dom.content(row, [
				E('td', { 'class': 'td left', 'data-title': _('Device') }, [ E('strong', {}, name), E('br'),
					E('small', { style: 'font-family:monospace;opacity:.7' }, d.mac || '') ]),
				E('td', { 'class': 'td left', 'data-title': _('IP') }, d.ip || '-'),
				E('td', { 'class': 'td left', 'data-title': _('Network') }, where),
				E('td', { 'class': 'td left xp-now', 'data-title': _('Now') }, now),
				E('td', { 'class': 'td left', 'data-title': _('Route') }, control)
			]);
			return row;
		});

		var head = E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th left' }, _('Device')),
			E('th', { 'class': 'th left' }, _('IP')),
			E('th', { 'class': 'th left' }, _('Network')),
			E('th', { 'class': 'th left' }, _('Now')),
			E('th', { 'class': 'th left' }, _('Route'))
		]);

		return E('table', { 'class': 'table' }, [ head ].concat(rows));
	},

	render: function(data) {
		this.setDevs(data[0]);
		this.tableBox = E('div', {}, this.renderTable());
		this.summaryBox = E('div', {}, this.renderSummary());
		this.statusText = E('span');

		this.saveBtn = E('button', {
			'class': 'cbi-button cbi-button-save',
			'click': ui.createHandlerFn(this, 'confirmSave')
		}, _('Save…'));
		this.resetBtn = E('button', {
			'class': 'cbi-button cbi-button-reset',
			'click': ui.createHandlerFn(this, 'resetChanges')
		}, _('Undo changes'));

		var bar = E('div', {
			'class': 'cbi-section',
			style: 'display:flex;flex-wrap:wrap;align-items:center;gap:8px'
		}, [
			this.saveBtn, this.resetBtn,
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': ui.createHandlerFn(this, 'refresh')
			}, _('Refresh')),
			this.statusText
		]);

		var page = E([], [
			E('h2', _('Devices')),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Choose for each device how it reaches the internet:'),
				E('ul', { style: 'margin:6px 0 0 1.2em' }, [
					E('li', {}, [ E('strong', {}, _('Through proxy (routing rules)')), ': ',
						_('traffic goes through Xray, and the Routing page decides per site (Iranian sites still go direct).') ]),
					E('li', {}, [ E('strong', {}, _('Direct (bypass)')), ': ',
						_('the device skips Xray completely.') ])
				]),
				E('p', { style: 'margin-top:6px' },
					_('Devices on a Wi-Fi that is not routed through Xray (Settings, Interfaces to route) are always direct and shown read-only. Pick a choice, then press Save and confirm.'))
			]),
			this.summaryBox,
			E('div', { 'class': 'cbi-section' }, this.tableBox),
			bar
		]);

		this.updateBar();
		return page;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
