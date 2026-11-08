'use strict';
'require view';
'require form';
'require uci';

var DOMAIN_PREFIX = [ 'geosite', 'domain', 'full', 'keyword', 'regexp', 'ext', 'dotless' ];
var IP_PREFIX = [ 'geoip', 'ext-ip' ];

function validPort(p) {
	return /^[0-9]+$/.test(p) && +p > 0 && +p < 65536;
}

function validIPv4(v) {
	var m = v.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/);
	if (!m) return false;
	for (var i = 1; i <= 4; i++)
		if (+m[i] > 255) return false;
	return m[5] == null || +m[5] <= 32;
}

// Mirrors how gen.uc sorts entries, so typos are caught before Save & Apply.
function checkMatch(value) {
	value = (value || '').trim();
	if (!value) return true;
	if (/^[0-9a-fA-F]*:[0-9a-fA-F:]+(\/[0-9]+)?$/.test(value)) return true;
	var m = value.match(/^([a-z-]+):(.+)$/);
	if (m) {
		if (m[1] == 'port') {
			var ok = m[2].split(',').every(function(p) {
				var r = p.trim().split('-');
				return r.length <= 2 && r.every(validPort);
			});
			return ok || _('Use port:443, port:1000-2000 or port:80,443');
		}
		if (DOMAIN_PREFIX.indexOf(m[1]) >= 0 || IP_PREFIX.indexOf(m[1]) >= 0) return true;
		return _('Unknown type "%s:". Use geosite:, geoip:, domain:, full:, keyword:, regexp:, port: or an IP range').format(m[1]);
	}
	if (/^[0-9.\/]+$/.test(value))
		return validIPv4(value) || _('Not a valid IPv4 address or range');
	if (/\s/.test(value)) return _('One entry per line, without spaces');
	return true;
}

return view.extend({
	load: function() {
		return uci.load('xraypanel');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('xraypanel', _('Routing'),
			_('Rules are checked from top to bottom and the first match wins. Drag rows to reorder. Traffic that matches no rule uses the default route. Note: domain entries are checked against the site name first; IP entries only apply once no domain entry matched.'));

		s = m.section(form.NamedSection, 'main', 'main');
		s.addremove = false;

		o = s.option(form.ListValue, 'default_out', _('Default route'));
		o.value('proxy', _('Proxy'));
		o.value('direct', _('Direct'));
		o.default = 'proxy';

		s = m.section(form.GridSection, 'rule', _('Rules'));
		s.addremove = true;
		s.anonymous = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.modaltitle = function(section_id) {
			return _('Rule') + ': ' + '%h'.format(uci.get('xraypanel', section_id, 'label') || _('new'));
		};

		o = s.option(form.Flag, 'enabled', _('On'));
		o.default = '1';
		o.editable = true;
		o.rmempty = false;

		o = s.option(form.Value, 'label', _('Name'));

		o = s.option(form.DynamicList, 'match', _('Match'),
			_('One entry per line. Examples: geosite:ir, geoip:ir, geosite:ads, domain:example.com, full:www.example.com, keyword:bank, regexp:\\.ir$, 1.2.3.0/24, port:22'));
		o.rmempty = false;
		o.validate = function(section_id, value) { return checkMatch(value); };
		o.textvalue = function(section_id) {
			var v = L.toArray(uci.get('xraypanel', section_id, 'match'));
			return '%h'.format(v.length > 3 ? v.slice(0, 3).join(', ') + ' …' : v.join(', '));
		};

		o = s.option(form.ListValue, 'outbound', _('Send to'));
		o.value('direct', _('Direct'));
		o.value('proxy', _('Proxy'));
		o.value('block', _('Block'));
		o.default = 'direct';

		return m.render();
	}
});
