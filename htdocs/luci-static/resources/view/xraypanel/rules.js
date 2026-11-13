'use strict';
'require view';
'require form';
'require uci';

// Laid out like the routing tab of 3x-ui: an ordered table of full Xray routing rules.

// The router's own SOCKS port is not offered: it always uses the proxy (watchdog, geo updates).
var INBOUNDS = {
	'redir-in': _('LAN (redirected traffic)')
};

function vals(section_id, opt) {
	return L.toArray(uci.get('xraypanel', section_id, opt));
}

function cell(parts) {
	var out = [];
	parts.forEach(function(p) {
		if (!p[1].length) return;
		var v = p[1].length > 3 ? p[1].slice(0, 3).join(', ') + ' …' : p[1].join(', ');
		if (out.length) out.push(E('br'));
		// Text nodes, so user data is never parsed as HTML.
		out.push(E('span', { 'style': 'opacity:.6' }, [ p[0] + ': ' ]), document.createTextNode(v));
	});
	return out.length ? E('span', {}, out) : E('span', { 'style': 'opacity:.4' }, '-');
}

var DOMAIN_TYPES = /^(geosite|domain|full|keyword|regexp|ext|dotless):.+/;
var IP_TYPES = /^(geoip|ext-ip):.+/;

function validIPv4(v) {
	var m = v.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(\/(\d+))?$/);
	if (!m) return false;
	// Xray rejects octets with a leading zero (010.0.0.1).
	for (var i = 1; i <= 4; i++) if (+m[i] > 255 || /^0\d/.test(m[i])) return false;
	return m[6] == null || +m[6] <= 32;
}

// Same reading as gen.uc portspec(): "1000 - 2000" is one range, spaces and commas separate.
function splitPorts(v) {
	return String(v).replace(/ *- */g, '-').trim().split(/[ ,]+/).filter(function(p) { return p != ''; });
}

function validPorts(v) {
	if (!v) return true;
	var ok = splitPorts(v).every(function(p) {
		var r = p.match(/^(\d+)(-(\d+))?$/);
		if (!r) return false;
		var a = +r[1], b = r[3] != null ? +r[3] : a;
		return a >= 1 && b <= 65535 && a <= b;
	});
	return ok ? true : _('Use ports 1-65535, ranges and commas, like 80,443,1000-2000');
}

function isIPv6(v) {
	return /^[0-9a-f]*:[0-9a-f:.]+(\/\d+)?$/i.test(v);
}

function checkDomain(section_id, v) {
	if (!v) return true;
	if (/^[a-z-]+:/i.test(v) && !isIPv6(v))
		return DOMAIN_TYPES.test(v) ? true : _('Use geosite:, domain:, full:, keyword:, regexp: or ext: followed by a value');
	if (/^[0-9.\/]+$/.test(v) || isIPv6(v))
		return _('This is an IP address; put it in the IP field');
	return true;
}

function checkIP(section_id, v) {
	if (!v) return true;
	if (IP_TYPES.test(v) || validIPv4(v) || isIPv6(v)) return true;
	return _('Use geoip:xx or an address like 1.2.3.4 or 10.0.0.0/8');
}

// LAN devices: IPv4 address or a /N range only (gen.uc does not read a.b.c.d/255.255.255.0).
function checkSource(section_id, v) {
	if (!v) return true;
	return validIPv4(v) ? true : _('Use an address like 192.168.1.50 or a range like 192.168.1.0/24');
}

// Rules saved before this page existed keep everything in one "match" list.
function legacy(section_id) {
	var d = [], ip = [], port = [];
	vals(section_id, 'match').forEach(function(v) {
		if (/^port:/.test(v)) port.push(v.substring(5));
		else if (/^(geoip|ext-ip):/.test(v) || /^[0-9.]+(\/[0-9]+)?$/.test(v) || /^[0-9a-f]*:[0-9a-f:]+(\/[0-9]+)?$/i.test(v)) ip.push(v);
		else d.push(v);
	});
	return { domain: d, ip: ip, port: port.filter(function(p) { return validPorts(p) === true; }) };
}

// Ready-made domain lists, like the ones 3x-ui offers. The first four are in the lite geosite
// file; the rest come from the extra geosite file (Settings > More geosite categories).
var GEOSITES = [
	[ 'geosite:ir', _('Iran: sites, banks, apps') ],
	[ 'geosite:category-ir', _('Iranian services') ],
	[ 'domain:ir', _('All .ir domains') ],
	[ 'geosite:ads', _('Ads (Iran list)') ],
	[ 'geosite:category-ads-all', _('Ads (global list)') ],
	[ 'geosite:google', 'Google' ],
	[ 'geosite:youtube', 'YouTube' ],
	[ 'geosite:telegram', 'Telegram' ],
	[ 'geosite:instagram', 'Instagram' ],
	[ 'geosite:facebook', 'Facebook' ],
	[ 'geosite:whatsapp', 'WhatsApp' ],
	[ 'geosite:twitter', 'X / Twitter' ],
	[ 'geosite:tiktok', 'TikTok' ],
	[ 'geosite:spotify', 'Spotify' ],
	[ 'geosite:netflix', 'Netflix' ],
	[ 'geosite:speedtest', 'Speedtest (Ookla)' ],
	[ 'geosite:openai', 'OpenAI / ChatGPT' ],
	[ 'geosite:anthropic', 'Anthropic / Claude' ],
	[ 'geosite:github', 'GitHub' ],
	[ 'geosite:microsoft', 'Microsoft' ],
	[ 'geosite:apple', 'Apple' ],
	[ 'geosite:amazon', 'Amazon' ],
	[ 'geosite:cloudflare', 'Cloudflare' ],
	[ 'geosite:discord', 'Discord' ],
	[ 'geosite:reddit', 'Reddit' ],
	[ 'geosite:linkedin', 'LinkedIn' ],
	[ 'geosite:twitch', 'Twitch' ],
	[ 'geosite:steam', 'Steam' ],
	[ 'geosite:category-porn', _('Adult sites') ]
];

// Lists that older versions kept on the main section, shown as normal rules now.
var BASIC = [
	[ 'block_ip', 'ip', 'block', _('Blocked IPs') ],
	[ 'block_domain', 'domain', 'block', _('Blocked domains') ],
	[ 'direct_ip', 'ip', 'direct', _('Direct IPs') ],
	[ 'direct_domain', 'domain', 'direct', _('Direct domains') ]
];

return view.extend({
	load: function() {
		return uci.load('xraypanel');
	},

	// Brings older settings into the rule table. The changes are staged, so they only take
	// effect with Save & Apply, and the router keeps routing the same way meanwhile.
	migrate: function() {
		// Old rules kept everything in one "match" list, where any entry matched (OR).
		// Fields of a rule must all match (AND), so each kind becomes its own rule.
		uci.sections('xraypanel', 'rule').forEach(function(r) {
			if (r.match == null || r.domain != null || r.ip != null || r.port != null) return;
			var lg = legacy(r['.name']);
			var parts = [];
			if (lg.domain.length) parts.push([ 'domain', lg.domain ]);
			if (lg.ip.length) parts.push([ 'ip', lg.ip ]);
			if (lg.port.length) parts.push([ 'port', lg.port.join(',') ]);
			uci.unset('xraypanel', r['.name'], 'match');
			if (!parts.length) return;
			uci.set('xraypanel', r['.name'], parts[0][0], parts[0][1]);
			var after = r['.name'];
			parts.slice(1).forEach(function(p) {
				var sid = uci.add('xraypanel', 'rule');
				[ 'label', 'enabled', 'outbound' ].forEach(function(k) {
					if (r[k] != null) uci.set('xraypanel', sid, k, r[k]);
				});
				uci.set('xraypanel', sid, p[0], p[1]);
				uci.move('xraypanel', sid, after, true);
				after = sid;
			});
		});

		// Blocked/direct lists on the main section become the first rules, in the same order
		// gen.uc used to apply them.
		var first = (uci.sections('xraypanel', 'rule')[0] || {})['.name'];
		BASIC.forEach(function(b) {
			var v = L.toArray(uci.get('xraypanel', 'main', b[0]));
			if (uci.get('xraypanel', 'main', b[0]) == null) return;
			uci.unset('xraypanel', 'main', b[0]);
			if (!v.length) return;
			var sid = uci.add('xraypanel', 'rule');
			uci.set('xraypanel', sid, 'label', b[3]);
			uci.set('xraypanel', sid, 'enabled', '1');
			uci.set('xraypanel', sid, b[1], v);
			uci.set('xraypanel', sid, 'outbound', b[2]);
			if (first) uci.move('xraypanel', sid, first, false);
		});
	},

	render: function() {
		var m, s, o;
		var nodes = uci.sections('xraypanel', 'node');

		this.migrate();

		m = new form.Map('xraypanel', _('Routing'),
			_('Domain entries are checked against the site name first; IP entries only apply once no domain entry matched.'));

		s = m.section(form.NamedSection, 'main', 'main');
		s.addremove = false;

		o = s.option(form.ListValue, 'default_out', _('Default route'),
			_('Where traffic goes when no rule matches.'));
		o.value('proxy', _('Proxy'));
		o.value('direct', _('Direct'));
		o.default = 'proxy';

		/* Rules */

		s = m.section(form.GridSection, 'rule', _('Routing rules'),
			_('Checked from top to bottom; the first match wins. Inside one rule every filled field must match, except Domain and IP: the rule matches when either of them does. Drag rows to reorder.'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.modaltitle = function(section_id) {
			return '%h'.format(_('Rule') + ': ' + (uci.get('xraypanel', section_id, 'label') || _('new')));
		};

		s.tab('dest', _('Destination'));
		s.tab('source', _('Source'));
		s.tab('other', _('Network'));

		o = s.taboption('dest', form.Flag, 'enabled', _('On'));
		o.default = '1';
		o.editable = true;
		o.rmempty = false;

		o = s.taboption('dest', form.Value, 'label', _('Name'));
		o.textvalue = function(section_id) {
			return '%h'.format(uci.get('xraypanel', section_id, 'label') || '');
		};

		o = s.taboption('dest', form.DynamicList, 'domain', _('Domain'),
			_('Examples: geosite:ir, domain:example.com, full:www.example.com, keyword:bank, regexp:\\.ir$'));
		o.modalonly = true;
		GEOSITES.forEach(function(g) {
			o.value(g[0], '%s (%s)'.format(g[1], g[0]));
		});
		o.validate = checkDomain;

		o = s.taboption('dest', form.DynamicList, 'ip', _('IP'),
			_('Examples: geoip:ir, geoip:private, 1.2.3.4, 10.0.0.0/8'));
		o.modalonly = true;
		o.value('geoip:ir', 'geoip:ir');
		o.value('geoip:private', 'geoip:private');
		o.validate = checkIP;

		o = s.taboption('dest', form.Value, 'port', _('Port'),
			_('Examples: 443, 1000-2000, 53,443'));
		o.modalonly = true;
		o.validate = function(section_id, value) { return validPorts(value); };

		o = s.taboption('source', form.DynamicList, 'source', _('Source IP'),
			_('A device or range on your LAN, for example 192.168.1.50 or 192.168.1.0/24'));
		o.modalonly = true;
		o.validate = checkSource;

		o = s.taboption('source', form.Value, 'source_port', _('Source port'));
		o.modalonly = true;
		o.validate = function(section_id, value) { return validPorts(value); };

		o = s.taboption('source', form.MultiValue, 'inbound', _('Inbound tags'),
			_('Leave empty to match everything.'));
		o.modalonly = true;
		for (var tag in INBOUNDS)
			o.value(tag, INBOUNDS[tag]);

		o = s.taboption('other', form.ListValue, 'network', _('Network'));
		o.modalonly = true;
		// LAN UDP is not redirected to Xray, so only TCP ever reaches these rules.
		o.value('', _('Any'));
		o.value('tcp', 'TCP');

		o = s.taboption('other', form.MultiValue, 'protocol', _('Protocol'),
			_('Detected by sniffing.'));
		o.modalonly = true;
		o.value('http', 'HTTP');
		o.value('tls', 'TLS');
		o.value('bittorrent', 'BitTorrent');

		o = s.taboption('other', form.DynamicList, 'attrs', _('Attributes'),
			_('HTTP request attributes as key=value, for example :method=GET'));
		o.modalonly = true;
		o.validate = function(section_id, v) {
			return (!v || v.indexOf('=') > 0) ? true : _('Use key=value');
		};

		/* Table columns, like 3x-ui */

		o = s.option(form.DummyValue, '_source', _('Source'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			return cell([
				[ 'IP', vals(section_id, 'source') ],
				[ _('Port'), vals(section_id, 'source_port') ]
			]);
		};

		o = s.option(form.DummyValue, '_network', _('Network'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			return cell([
				[ 'L4', vals(section_id, 'network') ],
				[ _('Protocol'), vals(section_id, 'protocol') ],
				[ _('Attrs'), vals(section_id, 'attrs') ]
			]);
		};

		o = s.option(form.DummyValue, '_dest', _('Destination'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			return cell([
				[ _('Domain'), vals(section_id, 'domain') ],
				[ 'IP', vals(section_id, 'ip') ],
				[ _('Port'), vals(section_id, 'port') ]
			]);
		};

		o = s.option(form.DummyValue, '_inbound', _('Inbound'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			return cell([ [ _('Tags'), vals(section_id, 'inbound') ] ]);
		};

		o = s.taboption('dest', form.ListValue, 'outbound', _('Outbound'));
		o.value('proxy', _('Proxy (balancer)'));
		o.value('direct', _('Direct'));
		o.value('block', _('Block'));
		nodes.forEach(function(n) {
			o.value('node-' + n['.name'], _('Server: %s').format(n.label || n['.name']));
		});
		o.default = 'direct';
		o.textvalue = function(section_id) {
			var v = this.cfgvalue(section_id) || this.default;
			return '%h'.format(this.vallist[this.keylist.indexOf(v)] || v);
		};

		return m.render();
	}
});
