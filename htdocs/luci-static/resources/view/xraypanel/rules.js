'use strict';
'require view';
'require form';
'require uci';

// Laid out like the routing tab of 3x-ui: a "Basic" block of common
// direct/block lists, then an ordered table of full Xray routing rules.

var INBOUNDS = {
	'redir-in': _('LAN (redirected traffic)'),
	'socks-in': _('Router SOCKS (127.0.0.1:10808)')
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

var DOMAIN_TYPES = /^(geosite|domain|full|keyword|regexp|ext|dotless):/;
var IP_TYPES = /^(geoip|ext-ip):/;

function validIPv4(v) {
	var m = v.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(\/(\d+))?$/);
	if (!m) return false;
	for (var i = 1; i <= 4; i++) if (+m[i] > 255) return false;
	return m[6] == null || +m[6] <= 32;
}

function validPorts(v) {
	if (!v) return true;
	var ok = String(v).replace(/\s+/g, '').split(',').every(function(p) {
		var r = p.match(/^(\d+)(-(\d+))?$/);
		if (!r) return false;
		var a = +r[1], b = r[3] != null ? +r[3] : a;
		return a >= 1 && b <= 65535 && a <= b;
	});
	return ok ? true : _('Use ports 1-65535, ranges and commas, like 80,443,1000-2000');
}

function checkDomain(section_id, v) {
	if (!v) return true;
	if (/^[a-z-]+:/i.test(v) && !DOMAIN_TYPES.test(v))
		return _('Unknown prefix. Use geosite:, domain:, full:, keyword:, regexp: or ext:');
	return true;
}

function checkIP(section_id, v) {
	if (!v) return true;
	if (IP_TYPES.test(v) || validIPv4(v) || /^[0-9a-f]*:[0-9a-f:]+(\/\d+)?$/i.test(v)) return true;
	return _('Use geoip:xx or an address like 1.2.3.4 or 10.0.0.0/8');
}

// Rules saved before this page existed keep everything in one "match" list.
function legacy(section_id) {
	var d = [], ip = [], port = [];
	vals(section_id, 'match').forEach(function(v) {
		if (/^port:/.test(v)) port.push(v.substring(5));
		else if (/^(geoip|ext-ip):/.test(v) || /^[0-9.]+(\/[0-9]+)?$/.test(v) || /^[0-9a-f]*:[0-9a-f:]+(\/[0-9]+)?$/i.test(v)) ip.push(v);
		else d.push(v);
	});
	return { domain: d, ip: ip, port: port };
}

return view.extend({
	load: function() {
		return uci.load('xraypanel');
	},

	// Moves rules saved with the old single "match" list into the separate fields.
	// The change is staged, so it only takes effect with Save & Apply.
	migrate: function() {
		uci.sections('xraypanel', 'rule').forEach(function(r) {
			if (r.match == null || r.domain != null || r.ip != null || r.port != null) return;
			var lg = legacy(r['.name']);
			if (lg.domain.length) uci.set('xraypanel', r['.name'], 'domain', lg.domain);
			if (lg.ip.length) uci.set('xraypanel', r['.name'], 'ip', lg.ip);
			if (lg.port.length) uci.set('xraypanel', r['.name'], 'port', lg.port.join(','));
			uci.unset('xraypanel', r['.name'], 'match');
		});
	},

	render: function() {
		var m, s, o;
		var nodes = uci.sections('xraypanel', 'node');

		this.migrate();

		m = new form.Map('xraypanel', _('Routing'),
			_('Domain entries are checked against the site name first; IP entries only apply once no domain entry matched.'));

		/* Basic */

		s = m.section(form.NamedSection, 'main', 'main', _('Basic'),
			_('Common lists, checked before the rules below. Pick from the list or type your own entry.'));
		s.addremove = false;

		o = s.option(form.ListValue, 'default_out', _('Default route'),
			_('Where traffic goes when nothing matches.'));
		o.value('proxy', _('Proxy'));
		o.value('direct', _('Direct'));
		o.default = 'proxy';

		o = s.option(form.DynamicList, 'block_ip', _('Blocked IPs'));
		o.value('geoip:private', _('Private networks'));
		o.value('geoip:ir', _('Iran'));
		o.validate = checkIP;

		o = s.option(form.DynamicList, 'block_domain', _('Blocked domains'));
		o.value('geosite:ads', _('Ads'));
		o.value('geosite:category-ads-all', _('Ads (full geosite only)'));
		o.validate = checkDomain;

		o = s.option(form.DynamicList, 'direct_ip', _('Direct IPs'));
		o.value('geoip:private', _('Private networks'));
		o.value('geoip:ir', _('Iran'));
		o.validate = checkIP;

		o = s.option(form.DynamicList, 'direct_domain', _('Direct domains'));
		o.value('geosite:ir', _('Iran (sites, banks, apps)'));
		o.value('domain:ir', _('All .ir domains'));
		o.value('geosite:category-ir', _('Iranian services'));
		o.validate = checkDomain;

		/* Rules */

		s = m.section(form.GridSection, 'rule', _('Routing rules'),
			_('Checked from top to bottom; the first match wins. Inside one rule every filled field must match. Drag rows to reorder.'));
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
		o.value('geosite:ir', 'geosite:ir');
		o.value('geosite:category-ir', 'geosite:category-ir');
		o.value('geosite:ads', 'geosite:ads');
		o.value('domain:ir', 'domain:ir');
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
		o.datatype = 'ipmask4';

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
		o.value('', _('Any'));
		o.value('tcp', 'TCP');
		o.value('udp', 'UDP');
		o.value('tcp,udp', 'TCP,UDP');

		o = s.taboption('other', form.MultiValue, 'protocol', _('Protocol'),
			_('Detected by sniffing.'));
		o.modalonly = true;
		o.value('http', 'HTTP');
		o.value('tls', 'TLS');
		o.value('quic', 'QUIC');
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
