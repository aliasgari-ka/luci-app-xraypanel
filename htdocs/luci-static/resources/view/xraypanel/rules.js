'use strict';
'require view';
'require form';
'require uci';

return view.extend({
	load: function() {
		return uci.load('xraypanel');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('xraypanel', _('Routing'),
			_('Rules are checked from top to bottom and the first match wins. Drag rows to reorder. Traffic that matches no rule uses the default route.'));

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
			return _('Rule') + ': ' + (uci.get('xraypanel', section_id, 'label') || _('new'));
		};

		o = s.option(form.Flag, 'enabled', _('On'));
		o.default = '1';
		o.editable = true;
		o.rmempty = false;

		o = s.option(form.Value, 'label', _('Name'));

		o = s.option(form.DynamicList, 'match', _('Match'),
			_('One entry per line. Examples: geosite:ir, geoip:ir, geosite:ads, domain:example.com, full:www.example.com, keyword:bank, regexp:\\.ir$, 1.2.3.0/24, port:22'));
		o.rmempty = false;
		o.textvalue = function(section_id) {
			var v = L.toArray(uci.get('xraypanel', section_id, 'match'));
			return v.length > 3 ? v.slice(0, 3).join(', ') + ' …' : v.join(', ');
		};

		o = s.option(form.ListValue, 'outbound', _('Send to'));
		o.value('direct', _('Direct'));
		o.value('proxy', _('Proxy'));
		o.value('block', _('Block'));
		o.default = 'direct';

		return m.render();
	}
});
