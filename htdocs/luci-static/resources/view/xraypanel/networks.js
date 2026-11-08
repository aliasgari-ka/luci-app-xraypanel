'use strict';
'require view';
'require uci';
'require ui';
'require dom';
'require network';

// Wi-Fi networks grouped by name: one entry can cover both radios.
// A network goes through Xray when its interface's device is in xraypanel.main.lan_ifaces.

var CSS = [
	'.xn-table{width:100%;border-collapse:collapse}',
	'.xn-table th{text-align:left;font-weight:600;font-size:.85em;opacity:.7;padding:6px 8px;border-bottom:1px solid rgba(128,128,128,.3)}',
	'.xn-table td{padding:9px 8px;border-bottom:1px solid rgba(128,128,128,.15);vertical-align:middle}',
	'.xn-pill{display:inline-block;padding:1px 9px;border-radius:10px;font-size:.8em;font-weight:600;color:#fff}',
	'.xn-muted{opacity:.6}',
	'.xn-ssid{font-weight:700;font-size:1.05em}',
	'.xn-form .cbi-value{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}',
	'.xn-form .cbi-value-title{width:140px;font-weight:600}',
	'.xn-route{display:block;margin:4px 0}'
].join('\n');

var SECURITY = [
	[ 'sae-mixed', _('WPA2/WPA3 (recommended)') ],
	[ 'psk2', _('WPA2 (older devices)') ],
	[ 'sae', _('WPA3 only') ],
	[ 'none', _('Open, no password') ]
];

function pill(color, text) {
	return E('span', { 'class': 'xn-pill', 'style': 'background:' + color }, text);
}

function bandName(radio) {
	var b = uci.get('wireless', radio, 'band');
	return b == '2g' ? '2.4 GHz' : b == '5g' ? '5 GHz' : b == '6g' ? '6 GHz' : radio;
}

function proxiedDevices() {
	var v = uci.get('xraypanel', 'main', 'lan_ifaces');
	return L.toArray(v);
}

// LAN-side interfaces a Wi-Fi network can join, with whether each goes through Xray.
function routes() {
	var prox = proxiedDevices();
	return uci.sections('network', 'interface').filter(function(s) {
		return s.proto == 'static' && s['.name'] != 'loopback' && s.device && /^br-/.test(s.device);
	}).map(function(s) {
		return {
			name: s['.name'],
			device: s.device,
			addr: s.ipaddr || '',
			proxied: prox.indexOf(s.device) > -1
		};
	});
}

function groups() {
	var map = {}, list = [];
	uci.sections('wireless', 'wifi-iface').forEach(function(s) {
		if (s.mode != 'ap') return;
		var key = [ s.ssid, s.network, s.encryption, s.key ].join('\x00');
		if (!map[key]) {
			map[key] = {
				ssid: s.ssid || '',
				network: s.network || '',
				encryption: s.encryption || 'none',
				key: s.key || '',
				disabled: s.disabled == '1',
				sids: [], radios: []
			};
			list.push(map[key]);
		}
		map[key].sids.push(s['.name']);
		map[key].radios.push(s.device);
		if (s.disabled != '1') map[key].disabled = false;
	});
	return list;
}

function freeSubnet() {
	var used = {};
	uci.sections('network', 'interface').forEach(function(s) {
		var m = String(s.ipaddr || '').match(/^192\.168\.(\d+)\./);
		if (m) used[m[1]] = true;
	});
	for (var i = 2; i < 250; i++)
		if (!used[i]) return i;
	return null;
}

return view.extend({
	load: function() {
		return uci.load([ 'wireless', 'network', 'firewall', 'dhcp', 'xraypanel' ]);
	},

	// Client counts are slow to read (about a second per radio), so they fill in after the page shows.
	loadClients: function() {
		var self = this;
		return L.resolveDefault(network.getWifiNetworks(), []).then(function(nets) {
			return Promise.all(nets.map(function(n) {
				return L.resolveDefault(n.getAssocList(), []).then(function(a) {
					self.clients[n.sid] = a.length;
				});
			}));
		}).then(function() {
			dom.content(self.listBox, self.renderList());
		});
	},

	// Creates a separate network that never goes through Xray: bridge, subnet, DHCP and a firewall zone to WAN.
	createDirect: function() {
		var n = freeSubnet();
		var name = uci.get('network', 'direct') ? 'direct' + n : 'direct';
		var dev = 'br-' + name;

		var d = uci.add('network', 'device');
		uci.set('network', d, 'name', dev);
		uci.set('network', d, 'type', 'bridge');

		uci.add('network', 'interface', name);
		uci.set('network', name, 'proto', 'static');
		uci.set('network', name, 'device', dev);
		uci.set('network', name, 'ipaddr', '192.168.' + n + '.1');
		uci.set('network', name, 'netmask', '255.255.255.0');

		uci.add('dhcp', 'dhcp', name);
		uci.set('dhcp', name, 'interface', name);
		uci.set('dhcp', name, 'start', '100');
		uci.set('dhcp', name, 'limit', '150');
		uci.set('dhcp', name, 'leasetime', '12h');

		var z = uci.add('firewall', 'zone');
		uci.set('firewall', z, 'name', name);
		uci.set('firewall', z, 'network', [ name ]);
		uci.set('firewall', z, 'input', 'ACCEPT');
		uci.set('firewall', z, 'output', 'ACCEPT');
		uci.set('firewall', z, 'forward', 'REJECT');

		var f = uci.add('firewall', 'forwarding');
		uci.set('firewall', f, 'src', name);
		uci.set('firewall', f, 'dest', 'wan');

		return name;
	},

	openEditor: function(g) {
		var self = this;
		var isNew = !g;
		var rts = routes();
		var radios = uci.sections('wireless', 'wifi-device').map(function(r) { return r['.name']; });
		g = g || {
			ssid: '', network: (rts.filter(function(r) { return r.proxied; })[0] || rts[0] || {}).name || 'lan',
			encryption: 'sae-mixed', key: '', disabled: false, sids: [], radios: radios.slice()
		};

		var ssid = new ui.Textfield(g.ssid, { placeholder: _('Network name'), validate: function(v) {
			v = v || '';
			if (!v.length) return _('Enter a name');
			if (new Blob([ v ]).size > 32) return _('Too long (32 bytes max)');
			return true;
		} });
		var sec = new ui.Select(g.encryption, SECURITY.reduce(function(o, s) { o[s[0]] = s[1]; return o; }, {}), { sort: false });
		var key = new ui.Textfield(g.key, { password: true, placeholder: _('At least 8 characters'), validate: function(v) {
			if (sec.getValue() == 'none') return true;
			v = v || '';
			if (v.length < 8 || v.length > 63) return _('8 to 63 characters');
			return true;
		} });
		var bands = radios.map(function(r) {
			return E('label', { 'style': 'margin-right:14px' }, [
				E('input', { 'type': 'checkbox', 'value': r, 'checked': g.radios.indexOf(r) > -1 ? '' : null }),
				' ', bandName(r)
			]);
		});

		var routeOpts = rts.map(function(r) {
			return E('label', { 'class': 'xn-route' }, [
				E('input', { 'type': 'radio', 'name': 'xn-route', 'value': r.name, 'checked': r.name == g.network ? '' : null }),
				' ', E('strong', {}, r.name), ' ',
				r.proxied ? pill('#2e7d32', _('Through Xray')) : pill('#1976d2', _('Direct')),
				' ', E('span', { 'class': 'xn-muted' }, r.addr)
			]);
		});
		var hasDirect = rts.some(function(r) { return !r.proxied; });
		if (!hasDirect)
			routeOpts.push(E('label', { 'class': 'xn-route' }, [
				E('input', { 'type': 'radio', 'name': 'xn-route', 'value': '__new_direct' }),
				' ', _('New direct network'), ' ', pill('#1976d2', _('Direct')),
				' ', E('span', { 'class': 'xn-muted' }, _('creates its own subnet'))
			]));

		var body = E('div', { 'class': 'xn-form' }, [
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Name (SSID)')), ssid.render() ]),
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Security')), sec.render() ]),
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Password')), key.render() ]),
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Bands')), E('div', {}, bands) ]),
			E('div', { 'class': 'cbi-value', 'style': 'align-items:flex-start' }, [
				E('div', { 'class': 'cbi-value-title' }, _('Internet route')),
				E('div', {}, routeOpts)
			]),
			E('p', { 'class': 'xn-muted' }, _('Devices on a "Through Xray" network use the proxy rules. Devices on a "Direct" network never touch Xray.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
					ssid.triggerValidation(); key.triggerValidation();
					if (!ssid.isValid() || !key.isValid()) return;
					var chosen = body.querySelectorAll('input[type=checkbox]:checked');
					var picked = Array.prototype.map.call(chosen, function(i) { return i.value; });
					if (!picked.length) { ui.addNotification(null, E('p', _('Pick at least one band')), 'warning'); return; }
					var r = body.querySelector('input[name=xn-route]:checked');
					var net = r ? r.value : g.network;
					if (net == '__new_direct') net = self.createDirect();
					self.save(g, {
						ssid: ssid.getValue(), encryption: sec.getValue(),
						key: sec.getValue() == 'none' ? '' : key.getValue(),
						network: net, radios: picked
					});
				} }, isNew ? _('Add') : _('Save'))
			])
		]);

		ui.showModal(isNew ? _('New Wi-Fi network') : _('Edit Wi-Fi network'), body);
	},

	save: function(g, v) {
		var bySid = {};
		g.sids.forEach(function(sid, i) { bySid[g.radios[i]] = sid; });

		// Remove radios that were unticked.
		g.radios.forEach(function(r) {
			if (v.radios.indexOf(r) < 0) uci.remove('wireless', bySid[r]);
		});

		v.radios.forEach(function(r) {
			var sid = bySid[r];
			if (!sid) {
				sid = uci.add('wireless', 'wifi-iface');
				uci.set('wireless', sid, 'device', r);
				uci.set('wireless', sid, 'mode', 'ap');
			}
			uci.set('wireless', sid, 'ssid', v.ssid);
			uci.set('wireless', sid, 'network', v.network);
			uci.set('wireless', sid, 'encryption', v.encryption);
			uci.set('wireless', sid, 'key', v.key || null);
			if (g.disabled) uci.set('wireless', sid, 'disabled', '1');
		});

		ui.hideModal();
		return this.commit();
	},

	toggle: function(g) {
		g.sids.forEach(function(sid) {
			uci.set('wireless', sid, 'disabled', g.disabled ? null : '1');
		});
		return this.commit();
	},

	remove: function(g) {
		var self = this;
		ui.showModal(_('Delete Wi-Fi network'), [
			E('p', _('Delete "%s"? Devices connected to it will be disconnected.').format(g.ssid)),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() {
					g.sids.forEach(function(sid) { uci.remove('wireless', sid); });
					ui.hideModal();
					self.commit();
				} }, _('Delete'))
			])
		]);
	},

	// Saves to the staging area; LuCI's "Save & Apply" bar applies with automatic rollback.
	commit: function() {
		var self = this;
		dom.content(self.listBox, self.renderList());
		return uci.save().then(function() {
			return uci.load([ 'wireless', 'network', 'firewall', 'dhcp' ]);
		}).then(function() {
			dom.content(self.listBox, self.renderList());
			ui.changes.init();
			ui.addNotification(null, E('p', _('Saved. Press "Save & Apply" below to put it live. Wi-Fi restarts for a few seconds.')), 'info');
		}).catch(function(e) {
			ui.addNotification(null, E('p', e.message), 'error');
		});
	},

	renderList: function() {
		var self = this;
		var rts = {};
		routes().forEach(function(r) { rts[r.name] = r; });
		var gs = groups();
		var clients = this.clients || {};

		if (!gs.length)
			return E('p', { 'class': 'xn-muted' }, _('No Wi-Fi networks yet.'));

		var rows = gs.map(function(g) {
			var r = rts[g.network];
			var route = !r ? pill('#90a4ae', g.network || _('none'))
				: r.proxied ? pill('#2e7d32', _('Through Xray')) : pill('#1976d2', _('Direct'));
			var n = 0;
			g.sids.forEach(function(sid) { n += clients[sid] || 0; });

			return E('tr', { 'style': g.disabled ? 'opacity:.55' : '' }, [
				E('td', {}, [ E('div', { 'class': 'xn-ssid' }, g.ssid),
					E('div', { 'class': 'xn-muted', 'style': 'font-size:.85em' },
						(SECURITY.filter(function(s) { return s[0] == g.encryption; })[0] || [ 0, g.encryption ])[1]) ]),
				E('td', {}, g.radios.map(bandName).join(' + ')),
				E('td', {}, [ route, ' ', E('span', { 'class': 'xn-muted' }, g.network) ]),
				E('td', {}, g.disabled ? E('span', { 'class': 'xn-muted' }, _('off'))
					: self.clientsLoaded ? String(n) : E('span', { 'class': 'xn-muted' }, '…')),
				E('td', { 'class': 'right', 'style': 'white-space:nowrap' }, [
					E('button', { 'class': 'cbi-button cbi-button-edit', 'click': function() { self.openEditor(g); } }, _('Edit')), ' ',
					E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': function() { self.toggle(g); } },
						g.disabled ? _('Turn on') : _('Turn off')), ' ',
					E('button', { 'class': 'cbi-button cbi-button-remove', 'click': function() { self.remove(g); } }, _('Delete'))
				])
			]);
		});

		return E('table', { 'class': 'xn-table' }, [
			E('tr', {}, [ E('th', {}, _('Network')), E('th', {}, _('Bands')), E('th', {}, _('Internet route')),
				E('th', {}, _('Devices')), E('th', {}) ])
		].concat(rows));
	},

	render: function() {
		var self = this;
		this.clients = {};
		this.listBox = E('div', {}, this.renderList());
		this.loadClients().then(function() {
			self.clientsLoaded = true;
			dom.content(self.listBox, self.renderList());
		});

		return E([], [
			E('style', {}, CSS),
			E('h2', _('Wi-Fi networks')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Make Wi-Fi networks that go through Xray or straight to the internet. Changes are staged until you press "Save & Apply"; if you lose access, the router undoes them by itself.')),
			E('div', { 'class': 'cbi-section' }, [
				this.listBox,
				E('div', { 'style': 'margin-top:12px' },
					E('button', { 'class': 'cbi-button cbi-button-add', 'click': ui.createHandlerFn(this, 'openEditor', null) }, _('Add Wi-Fi network')))
			])
		]);
	},

	// The default Save & Apply applies the staged changes with rollback; there is no form to save.
	handleSave: function() { return Promise.resolve(); },
	handleReset: null
});
