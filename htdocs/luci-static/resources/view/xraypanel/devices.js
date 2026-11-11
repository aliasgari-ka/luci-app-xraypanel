'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require uci';

function toArray(v) {
	if (v == null) return [];
	if (Array.isArray(v)) return v;
	return String(v).split(/\s+/).filter(function(s) { return s.length; });
}

function badge(kind, text) {
	var bg = kind === 'proxy' ? '#2e7d32' : kind === 'direct' ? '#ef6c00' : '#888';
	return E('span', {
		style: 'display:inline-block;padding:1px 8px;border-radius:4px;font-weight:600;color:#fff;background:' + bg
	}, text);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.exec_direct('/usr/share/xraypanel/devices.sh', [], 'json'), []),
			uci.load('xraypanel')
		]);
	},

	// Rebuild the bypass list: keep whatever the device table does not manage
	// (e.g. CIDR ranges set on the Settings page), then add the ticked devices.
	collectAndSave: function() {
		var self = this;
		var boxes = this.tableBox.querySelectorAll('input[type="checkbox"][data-ip]');
		var deviceIps = {}, checked = [];
		boxes.forEach(function(b) {
			deviceIps[b.getAttribute('data-ip')] = true;
			if (b.checked) checked.push(b.getAttribute('data-ip'));
		});

		var preserved = toArray(uci.get('xraypanel', 'main', 'bypass_src')).filter(function(ip) {
			return !deviceIps[ip];
		});

		var seen = {}, list = [];
		preserved.concat(checked).forEach(function(ip) {
			if (!seen[ip]) { seen[ip] = true; list.push(ip); }
		});

		return fs.exec_direct('/usr/share/xraypanel/ctl.sh', [ 'bypass' ].concat(list)).then(function(out) {
			out = (out || '').trim();
			var err = /^ERROR/.test(out);
			ui.addNotification(null, E('p', out.replace(/^(OK|ERROR):\s*/, '') || _('Saved')), err ? 'error' : 'info');
			return self.refresh();
		}).catch(function(e) {
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
			dom.content(self.tableBox, self.renderTable(Array.isArray(d[0]) ? d[0] : []));
		});
	},

	renderTable: function(devs) {
		// Order: proxied first, then direct-by-network, then offline; by IP within.
		devs.sort(function(a, b) {
			var ra = a.proxied ? 0 : (a.online ? 1 : 2);
			var rb = b.proxied ? 0 : (b.online ? 1 : 2);
			if (ra !== rb) return ra - rb;
			return (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true });
		});

		if (!devs.length)
			return E('div', { 'class': 'cbi-value' }, _('No devices found yet. Connect a device or refresh.'));

		var rows = devs.map(function(d) {
			var manageable = d.proxied || d.bypassed;
			var control;

			if (manageable) {
				var attrs = { type: 'checkbox', 'data-ip': d.ip, style: 'transform:scale(1.3);margin-right:8px' };
				if (d.bypassed) attrs.checked = 'checked';
				control = E('label', { style: 'cursor:pointer' }, [
					E('input', attrs),
					d.bypassed ? badge('direct', _('Direct (bypass)')) : badge('proxy', _('Through proxy'))
				]);
			} else {
				control = badge('off', _('Direct (by network)'));
			}

			var where = d.iface ? d.iface : _('offline');

			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, d.host || '-'),
				E('td', { 'class': 'td left' }, d.ip || '-'),
				E('td', { 'class': 'td left', style: 'font-family:monospace' }, d.mac || '-'),
				E('td', { 'class': 'td left' }, where),
				E('td', { 'class': 'td left' }, control)
			]);
		});

		var head = E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th left' }, _('Device')),
			E('th', { 'class': 'th left' }, _('IP')),
			E('th', { 'class': 'th left' }, _('MAC')),
			E('th', { 'class': 'th left' }, _('Network')),
			E('th', { 'class': 'th left' }, _('Routing'))
		]);

		return E('table', { 'class': 'table' }, [ head ].concat(rows));
	},

	render: function(data) {
		var self = this;
		var devs = Array.isArray(data[0]) ? data[0] : [];
		this.tableBox = E('div', {}, this.renderTable(devs));

		return E([], [
			E('h2', _('Devices')),
			E('div', { 'class': 'cbi-map-descr' },
				_('By default a device is routed by the Wi-Fi it joins: networks routed through Xray (Settings, Interfaces to route) go through the proxy, other networks go direct. ' +
				  'Here you can make an exception: tick a device on the proxied network to send it out directly instead. ' +
				  'Devices on the direct-only network are shown read-only.')),
			E('div', { 'class': 'cbi-section' }, this.tableBox),
			E('div', { 'class': 'cbi-section' }, [
				E('button', {
					'class': 'cbi-button cbi-button-save',
					'click': ui.createHandlerFn(this, 'collectAndSave')
				}, _('Save')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(this, 'refresh')
				}, _('Refresh'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
