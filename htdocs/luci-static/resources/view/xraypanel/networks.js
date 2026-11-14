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

var MACFILTER = {
	'': _('Off'),
	'allow': _('Only allow these devices'),
	'deny': _('Block these devices')
};

// Accepts aa:bb:cc:dd:ee:ff or aa-bb-cc-dd-ee-ff; returns it lowercase with colons, or null.
function normMac(s) {
	s = String(s || '').trim().toLowerCase().replace(/-/g, ':');
	return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(s) ? s : null;
}

function macLines(v) {
	return String(v || '').split(/[\s,]+/).filter(function(s) { return s.length; });
}

// LuCI's E() inserts a plain string as HTML but an array of strings as text.
// SSIDs, network names and addresses go through text().
function text(s) {
	return [ s == null ? '' : '' + s ];
}

function pill(color, label) {
	return E('span', { 'class': 'xn-pill', 'style': 'background:' + color }, text(label));
}

// The known choices plus the network's current value, so editing never changes it silently.
function securityChoices(current) {
	var o = {};
	SECURITY.forEach(function(s) { o[s[0]] = s[1]; });
	if (current && !o[current]) o[current] = current;
	return o;
}

function enableRadio(radio) {
	if (uci.get('wireless', radio, 'disabled') == '1')
		uci.unset('wireless', radio, 'disabled');
}

function bandName(radio) {
	var b = uci.get('wireless', radio, 'band');
	return b == '2g' ? '2.4 GHz' : b == '5g' ? '5 GHz' : b == '6g' ? '6 GHz' : radio;
}

function proxiedDevices() {
	var v = L.toArray(uci.get('xraypanel', 'main', 'lan_ifaces'));
	// Same default as firewall.sh: an empty list means br-lan.
	return v.length ? v : [ 'br-lan' ];
}

// main.net_out holds "network=node-x": that network's proxied traffic uses that server.
function netServers() {
	var m = {};
	L.toArray(uci.get('xraypanel', 'main', 'net_out')).forEach(function(e) {
		var i = e.indexOf('=');
		if (i > 0) m[e.substring(0, i)] = e.substring(i + 1);
	});
	return m;
}

function setNetServer(net, out) {
	var m = netServers();
	if (out) m[net] = out; else delete m[net];
	var v = Object.keys(m).map(function(k) { return k + '=' + m[k]; });
	uci.set('xraypanel', 'main', 'net_out', v.length ? v : null);
}

function servers() {
	return uci.sections('xraypanel', 'node').filter(function(n) { return n.enabled != '0'; }).map(function(n) {
		return { tag: 'node-' + n['.name'], label: n.label || n['.name'] };
	});
}

function subs() {
	return uci.sections('xraypanel', 'subscription').map(function(s) {
		return { tag: 'sub:' + s['.name'], label: s.label || s['.name'] };
	});
}

function serverLabel(tag) {
	var sb = subs().filter(function(s) { return s.tag == tag; })[0];
	if (sb) return _('Subscription: %s').format(sb.label);
	var n = servers().filter(function(s) { return s.tag == tag; })[0];
	return n ? n.label : tag.replace(/^node-/, '');
}

// LAN-side interfaces a Wi-Fi network can join, with whether each goes through Xray.
function routes() {
	var prox = proxiedDevices();
	var srv = netServers();
	return uci.sections('network', 'interface').filter(function(s) {
		return s.proto == 'static' && s['.name'] != 'loopback' && s.device && /^br-/.test(s.device);
	}).map(function(s) {
		return {
			name: s['.name'],
			device: s.device,
			addr: s.ipaddr || '',
			// lan_ifaces may hold device names (br-lan) or network names (lan).
			proxied: prox.indexOf(s.device) > -1 || prox.indexOf(s['.name']) > -1,
			server: srv[s['.name']] || ''
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
				hidden: false,
				// The first radio's filter wins; the lists of all radios are merged.
				macfilter: (s.macfilter == 'allow' || s.macfilter == 'deny') ? s.macfilter : '',
				maclist: [],
				sids: [], radios: []
			};
			list.push(map[key]);
		}
		var g = map[key];
		g.sids.push(s['.name']);
		g.radios.push(s.device);
		if (s.disabled != '1') g.disabled = false;
		if (s.hidden == '1') g.hidden = true;
		L.toArray(s.maclist).forEach(function(m) {
			m = normMac(m) || m;
			if (g.maclist.indexOf(m) < 0) g.maclist.push(m);
		});
	});
	return list;
}

// usedAddrs: addresses in use right now (including a DHCP WAN), from network.getNetworks().
function freeSubnet(usedAddrs) {
	var used = {};
	var mark = function(a) {
		var m = String(a || '').match(/^192\.168\.(\d+)\./);
		if (m) used[m[1]] = true;
	};
	uci.sections('network', 'interface').forEach(function(s) { L.toArray(s.ipaddr).forEach(mark); });
	(usedAddrs || []).forEach(mark);
	for (var i = 2; i < 250; i++)
		if (!used[i]) return i;
	return null;
}

return view.extend({
	load: function() {
		var self = this;
		return Promise.all([
			uci.load([ 'wireless', 'network', 'firewall', 'dhcp', 'xraypanel' ]),
			L.resolveDefault(network.getHostHints(), null).then(function(h) { self.hints = h; }),
			L.resolveDefault(network.getNetworks(), []).then(function(nets) {
				self.usedAddrs = [];
				nets.forEach(function(n) {
					L.toArray(n.getIPAddrs()).forEach(function(a) { self.usedAddrs.push(String(a).split('/')[0]); });
				});
			})
		]);
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

	// Creates a separate network with its own bridge, subnet, DHCP and a firewall zone to WAN.
	// A proxied one is added to the interfaces Xray routes; a direct one never goes through Xray.
	createNet: function(proxied) {
		var n = freeSubnet(this.usedAddrs);
		if (n == null) return null;
		var base = proxied ? 'xnet' : 'direct';
		var name = uci.get('network', base) ? base + n : base;
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
		// Without dhcpv4=server, dnsmasq on current OpenWrt adds no DHCP range and clients get no address.
		uci.set('dhcp', name, 'dhcpv4', 'server');

		var z = uci.add('firewall', 'zone');
		uci.set('firewall', z, 'name', name);
		uci.set('firewall', z, 'network', [ name ]);
		uci.set('firewall', z, 'input', 'ACCEPT');
		uci.set('firewall', z, 'output', 'ACCEPT');
		uci.set('firewall', z, 'forward', 'REJECT');

		var f = uci.add('firewall', 'forwarding');
		uci.set('firewall', f, 'src', name);
		uci.set('firewall', f, 'dest', 'wan');

		if (proxied) {
			// An empty list means br-lan, so br-lan stays in it when the first extra network is added.
			var devs = proxiedDevices();
			if (devs.indexOf(dev) < 0) devs.push(dev);
			uci.set('xraypanel', 'main', 'lan_ifaces', devs);
		}
		// The subnet is taken now, so another new network before Save & Apply gets a different one.
		this.usedAddrs.push('192.168.' + n + '.1');

		return name;
	},

	openEditor: function(g) {
		var self = this;
		var isNew = !g;
		var rts = routes();
		var radios = uci.sections('wireless', 'wifi-device').map(function(r) { return r['.name']; });
		g = g || {
			ssid: '', network: (rts.filter(function(r) { return r.proxied; })[0] || rts[0] || {}).name || 'lan',
			encryption: 'sae-mixed', key: '', disabled: false,
			hidden: false, macfilter: '', maclist: [], sids: [], radios: radios.slice()
		};

		var ssid = new ui.Textfield(g.ssid, { placeholder: _('Network name'), validate: function(v) {
			v = v || '';
			if (!v.length) return _('Enter a name');
			if (new Blob([ v ]).size > 32) return _('Too long (32 bytes max)');
			return true;
		} });
		var sec = new ui.Select(g.encryption, securityChoices(g.encryption), { sort: false });
		var key = new ui.Textfield(g.key, { password: true, placeholder: _('At least 8 characters'), validate: function(v) {
			if (sec.getValue() == 'none' || sec.getValue() == 'owe') return true;
			v = v || '';
			// A passphrase is 8-63 bytes; a raw key is exactly 64 hex digits.
			if (/^[0-9a-fA-F]{64}$/.test(v)) return true;
			var n = new Blob([ v ]).size;
			if (n < 8 || n > 63) return _('8 to 63 characters, or a 64-digit hex key');
			return true;
		} });
		var bands = radios.map(function(r) {
			return E('label', { 'style': 'margin-right:14px' }, [
				E('input', { 'type': 'checkbox', 'class': 'xn-band', 'value': r, 'checked': g.radios.indexOf(r) > -1 ? '' : null }),
				' ', bandName(r)
			]);
		});

		var routeOpts = rts.map(function(r) {
			return E('label', { 'class': 'xn-route' }, [
				E('input', { 'type': 'radio', 'name': 'xn-route', 'value': r.name, 'checked': r.name == g.network ? '' : null }),
				' ', E('strong', {}, text(r.name)), ' ',
				r.proxied ? pill('#2e7d32', _('Through Xray')) : pill('#1976d2', _('Direct')),
				' ', E('span', { 'class': 'xn-muted' }, text(r.addr))
			]);
		});
		var hidden = E('input', { 'type': 'checkbox', 'checked': g.hidden ? '' : null });

		var mf = new ui.Select(g.macfilter, MACFILTER, { sort: false });
		var macs = new ui.Textarea(g.maclist.join('\n'), { rows: 4, placeholder: 'aa:bb:cc:dd:ee:ff', validate: function(v) {
			var bad = macLines(v).filter(function(s) { return !normMac(s); });
			if (bad.length) return _('Not a MAC address: %s').format(bad[0]);
			// An empty allow list would keep every device out.
			if (mf.getValue() == 'allow' && !macLines(v).length) return _('Add at least one device');
			return true;
		} });

		// Known devices (DHCP leases and neighbours) to add without typing the address.
		var known = this.hints ? this.hints.getMACHints(false) : [];
		var picker = E('select', { 'class': 'cbi-input-select', 'change': function(ev) {
			var m = ev.target.value;
			ev.target.value = '';
			if (!m) return;
			var cur = macLines(macs.getValue());
			if (cur.map(normMac).indexOf(m) < 0) cur.push(m);
			macs.setValue(cur.join('\n'));
			macs.triggerValidation();
		} }, [ E('option', { 'value': '' }, _('Add a known device…')) ].concat(known.map(function(h) {
			var m = normMac(h[0]);
			return m ? E('option', { 'value': m }, text(h[1] && h[1] != h[0] ? h[1] + ' (' + m + ')' : m)) : null;
		}).filter(function(o) { return o; })));

		var macBox = E('div', {}, [ macs.render(), E('div', { 'style': 'margin-top:6px' }, picker),
			E('div', { 'class': 'xn-muted', 'style': 'font-size:.85em;margin-top:4px;max-width:420px' },
				_('Phones use a different private address for each Wi-Fi network; use the address the device shows for this network, or turn its private address off.')) ]);
		var mfNode = mf.render();
		var showMacs = function() {
			macBox.style.display = mf.getValue() ? '' : 'none';
			if (mf.getValue()) macs.triggerValidation();
		};
		mfNode.addEventListener('widget-change', showMacs);
		macBox.style.display = g.macfilter ? '' : 'none';

		var hasDirect = rts.some(function(r) { return !r.proxied; });
		routeOpts.push(E('label', { 'class': 'xn-route' }, [
			E('input', { 'type': 'radio', 'name': 'xn-route', 'value': '__new_proxied' }),
			' ', _('New network through Xray'), ' ', pill('#2e7d32', _('Through Xray')),
			' ', E('span', { 'class': 'xn-muted' }, _('creates its own subnet, so it can use its own server'))
		]));
		if (!hasDirect)
			routeOpts.push(E('label', { 'class': 'xn-route' }, [
				E('input', { 'type': 'radio', 'name': 'xn-route', 'value': '__new_direct' }),
				' ', _('New direct network'), ' ', pill('#1976d2', _('Direct')),
				' ', E('span', { 'class': 'xn-muted' }, _('creates its own subnet'))
			]));

		// Which server a proxied network uses. It belongs to the network, not to this SSID.
		var srvChoices = { '': _('Main server (same as the other networks)') };
		// A whole subscription: its fastest server that answers is used.
		subs().forEach(function(b) { srvChoices[b.tag] = _('All servers of subscription: %s').format(b.label); });
		servers().forEach(function(n) { srvChoices[n.tag] = _('Server: %s').format(n.label); });
		var cur = (rts.filter(function(r) { return r.name == g.network; })[0] || {}).server || '';
		if (cur && !srvChoices[cur]) srvChoices[cur] = _('%s (off or missing)').format(cur.replace(/^(node-|sub:)/, ''));
		var srv = new ui.Select(cur, srvChoices, { sort: false });
		var srvNote = E('div', { 'class': 'xn-muted', 'style': 'font-size:.85em;margin-top:4px;max-width:440px' });
		var srvBox = E('div', { 'style': 'margin-top:8px' }, [ srv.render(), srvNote ]);
		var showSrv = function() {
			var r = body.querySelector('input[name=xn-route]:checked');
			var v = r ? r.value : g.network;
			var rt = rts.filter(function(x) { return x.name == v; })[0];
			var shared = rt ? groups().filter(function(o) { return o.network == v && o.ssid != g.ssid; }) : [];
			srvBox.style.display = (v == '__new_proxied' || (rt && rt.proxied)) ? '' : 'none';
			srvNote.textContent = v == '__new_proxied'
				? _('Only this Wi-Fi will be on the new network.')
				: shared.length
					? _('This setting belongs to network "%s", so it also applies to: %s. Pick "New network through Xray" to give only this Wi-Fi its own server.').format(v, shared.map(function(o) { return o.ssid; }).join(', '))
					: _('Applies to every device on network "%s". Direct and blocked rules still apply; traffic that would go through the proxy uses this server.').format(v);
		};
		routeOpts.forEach(function(l) { l.querySelector('input').addEventListener('change', showSrv); });
		routeOpts.push(srvBox);

		var body = E('div', { 'class': 'xn-form' }, [
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Name (SSID)')), ssid.render() ]),
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Security')), sec.render() ]),
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Password')), key.render() ]),
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Bands')), E('div', {}, bands) ]),
			E('div', { 'class': 'cbi-value' }, [ E('div', { 'class': 'cbi-value-title' }, _('Hide name')),
				E('label', {}, [ hidden, ' ', _('Do not broadcast the SSID; devices must type the name to join') ]) ]),
			E('div', { 'class': 'cbi-value', 'style': 'align-items:flex-start' }, [
				E('div', { 'class': 'cbi-value-title' }, _('MAC filter')),
				E('div', {}, [ mfNode, macBox ])
			]),
			E('div', { 'class': 'cbi-value', 'style': 'align-items:flex-start' }, [
				E('div', { 'class': 'cbi-value-title' }, _('Internet route')),
				E('div', {}, routeOpts)
			]),
			E('p', { 'class': 'xn-muted' }, _('Devices on a "Through Xray" network use the proxy rules. Traffic from a "Direct" network goes straight to the internet; only its DNS lookups are answered by the router through Xray, so they are not poisoned.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
					ssid.triggerValidation(); key.triggerValidation(); macs.triggerValidation();
					if (!ssid.isValid() || !key.isValid() || (mf.getValue() && !macs.isValid())) return;
					var chosen = body.querySelectorAll('input.xn-band:checked');
					var picked = Array.prototype.map.call(chosen, function(i) { return i.value; });
					if (!picked.length) { ui.addNotification(null, E('p', _('Pick at least one band')), 'warning'); return; }
					var r = body.querySelector('input[name=xn-route]:checked');
					var net = r ? r.value : g.network;
					var prox = net == '__new_proxied';
					if (net == '__new_direct' || prox) {
						net = self.createNet(prox);
						if (!net) {
							ui.addNotification(null, E('p', _('No free 192.168.x.0/24 subnet left for a new network.')), 'error');
							return;
						}
					}
					if (prox || routes().some(function(x) { return x.name == net && x.proxied; }))
						setNetServer(net, srv.getValue());
					self.save(g, {
						ssid: ssid.getValue(), encryption: sec.getValue(),
						key: sec.getValue() == 'none' ? '' : key.getValue(),
						network: net, radios: picked,
						hidden: hidden.checked,
						macfilter: mf.getValue(),
						maclist: macLines(macs.getValue()).map(normMac)
							.filter(function(m, i, a) { return a.indexOf(m) == i; })
					});
				} }, isNew ? _('Add') : _('Save'))
			])
		]);

		ui.showModal(isNew ? _('New Wi-Fi network') : _('Edit Wi-Fi network'), body);
		showSrv();
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
			uci.set('wireless', sid, 'hidden', v.hidden ? '1' : null);
			uci.set('wireless', sid, 'macfilter', v.macfilter || null);
			uci.set('wireless', sid, 'maclist', v.macfilter && v.maclist.length ? v.maclist : null);
			if (g.disabled) uci.set('wireless', sid, 'disabled', '1');
			// A fresh OpenWrt ships with the radios themselves turned off.
			else enableRadio(r);
		});

		ui.hideModal();
		return this.commit();
	},

	toggle: function(g) {
		g.sids.forEach(function(sid) {
			uci.set('wireless', sid, 'disabled', g.disabled ? null : '1');
		});
		if (g.disabled) g.radios.forEach(enableRadio);
		return this.commit();
	},

	remove: function(g) {
		var self = this;
		ui.showModal(_('Delete Wi-Fi network'), [
			E('p', text(_('Delete "%s"? Devices connected to it will be disconnected.').format(g.ssid))),
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
			return uci.load([ 'wireless', 'network', 'firewall', 'dhcp', 'xraypanel' ]);
		}).then(function() {
			dom.content(self.listBox, self.renderList());
			ui.changes.init();
			ui.addNotification(null, E('p', _('Saved. Press "Save & Apply" below to put it live. Wi-Fi restarts for a few seconds.')), 'info');
		}).catch(function(e) {
			ui.addNotification(null, E('p', text(e.message)), 'error');
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
				: r.proxied ? pill('#2e7d32', r.server ? (/^sub:/.test(r.server) ? serverLabel(r.server) : _('Server: %s').format(serverLabel(r.server))) : _('Through Xray'))
				: pill('#1976d2', _('Direct'));
			var n = 0;
			g.sids.forEach(function(sid) { n += clients[sid] || 0; });

			return E('tr', { 'style': g.disabled ? 'opacity:.55' : '' }, [
				E('td', {}, [ E('div', { 'class': 'xn-ssid' }, text(g.ssid)),
					E('div', { 'class': 'xn-muted', 'style': 'font-size:.85em' },
						text(securityChoices(g.encryption)[g.encryption])),
					(g.hidden || g.macfilter) ? E('div', { 'style': 'margin-top:3px' }, [
						g.hidden ? pill('#6d4c41', _('Hidden')) : '', ' ',
						g.macfilter == 'allow' ? pill('#7b1fa2', _('Allow list: %d').format(g.maclist.length))
							: g.macfilter == 'deny' ? pill('#c62828', _('Block list: %d').format(g.maclist.length)) : ''
					]) : '' ]),
				E('td', {}, text(g.radios.map(bandName).join(' + '))),
				E('td', {}, [ route, ' ', E('span', { 'class': 'xn-muted' }, text(g.network)) ]),
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
