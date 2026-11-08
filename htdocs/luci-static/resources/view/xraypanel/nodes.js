'use strict';
'require view';
'require form';
'require uci';

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
		return 'vmess ' + j.add + ':' + j.port + ' ' + (j.net || 'tcp') + (j.tls ? '+' + j.tls : '');
	}
	var rest = m[2].replace(/#.*$/, '');
	var qi = rest.indexOf('?');
	var q = new URLSearchParams(qi >= 0 ? rest.substring(qi + 1) : '');
	var hp = (qi >= 0 ? rest.substring(0, qi) : rest).replace(/\/+$/, '').replace(/^.*@/, '');
	if (proto == 'ss' && hp.indexOf(':') < 0) {
		var dec = b64(hp) || '';
		hp = dec.replace(/^.*@/, '') || '?';
	}
	var sec = q.get('security');
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

function checkLink(value) {
	value = (value || '').trim();
	if (!value) return _('Paste a share link');
	if (value.charAt(0) == '{') {
		try { JSON.parse(value); return true; }
		catch (e) { return _('Not valid JSON'); }
	}
	if (!/^(vmess|vless|trojan|ss):\/\/\S+$/i.test(value))
		return _('Supported: vmess://, vless://, trojan://, ss:// or a JSON outbound');
	if (/^vmess:/i.test(value) && !vmessJson(value))
		return _('This vmess link cannot be decoded');
	return true;
}

return view.extend({
	load: function() {
		return uci.load('xraypanel');
	},

	render: function() {
		var m, s, o;

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
			_('Paste one or more share links, one per line, then press Save & Apply.'));
		o.rows = 4;
		o.wrap = 'off';
		o.cfgvalue = function() { return ''; };
		o.validate = function(section_id, value) {
			var lines = (value || '').split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l; });
			for (var i = 0; i < lines.length; i++) {
				var r = checkLink(lines[i]);
				if (r !== true) return _('Line %d: %s').format(i + 1, r);
			}
			return true;
		};
		o.write = function(section_id, value) {
			value.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l; }).forEach(function(l) {
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
			return _('Server') + ': ' + (uci.get('xraypanel', section_id, 'label') || _('new'));
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
			return summary(uci.get('xraypanel', section_id, 'link'));
		};

		o = s.option(form.TextValue, 'link', _('Share link'),
			_('vmess://, vless://, trojan://, ss:// or a complete Xray outbound as JSON.'));
		o.rows = 5;
		o.modalonly = true;
		o.rmempty = false;
		o.validate = function(section_id, value) { return checkLink(value); };

		return m.render();
	}
});
