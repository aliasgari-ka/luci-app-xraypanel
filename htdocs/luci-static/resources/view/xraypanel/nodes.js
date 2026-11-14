'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';
'require dom';

function b64(s) {
	s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
	while (s.length % 4) s += '=';
	try {
		return decodeURIComponent(Array.prototype.map.call(atob(s), function(c) {
			return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
		}).join(''));
	}
	catch (e) {
		return null;
	}
}

function vmessJson(link) {
	var raw = b64(link.substring(8).replace(/#.*$/, ''));
	if (raw == null) return null;
	try { return JSON.parse(raw); } catch (e) { return null; }
}

function summary(link) {
	link = (link || '').trim();
	if (!link) return '-';
	if (link.charAt(0) == '{') {
		try { return (JSON.parse(link).protocol || '?') + ' (JSON)'; }
		catch (e) { return _('invalid JSON'); }
	}
	var m = link.match(/^([a-z0-9]+):\/\/(.*)$/i);
	if (!m) return _('invalid link');
	var proto = m[1].toLowerCase();
	if (proto == 'vmess') {
		var j = vmessJson(link);
		if (!j) return _('%s (unreadable)').format('vmess');
		return 'vmess ' + j.add + ':' + j.port + ' ' + (j.net || 'tcp') + (j.tls && j.tls != 'none' ? '+' + j.tls : '');
	}
	var rest = m[2].replace(/#.*$/, '');
	var qi = rest.indexOf('?');
	var q = new URLSearchParams(qi >= 0 ? rest.substring(qi + 1) : '');
	var hp = (qi >= 0 ? rest.substring(0, qi) : rest).replace(/\/+$/, '').replace(/^.*@/, '');
	if (proto == 'ss' && hp.indexOf(':') < 0) {
		var dec = b64(hp) || '';
		hp = dec.replace(/^.*@/, '') || '?';
	}
	// gen.uc defaults trojan to TLS.
	var sec = q.get('security') || (proto == 'trojan' ? 'tls' : null);
	return proto + ' ' + hp + ' ' + (q.get('type') || 'tcp') + (sec && sec != 'none' ? '+' + sec : '');
}

function linkName(link) {
	link = link.trim();
	if (/^vmess:\/\//i.test(link)) {
		var j = vmessJson(link);
		return j && j.ps ? j.ps : null;
	}
	if (link.charAt(0) == '{') {
		try { return JSON.parse(link).tag || null; } catch (e) { return null; }
	}
	var h = link.indexOf('#');
	if (h < 0) return null;
	try { return decodeURIComponent(link.substring(h + 1)); } catch (e) { return link.substring(h + 1); }
}

// Same host:port rules as gen.uc: "[v6]:port" or "host:port", port 1-65535.
function validHostPort(s) {
	var m = s.match(/^\[(.+)\]:([0-9]+)$/) || s.match(/^([^:\/\[\]]+):([0-9]+)$/);
	return !!m && +m[2] > 0 && +m[2] < 65536;
}

// Catches the mistakes gen.uc would reject, so they show up before Save & Apply.
// Same transports and security modes gen.uc stream() accepts.
function checkStream(net, security, pbk) {
	net = String(net || 'tcp').toLowerCase();
	security = String(security || 'none').toLowerCase();
	if (net == 'h2' || net == 'http')
		return _('The HTTP/2 (h2) transport was removed in Xray 26; ask for an xhttp link instead');
	if ([ 'tcp', 'raw', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'splithttp', 'kcp' ].indexOf(net) < 0)
		return _('Unsupported transport "%s"').format(net);
	if ([ 'none', 'tls', 'xtls', 'reality' ].indexOf(security) < 0)
		return _('Unsupported security "%s"').format(security);
	if (security == 'reality' && !pbk)
		return _('This REALITY link has no public key (pbk)');
	return true;
}

function checkLink(value) {
	value = (value || '').trim();
	if (!value) return _('Paste a share link');
	if (value.charAt(0) == '{') {
		var ob;
		try { ob = JSON.parse(value); }
		catch (e) { return _('Not valid JSON'); }
		return (ob && typeof ob == 'object' && ob.protocol) ? true : _('A JSON outbound needs a "protocol" field');
	}
	// Links copied from chat apps often have raw spaces in the #name; only the part before # must be space-free.
	var m = value.match(/^(vmess|vless|trojan|ss):\/\/([^\s#]+)(#.*)?$/i);
	if (!m)
		return _('Supported: vmess://, vless://, trojan://, ss:// or a JSON outbound');
	var proto = m[1].toLowerCase(), body = m[2].replace(/#.*$/, '');
	if (proto == 'vmess') {
		var j = vmessJson(value);
		if (!j) return _('This vmess link cannot be decoded');
		if (!j.add || !j.port || !j.id) return _('This vmess link has no address, port or id');
		if (!/^\d+$/.test(String(j.port)) || +j.port < 1 || +j.port > 65535) return _('This vmess link has an invalid port');
		return checkStream(j.net, j.tls == 'tls' || j.tls == 'reality' ? j.tls : 'none', j.pbk);
	}
	var qi = body.indexOf('?');
	var q = new URLSearchParams(qi >= 0 ? body.substring(qi + 1) : '');
	// A path after host:port (host:443/?type=ws) carries nothing; gen.uc drops it too.
	var hp = (qi >= 0 ? body.substring(0, qi) : body).replace(/(@[^\/]*)\/.*$/, '$1').replace(/\/+$/, '');
	var at = hp.lastIndexOf('@');
	if (proto == 'ss') {
		if (q.get('plugin')) return _('Shadowsocks plugins are not supported');
		if (at >= 0) {
			var user = hp.substring(0, at), cred;
			try { cred = b64(decodeURIComponent(user)); } catch (e) { cred = null; }
			if (!cred || cred.indexOf(':') <= 0) {
				try { cred = decodeURIComponent(user); } catch (e) { cred = user; }
			}
			if (cred.indexOf(':') <= 0) return _('This shadowsocks link has no method:password');
		}
		if (at < 0) {
			var dec = b64(hp);
			at = dec ? dec.lastIndexOf('@') : -1;
			if (at < 0) return _('This shadowsocks link cannot be decoded');
			hp = dec;
		}
	}
	else if (at <= 0) {
		return proto == 'trojan' ? _('This trojan link has no password') : _('This vless link has no UUID');
	}
	if (!validHostPort(hp.substring(at + 1)))
		return _('This link has no valid server address and port');
	return checkStream(q.get('type'), q.get('security') || (proto == 'trojan' ? 'tls' : 'none'), q.get('pbk'));
}

// Anonymous UCI sections are renamed when a section above them is deleted, which would break
// main.node, rule outbounds (node-<name>) and test results, so servers get fixed names.
// Fixed width, so no name is the start of another one: Xray selectors match tag prefixes.
var nameSeq = 0;
function nodeName() {
	var name;
	do name = 'n' + Date.now().toString(36) + ('00' + (nameSeq++ % 1296).toString(36)).slice(-2);
	while (uci.get('xraypanel', name));
	return name;
}

// gen.uc skips servers that are turned off or have no link. The grid's "On" box may not be saved yet.
function nodeUsable(map, sid) {
	var o = map.lookupOption('enabled', sid);
	var on = o ? o[0].formvalue(sid) : uci.get('xraypanel', sid, 'enabled');
	return on != '0' && !!uci.get('xraypanel', sid, 'link');
}

// The server lists are filled when the widget is drawn, so servers added or deleted in the grid
// below show up without reloading the page. A saved value that names a deleted server is removed.
// withSubs also lists each subscription as one choice ("sub:<section>"): all of its servers.
function serverChoices(o, none, withSubs) {
	o.renderWidget = function(section_id, option_index, cfgvalue) {
		this.keylist = [];
		this.vallist = [];
		if (none) this.value('', none);
		if (withSubs) uci.sections('xraypanel', 'subscription').forEach(function(s) {
			this.value('sub:' + s['.name'], _('All servers of subscription: %s').format(s.label || s['.name']));
		}, this);
		uci.sections('xraypanel', 'node').forEach(function(n) {
			var label = n.label || summary(n.link);
			this.value(n['.name'], (n.enabled == '0' || !n.link) ? _('%s (off)').format(label) : label);
		}, this);
		return form.ListValue.prototype.renderWidget.apply(this, arguments);
	};
	o.write = function(section_id, value) {
		var ref = (value && value.indexOf('sub:') == 0) ? value.substring(4) : value;
		if (ref && !uci.get('xraypanel', ref))
			return this.remove(section_id);
		return form.ListValue.prototype.write.apply(this, arguments);
	};
}

// Usable servers of a subscription other than the main one (the grid's "On" box may not be saved yet).
function subServers(map, sub, main) {
	return uci.sections('xraypanel', 'node').filter(function(n) {
		return n.sub == sub && n['.name'] != main && nodeUsable(map, n['.name']);
	});
}

// The import box takes one link per line, or a single JSON outbound (which may span lines).
// Returns [ line number as typed, text ] pairs, so errors point at the right line.
function importLines(value) {
	value = (value || '').trim();
	if (value.charAt(0) == '{') return [ [ 1, value ] ];
	return value.split(/\r?\n/).map(function(l, i) { return [ i + 1, l.trim() ]; }).filter(function(l) { return l[1]; });
}

function ago(ts) {
	ts = +ts;
	if (!ts) return _('never');
	var d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
	if (d < 90) return _('just now');
	if (d < 5400) return _('%d minutes ago').format(Math.round(d / 60));
	if (d < 172800) return _('%d hours ago').format(Math.round(d / 3600));
	return _('%d days ago').format(Math.round(d / 86400));
}

// ctl.sh prints one OK:/ERROR: line per subscription.
function notifyLines(out) {
	var lines = (out || '').trim().split(/\n/).filter(function(l) { return l; });
	if (!lines.length) lines = [ 'ERROR: ' + _('No answer') ];
	lines.forEach(function(l) {
		ui.addNotification(null, E('p', [ l.replace(/^(OK|ERROR):\s*/, '') ]), /^ERROR/.test(l) ? 'error' : 'info');
	});
}

return view.extend({
	// Fetches the subscriptions, then redraws the page so new servers show. Unsaved edits are lost,
	// which is why the button says to save first.
	updateSubs: function() {
		var self = this;
		return fs.exec_direct('/usr/share/xraypanel/ctl.sh', [ 'sub' ]).then(function(out) {
			notifyLines(out);
			uci.unload('xraypanel');
			return self.load();
		}).then(function(data) {
			return self.render(data);
		}).then(function(node) {
			var view = document.querySelector('#view');
			if (view) dom.content(view, node);
		}).catch(function(e) {
			ui.addNotification(null, E('p', [ e.message ]), 'error');
		});
	},

	speedTest: function() {
		return fs.exec_direct('/usr/share/xraypanel/ctl.sh', [ 'speed' ]).then(notifyLines).catch(function(e) {
			ui.addNotification(null, E('p', [ e.message ]), 'error');
		});
	},

	load: function() {
		return Promise.all([
			uci.load('xraypanel'),
			L.resolveDefault(fs.exec_direct('/usr/share/xraypanel/status.sh', [], 'json'), {})
		]);
	},

	// Updates the latency column in place: reloading the page would drop unsaved edits.
	testAll: function() {
		var self = this;
		return fs.exec_direct('/usr/share/xraypanel/ctl.sh', [ 'test' ]).then(function(out) {
			out = (out || '').trim();
			ui.addNotification(null, E('p', [ out.replace(/^(OK|ERROR):\s*/, '') ]), /^ERROR/.test(out) ? 'error' : 'info');
			return L.resolveDefault(fs.exec_direct('/usr/share/xraypanel/status.sh', [], 'json'), {});
		}).then(function(st) {
			self.readStatus(st);
			uci.sections('xraypanel', 'node').forEach(function(n) {
				var el = document.querySelector('tr[data-sid="%s"] td[data-name="_latency"]'.format(n['.name']));
				if (el) el.innerHTML = self.latency.textvalue(n['.name']);
			});
		}).catch(function(e) {
			ui.addNotification(null, E('p', [ e.message ]), 'error');
		});
	},

	readStatus: function(st) {
		var tests = this.tests = {}, inUse = this.inUse = {};
		((st || {}).servers || []).forEach(function(n) { tests[n.name] = n.test; });
		((st || {}).in_use || []).forEach(function(n) { inUse[n] = true; });
	},

	render: function(data) {
		var m, s, o, self = this;
		this.readStatus(data[1]);

		m = new form.Map('xraypanel', _('Xray servers'),
			_('Add one or more servers. With load balancing, Xray tests every enabled server and uses the fastest one; if it fails, traffic moves to the next.'));

		s = m.section(form.NamedSection, 'main', 'main', _('General'));
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable Xray'));
		o.rmempty = false;

		o = s.option(form.ListValue, 'mode', _('Server selection'));
		o.value('balance', _('Load balance across all enabled servers'));
		o.value('single', _('Always use one server'));
		o.default = 'balance';

		o = s.option(form.ListValue, 'node', _('Server'));
		o.depends('mode', 'single');
		serverChoices(o);
		o.validate = function(section_id, value) {
			return (value && !nodeUsable(this.map, value)) ? _('This server is turned off or has no link') : true;
		};

		o = s.option(form.ListValue, 'backup', _('Backup server'),
			_('Used only while the main server does not answer the latency test; traffic returns to the main server once it answers again. With a whole subscription, the fastest of its servers that answers is used.'));
		o.depends('mode', 'single');
		serverChoices(o, _('None'), true);
		o.validate = function(section_id, value) {
			if (!value) return true;
			if (value.indexOf('sub:') == 0)
				return subServers(this.map, value.substring(4), this.section.formvalue(section_id, 'node')).length
					? true : _('This subscription has no usable server other than the main one; update it first');
			if (value == this.section.formvalue(section_id, 'node'))
				return _('Pick a different server than the main one');
			return nodeUsable(this.map, value) ? true : _('This server is turned off or has no link');
		};

		o = s.option(form.ListValue, 'strategy', _('Balancing method'));
		o.value('leastPing', _('Lowest latency'));
		o.value('roundRobin', _('Round robin'));
		o.value('random', _('Random'));
		o.default = 'leastPing';
		o.depends('mode', 'balance');

		o = s.option(form.Value, 'probe_interval', _('Latency test every (seconds)'));
		o.datatype = 'range(10,3600)';
		o.default = '60';
		o.placeholder = '60';
		// Only used by the balancer: load balancing, or one server with a backup.
		o.depends({ mode: 'single', backup: '', '!reverse': true });

		o = s.option(form.TextValue, '_import', _('Add servers from links'),
			_('Paste one or more share links, one per line (or one JSON outbound), then press Save & Apply. Links that are already in the list are skipped.'));
		o.rows = 4;
		o.wrap = 'off';
		o.cfgvalue = function() { return ''; };
		o.validate = function(section_id, value) {
			var lines = importLines(value);
			for (var i = 0; i < lines.length; i++) {
				var r = checkLink(lines[i][1]);
				if (r !== true) return _('Line %d: %s').format(lines[i][0], r);
			}
			return true;
		};
		o.write = function(section_id, value) {
			var seen = {};
			uci.sections('xraypanel', 'node').forEach(function(n) { seen[(n.link || '').trim()] = true; });
			importLines(value).forEach(function(e) {
				var l = e[1];
				// Pasting the same link twice should not create a second server.
				if (seen[l]) return;
				seen[l] = true;
				var sid = uci.add('xraypanel', 'node', nodeName());
				uci.set('xraypanel', sid, 'label', linkName(l) || summary(l));
				uci.set('xraypanel', sid, 'link', l);
				uci.set('xraypanel', sid, 'enabled', '1');
			});
		};
		o.remove = function() {};

		s = m.section(form.GridSection, 'subscription', _('Subscriptions'),
			_('Subscription links from your provider. Add one, press Save & Apply, then "Update subscriptions". Updating only changes the server list; Xray keeps running and uses the new servers after the next Save & Apply.'));
		s.addremove = true;
		s.anonymous = true;
		s.nodescriptions = true;
		// Deleting a subscription deletes the servers it brought in.
		s.handleRemove = function(section_id, ev) {
			uci.sections('xraypanel', 'node').forEach(function(n) {
				if (n.sub == section_id) uci.remove('xraypanel', n['.name']);
			});
			if (uci.get('xraypanel', 'main', 'backup') == 'sub:' + section_id)
				uci.unset('xraypanel', 'main', 'backup');
			return form.GridSection.prototype.handleRemove.apply(this, arguments);
		};
		s.modaltitle = function(section_id) {
			return _('Subscription: %s').format('%h'.format(uci.get('xraypanel', section_id, 'label') || _('new')));
		};

		o = s.option(form.Flag, 'enabled', _('On'));
		o.default = '1';
		o.editable = true;
		o.rmempty = false;

		o = s.option(form.Value, 'label', _('Name'));
		o.rmempty = false;

		o = s.option(form.Value, 'url', _('Subscription URL'));
		o.modalonly = true;
		o.rmempty = false;
		o.validate = function(section_id, value) {
			return /^https?:\/\/[^\s\/]+(\/\S*)?$/.test(value || '') || _('Enter a full http:// or https:// address');
		};

		o = s.option(form.DummyValue, '_subinfo', _('Last update'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			var n = uci.get('xraypanel', section_id, 'count');
			var t = uci.get('xraypanel', section_id, 'updated');
			return t ? ago(t) + (n ? ' · ' + _('%s servers').format(n) : '') : _('never');
		};

		s = m.section(form.GridSection, 'node', _('Servers'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.handleAdd = function(ev) {
			return form.GridSection.prototype.handleAdd.call(this, ev, nodeName());
		};
		s.modaltitle = function(section_id) {
			// Labels come from share links, so they are escaped before LuCI renders them as HTML.
			return _('Server: %s').format('%h'.format(uci.get('xraypanel', section_id, 'label') || _('new')));
		};

		o = s.option(form.Flag, 'enabled', _('On'));
		o.default = '1';
		o.editable = true;
		o.rmempty = false;

		o = s.option(form.Value, 'label', _('Name'));
		o.rmempty = false;

		o = s.option(form.DummyValue, '_summary', _('Address'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			return '%h'.format(summary(uci.get('xraypanel', section_id, 'link')));
		};

		o = s.option(form.DummyValue, '_source', _('Source'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			var sub = uci.get('xraypanel', section_id, 'sub');
			if (!sub) return _('manual');
			return '%h'.format(uci.get('xraypanel', sub, 'label') || _('subscription'));
		};

		o = this.latency = s.option(form.DummyValue, '_latency', _('Latency'));
		o.modalonly = false;
		o.rawhtml = true;
		o.textvalue = function(section_id) {
			var t = self.tests[section_id];
			var use = self.inUse[section_id] ? ' <span style="color:#2e7d32;font-weight:600">● ' + _('in use') + '</span>' : '';
			if (!t) return '<span style="opacity:.6">' + _('not tested') + '</span>' + use;
			if (!t.ok) return '<span style="color:#c62828;font-weight:600">' + _('no answer') + '</span>' + use;
			var c = t.ms < 400 ? '#2e7d32' : t.ms < 1000 ? '#ef6c00' : '#c62828';
			return '<span style="color:' + c + ';font-weight:600">' + t.ms + ' ms</span>' + use;
		};

		o = s.option(form.TextValue, 'link', _('Share link'),
			_('vmess://, vless://, trojan://, ss:// or a complete Xray outbound as JSON.'));
		o.rows = 5;
		o.modalonly = true;
		o.rmempty = false;
		o.validate = function(section_id, value) { return checkLink(value); };

		return m.render().then(function(node) {
			var grid = node.querySelector('.cbi-section[id$="-node"]') || node.lastElementChild;
			grid.insertBefore(E('div', { 'style': 'margin:0 0 8px' }, [
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(self, 'testAll')
				}, _('Test all servers')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'title': _('Downloads up to 10 MB through the server in use; that counts against its traffic.'),
					'click': ui.createHandlerFn(self, 'speedTest')
				}, _('Speed test')),
				' ',
				E('span', { 'style': 'opacity:.7' }, _('Tests the saved servers. Save & Apply new ones first.'))
			]), grid.firstChild);
			var subs = node.querySelector('.cbi-section[id$="-subscription"]');
			if (subs) subs.appendChild(E('div', { 'style': 'margin:8px 0 0' }, [
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(self, 'updateSubs')
				}, _('Update subscriptions')),
				' ',
				E('span', { 'style': 'opacity:.7' }, _('Save & Apply new or changed subscriptions first.'))
			]));
			return node;
		});
	}
});
