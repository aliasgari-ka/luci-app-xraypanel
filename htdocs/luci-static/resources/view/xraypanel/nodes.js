'use strict';
'require view';
'require form';
'require uci';
'require fs';
'require ui';

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
		if (!j) return 'vmess ' + _('(unreadable)');
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
function checkLink(value) {
	value = (value || '').trim();
	if (!value) return _('Paste a share link');
	if (value.charAt(0) == '{') {
		var ob;
		try { ob = JSON.parse(value); }
		catch (e) { return _('Not valid JSON'); }
		return (ob && typeof ob == 'object' && ob.protocol) ? true : _('A JSON outbound needs a "protocol" field');
	}
	var m = value.match(/^(vmess|vless|trojan|ss):\/\/(\S+)$/i);
	if (!m)
		return _('Supported: vmess://, vless://, trojan://, ss:// or a JSON outbound');
	var proto = m[1].toLowerCase(), body = m[2].replace(/#.*$/, '');
	if (proto == 'vmess') {
		var j = vmessJson(value);
		if (!j) return _('This vmess link cannot be decoded');
		if (!j.add || !j.port || !j.id) return _('This vmess link has no address, port or id');
		return true;
	}
	var qi = body.indexOf('?');
	var q = new URLSearchParams(qi >= 0 ? body.substring(qi + 1) : '');
	var hp = (qi >= 0 ? body.substring(0, qi) : body).replace(/\/+$/, '');
	var at = hp.lastIndexOf('@');
	if (proto == 'ss') {
		if (q.get('plugin')) return _('Shadowsocks plugins are not supported');
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
	if (q.get('security') == 'reality' && !q.get('pbk'))
		return _('This REALITY link has no public key (pbk)');
	return true;
}

// The import box takes one link per line, or a single JSON outbound (which may span lines).
function importLines(value) {
	value = (value || '').trim();
	if (value.charAt(0) == '{') return [ value ];
	return value.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l; });
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('xraypanel'),
			L.resolveDefault(fs.exec_direct('/usr/share/xraypanel/status.sh', [], 'json'), {})
		]);
	},

	testAll: function() {
		return fs.exec_direct('/usr/share/xraypanel/ctl.sh', [ 'test' ]).then(function(out) {
			out = (out || '').trim();
			ui.addNotification(null, E('p', [ out.replace(/^(OK|ERROR):\s*/, '') ]), /^ERROR/.test(out) ? 'error' : 'info');
			window.setTimeout(function() { location.reload(); }, 800);
		}).catch(function(e) {
			ui.addNotification(null, E('p', [ e.message ]), 'error');
		});
	},

	render: function(data) {
		var m, s, o;
		var st = data[1] || {};
		var tests = {}, inUse = {};
		(st.servers || []).forEach(function(n) { tests[n.name] = n.test; });
		(st.in_use || []).forEach(function(n) { inUse[n] = true; });

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
		uci.sections('xraypanel', 'node').forEach(function(n) {
			o.value(n['.name'], n.label || summary(n.link));
		});

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
		o.depends({ mode: 'balance', strategy: 'leastPing' });

		o = s.option(form.TextValue, '_import', _('Add servers from links'),
			_('Paste one or more share links, one per line (or one JSON outbound), then press Save & Apply. Links that are already in the list are skipped.'));
		o.rows = 4;
		o.wrap = 'off';
		o.cfgvalue = function() { return ''; };
		o.validate = function(section_id, value) {
			var lines = importLines(value);
			for (var i = 0; i < lines.length; i++) {
				var r = checkLink(lines[i]);
				if (r !== true) return _('Line %d: %s').format(i + 1, r);
			}
			return true;
		};
		o.write = function(section_id, value) {
			var seen = {};
			uci.sections('xraypanel', 'node').forEach(function(n) { seen[(n.link || '').trim()] = true; });
			importLines(value).forEach(function(l) {
				// Pasting the same link twice should not create a second server.
				if (seen[l]) return;
				seen[l] = true;
				var sid = uci.add('xraypanel', 'node');
				uci.set('xraypanel', sid, 'label', linkName(l) || summary(l));
				uci.set('xraypanel', sid, 'link', l);
				uci.set('xraypanel', sid, 'enabled', '1');
			});
		};
		o.remove = function() {};

		s = m.section(form.GridSection, 'node', _('Servers'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.modaltitle = function(section_id) {
			// Labels come from share links, so they are escaped before LuCI renders them as HTML.
			return _('Server') + ': ' + '%h'.format(uci.get('xraypanel', section_id, 'label') || _('new'));
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

		o = s.option(form.DummyValue, '_latency', _('Latency'));
		o.modalonly = false;
		o.rawhtml = true;
		o.textvalue = function(section_id) {
			var t = tests[section_id];
			var use = inUse[section_id] ? ' <span style="color:#2e7d32;font-weight:600">● ' + _('in use') + '</span>' : '';
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

		var self = this;
		return m.render().then(function(node) {
			var grid = node.querySelector('.cbi-section[id$="-node"]') || node.lastElementChild;
			grid.insertBefore(E('div', { 'style': 'margin:0 0 8px' }, [
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(self, 'testAll')
				}, _('Test all servers')),
				' ',
				E('span', { 'style': 'opacity:.7' }, _('Tests the saved servers. Save & Apply new ones first.'))
			]), grid.firstChild);
			return node;
		});
	}
});
