'use strict';
'require view';
'require form';
'require uci';
'require tools.widgets as widgets';

function checkUrl(section_id, value) {
	if (!value) return true;
	return /^https?:\/\/[^\s\/]+(\/\S*)?$/.test(value) || _('Enter a full http:// or https:// address');
}

return view.extend({
	load: function() {
		return uci.load('xraypanel');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('xraypanel', _('Xray settings'));

		s = m.section(form.NamedSection, 'main', 'main', _('Network'));
		s.addremove = false;

		o = s.option(widgets.DeviceSelect, 'lan_ifaces', _('Interfaces to route'),
			_('Only clients on these network devices go through Xray (usually br-lan). Leave other networks (for example a direct-only Wi-Fi) out. If none is chosen, br-lan is used.'));
		o.multiple = true;
		o.noaliases = true;
		// No nocreate: entries that are not a current device (a network name like "lan", or an
		// interface that is down) must survive a save instead of being dropped.

		o = s.option(form.DynamicList, 'bypass_src', _('Devices that stay direct'),
			_('IP addresses or ranges that never go through Xray.'));
		// firewall.sh only reads a.b.c.d or a.b.c.d/N, not a.b.c.d/255.255.255.0.
		o.validate = function(section_id, v) {
			if (!v) return true;
			var m = v.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(\/(\d+))?$/);
			var ok = m && [ 1, 2, 3, 4 ].every(function(i) { return +m[i] <= 255 && !/^0\d/.test(m[i]); }) &&
				(m[6] == null || +m[6] <= 32);
			return ok ? true : _('Use an address like 192.168.1.50 or a range like 192.168.1.0/24');
		};

		o = s.option(form.Flag, 'block_quic', _('Block QUIC'),
			_('Rejects UDP 443 so apps fall back to TCP, which Xray can carry. Recommended.'));
		o.default = '1';
		o.rmempty = false;

		s = m.section(form.NamedSection, 'main', 'main', _('DNS'));
		s.addremove = false;

		o = s.option(form.Flag, 'dns_enabled', _('Resolve DNS through Xray'),
			_('Avoids poisoned DNS answers. Iranian domains are resolved directly.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'dns_remote', _('DNS server through the proxy'),
			_('A plain IP, or encrypted DNS-over-HTTPS (DoH) such as https://1.1.1.1/dns-query. Put an IP in the URL, not a host name.'));
		o.value('1.1.1.1', '1.1.1.1 (Cloudflare)');
		o.value('8.8.8.8', '8.8.8.8 (Google)');
		o.value('https://1.1.1.1/dns-query', _('Cloudflare DoH (encrypted)'));
		o.value('https://8.8.8.8/dns-query', _('Google DoH (encrypted)'));
		o.placeholder = '1.1.1.1';
		o.validate = function(section_id, v) {
			if (!v) return true;
			var ip = function(a) {
				var m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
				return !!m && [ 1, 2, 3, 4 ].every(function(i) { return +m[i] <= 255 && !/^0\d/.test(m[i]); });
			};
			if (ip(v)) return true;
			var u = v.match(/^https:\/\/([0-9.]+)(:\d{1,5})?\/\S*$/);
			return (u && ip(u[1])) ? true : _('Use an IP like 1.1.1.1 or a DoH address like https://1.1.1.1/dns-query');
		};

		o = s.option(form.Value, 'dns_direct', _('DNS server for Iranian domains'));
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '8.8.8.8';

		s = m.section(form.NamedSection, 'main', 'main', _('Health check'));
		s.addremove = false;

		o = s.option(form.Value, 'probe_url', _('Probe URL'),
			_('Used for the latency test and the automatic fail-open check. It must answer with HTTP 200-399.'));
		o.placeholder = 'https://www.gstatic.com/generate_204';
		o.validate = checkUrl;

		s = m.section(form.NamedSection, 'main', 'main', _('Geo files'));
		s.addremove = false;

		o = s.option(form.ListValue, 'geo_update', _('Automatic update'));
		o.value('off', _('Off'));
		o.value('daily', _('Daily at 04:30'));
		o.value('weekly', _('Weekly, Friday 04:30'));
		o.default = 'daily';

		o = s.option(form.Value, 'geoip_url', _('geoip.dat URL'));
		o.rmempty = false;
		o.validate = checkUrl;

		o = s.option(form.Value, 'geosite_url', _('geosite.dat URL'),
			_('The lite file is small and only has ir, category-ir, private and ads. Other categories come from the extra file below. After changing a URL, press "Update geo files" on the Status page.'));
		o.rmempty = false;
		o.validate = checkUrl;

		o = s.option(form.Value, 'geosite_extra_url', _('More geosite categories'),
			_('A second geosite file for categories the lite file does not have (google, youtube, spotify, speedtest, telegram, openai, netflix and many more). Rules use them as geosite:name. The v2fly file is about 2.4 MB and adds a few MB of memory while Xray starts. Leave empty to turn it off.'));
		o.placeholder = 'https://cdn.jsdelivr.net/gh/v2fly/domain-list-community@release/dlc.dat';
		o.validate = checkUrl;

		s = m.section(form.NamedSection, 'main', 'main', _('Logging'));
		s.addremove = false;

		o = s.option(form.ListValue, 'loglevel', _('Log level'));
		o.value('error', 'error');
		o.value('warning', 'warning');
		o.value('info', 'info');
		o.value('debug', 'debug');
		o.default = 'warning';

		o = s.option(form.Flag, 'access_log', _('Log every connection'),
			_('Useful for debugging rules. Keep it off normally to save memory.'));

		return m.render();
	}
});
