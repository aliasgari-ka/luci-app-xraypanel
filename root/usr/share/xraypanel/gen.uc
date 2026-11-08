'use strict';

import { cursor } from 'uci';

const uci = cursor();
uci.load('xraypanel');

const RESERVED_MARK = 255;

function opt(v, d) { return (v == null || v == '') ? d : v; }

function on(v, d) {
	if (v == null || v == '') return d;
	v = lc(`${v}`);
	return v == '1' || v == 'true' || v == 'on' || v == 'yes';
}

function list(v) {
	if (v == null || v == '') return [];
	return type(v) == 'array' ? v : split(trim(v), /[\s,]+/);
}

function urldec(s) {
	if (s == null) return null;
	return replace(s, /%([0-9A-Fa-f]{2})/g, (m, h) => chr(hex(h)));
}

function b64(s) {
	if (s == null) return null;
	s = replace(replace(trim(s), /-/g, '+'), /_/g, '/');
	s = replace(s, /=+$/, '');
	while (length(s) % 4) s += '=';
	return b64dec(s);
}

function clean(v) {
	if (type(v) == 'object') {
		let o = {};
		for (let k, x in v) {
			x = clean(x);
			if (x != null) o[k] = x;
		}
		return o;
	}
	if (type(v) == 'array') {
		let a = [];
		for (let x in v) {
			x = clean(x);
			if (x != null) push(a, x);
		}
		return a;
	}
	return (v === '') ? null : v;
}

function parse_query(qs) {
	let q = {};
	for (let kv in split(qs, '&')) {
		if (kv == '') continue;
		let e = index(kv, '=');
		if (e < 0) q[urldec(kv)] = '';
		else q[urldec(substr(kv, 0, e))] = urldec(substr(kv, e + 1));
	}
	return q;
}

function split_hostport(s) {
	let m = match(s, /^\[([^\]]+)\]:([0-9]+)$/) || match(s, /^([^:\/\[\]]+):([0-9]+)$/);
	return m ? { host: m[1], port: int(m[2]) } : null;
}

function parse_url(link) {
	let m = match(link, /^([a-zA-Z0-9]+):\/\/([^#]*)(#(.*))?$/);
	if (!m) return null;
	let rest = m[2];
	let u = { scheme: lc(m[1]), name: (m[4] != null) ? urldec(m[4]) : null, query: {} };
	let qi = index(rest, '?');
	if (qi >= 0) {
		u.query = parse_query(substr(rest, qi + 1));
		rest = substr(rest, 0, qi);
	}
	rest = replace(rest, /\/+$/, '');
	let at = rindex(rest, '@');
	if (at >= 0) {
		u.user = substr(rest, 0, at);
		rest = substr(rest, at + 1);
	}
	let hp = split_hostport(rest);
	if (!hp) return null;
	u.host = hp.host;
	u.port = hp.port;
	return u;
}

function stream(net, security, q) {
	net = lc(opt(net, 'tcp'));
	if (net == 'raw') net = 'tcp';
	if (net == 'h2') net = 'http';
	if (net == 'splithttp') net = 'xhttp';
	security = lc(opt(security, 'none'));
	if (security == 'xtls') security = 'tls';

	const sni = opt(q.sni, opt(q.serverName, q.peer));
	let ss = { network: net, security: security, sockopt: { mark: RESERVED_MARK } };

	if (security == 'tls')
		ss.tlsSettings = {
			serverName: opt(sni, q.host),
			allowInsecure: on(q.allowInsecure, false) || on(q.insecure, false),
			fingerprint: q.fp,
			alpn: q.alpn ? split(q.alpn, ',') : null
		};
	else if (security == 'reality')
		ss.realitySettings = {
			serverName: sni,
			fingerprint: opt(q.fp, 'chrome'),
			publicKey: q.pbk,
			shortId: q.sid,
			spiderX: q.spx
		};
	else if (security != 'none')
		die(`unsupported security "${security}"`);

	switch (net) {
	case 'tcp':
		if (q.headerType == 'http')
			ss.tcpSettings = { header: { type: 'http', request: {
				path: [ opt(q.path, '/') ],
				headers: q.host ? { Host: split(q.host, ',') } : null
			} } };
		break;
	case 'ws':
		ss.wsSettings = { path: opt(q.path, '/'), host: q.host };
		break;
	case 'grpc':
		ss.grpcSettings = { serviceName: opt(q.serviceName, q.path), multiMode: q.mode == 'multi' };
		break;
	case 'httpupgrade':
		ss.httpupgradeSettings = { path: opt(q.path, '/'), host: q.host };
		break;
	case 'xhttp':
		ss.xhttpSettings = { path: opt(q.path, '/'), host: q.host, mode: opt(q.mode, 'auto') };
		break;
	case 'http':
		ss.httpSettings = { path: opt(q.path, '/'), host: q.host ? split(q.host, ',') : null };
		break;
	case 'kcp':
		ss.kcpSettings = { header: { type: opt(q.headerType, 'none') }, seed: q.seed };
		break;
	default:
		die(`unsupported transport "${net}"`);
	}
	return ss;
}

function parse_vmess(link) {
	const raw = b64(substr(link, 8));
	if (raw == null) die('vmess link is not valid base64');
	let j;
	try { j = json(raw); } catch (e) { die('vmess link does not contain valid JSON'); }
	if (!j.add || !j.port || !j.id) die('vmess link is missing address, port or id');
	const sec = (j.tls == 'tls' || j.tls == 'reality') ? j.tls : 'none';
	const q = {
		headerType: j.type, host: j.host, path: j.path, serviceName: j.path,
		sni: j.sni, alpn: j.alpn, fp: j.fp,
		allowInsecure: (j.allowInsecure != null) ? `${j.allowInsecure}` : ((j.insecure != null) ? `${j.insecure}` : null),
		mode: j.mode, pbk: j.pbk, sid: j.sid, spx: j.spx
	};
	return {
		name: j.ps,
		ob: {
			protocol: 'vmess',
			settings: { vnext: [ { address: j.add, port: int(j.port), users: [
				{ id: j.id, alterId: int(opt(j.aid, 0)), security: opt(j.scy, 'auto') }
			] } ] },
			streamSettings: stream(j.net, sec, q)
		}
	};
}

function parse_std(u) {
	const q = u.query;
	if (!u.user) die(`${u.scheme} link has no ${u.scheme == 'trojan' ? 'password' : 'UUID'}`);
	let ob;
	if (u.scheme == 'vless')
		ob = { protocol: 'vless', settings: { vnext: [ { address: u.host, port: u.port, users: [
			{ id: urldec(u.user), encryption: opt(q.encryption, 'none'), flow: q.flow }
		] } ] } };
	else
		ob = { protocol: 'trojan', settings: { servers: [
			{ address: u.host, port: u.port, password: urldec(u.user) }
		] } };
	ob.streamSettings = stream(q.type, opt(q.security, (u.scheme == 'trojan') ? 'tls' : 'none'), q);
	return { name: u.name, ob };
}

function parse_ss(link) {
	let body = substr(link, 5), name = null;
	let h = index(body, '#');
	if (h >= 0) {
		name = urldec(substr(body, h + 1));
		body = substr(body, 0, h);
	}
	let qi = index(body, '?');
	if (qi >= 0) {
		if (parse_query(substr(body, qi + 1)).plugin)
			die('shadowsocks plugins are not supported');
		body = substr(body, 0, qi);
	}
	body = replace(body, /\/+$/, '');

	let cred, hp;
	let at = rindex(body, '@');
	if (at >= 0) {
		let user = substr(body, 0, at);
		let dec = b64(user);
		cred = (dec != null && index(dec, ':') > 0) ? dec : urldec(user);
		hp = split_hostport(substr(body, at + 1));
	}
	else {
		let dec = b64(body);
		let a = (dec != null) ? rindex(dec, '@') : -1;
		if (a < 0) die('shadowsocks link is not valid');
		cred = substr(dec, 0, a);
		hp = split_hostport(substr(dec, a + 1));
	}
	let c = index(cred, ':');
	if (c <= 0) die('shadowsocks link has no method:password');
	if (!hp) die('shadowsocks link has no host:port');
	return {
		name,
		ob: {
			protocol: 'shadowsocks',
			settings: { servers: [ { address: hp.host, port: hp.port, method: substr(cred, 0, c), password: substr(cred, c + 1) } ] },
			streamSettings: { network: 'tcp', sockopt: { mark: RESERVED_MARK } }
		}
	};
}

function parse_link(link) {
	link = trim(link);
	if (substr(link, 0, 1) == '{') {
		let ob;
		try { ob = json(link); } catch (e) { die('custom outbound is not valid JSON'); }
		if (type(ob) != 'object' || !ob.protocol) die('custom outbound needs a "protocol" field');
		ob.streamSettings ??= {};
		ob.streamSettings.sockopt ??= {};
		ob.streamSettings.sockopt.mark = RESERVED_MARK;
		return { name: ob.tag, ob };
	}
	let m = match(link, /^([a-zA-Z0-9]+):\/\//);
	let scheme = m ? lc(m[1]) : '';
	switch (scheme) {
	case 'vmess':
		return parse_vmess(link);
	case 'ss':
		return parse_ss(link);
	case 'vless':
	case 'trojan':
		let u = parse_url(link);
		if (!u) die(`${scheme} link is not valid`);
		return parse_std(u);
	default:
		die(`unsupported link type "${scheme || substr(link, 0, 10)}"`);
	}
}

function rule(fields, target) {
	let r = { type: 'field' };
	for (let k, v in fields) r[k] = v;
	for (let k, v in target) r[k] = v;
	return r;
}

const main = uci.get_all('xraypanel', 'main') ?? {};
let warnings = [];
let nodes = [];

uci.foreach('xraypanel', 'node', (s) => {
	if (!on(s.enabled, true) || !s.link) return;
	try {
		let r = parse_link(s.link);
		r.ob.tag = 'node-' + s['.name'];
		push(nodes, r.ob);
	}
	catch (e) {
		push(warnings, `Server "${opt(s.label, s['.name'])}" skipped: ${e.message}`);
	}
});

if (!length(nodes)) {
	for (let w in warnings) warn(w, '\n');
	warn('No usable server. Add at least one enabled server with a valid link.\n');
	exit(1);
}

// Server hostnames must resolve without going through the proxy itself.
let server_domains = [];
function add_server(addr) {
	if (addr && !match(addr, /^[0-9.]+$/) && index(addr, ':') < 0)
		push(server_domains, 'full:' + addr);
}
for (let n in nodes) {
	let st = n.settings ?? {};
	for (let e in (st.vnext ?? [])) add_server(e.address);
	for (let e in (st.servers ?? [])) add_server(e.address);
	n.streamSettings ??= {};
	n.streamSettings.sockopt ??= {};
	n.streamSettings.sockopt.domainStrategy ??= 'UseIPv4';
}

let target;
if (opt(main.mode, 'balance') == 'single' || length(nodes) == 1) {
	const want = 'node-' + opt(main.node, '');
	target = { outboundTag: length(filter(nodes, n => n.tag == want)) ? want : nodes[0].tag };
}
else {
	target = { balancerTag: 'balancer' };
}

const strategy = opt(main.strategy, 'leastPing');
const probe_url = opt(main.probe_url, 'https://www.gstatic.com/generate_204');
const dns_remote = opt(main.dns_remote, '1.1.1.1');
const dns_direct = opt(main.dns_direct, '8.8.8.8');

function outref(name) {
	if (name == 'direct' || name == 'block') return { outboundTag: name };
	return target;
}

let rules = [
	rule({ inboundTag: [ 'api-in' ] }, { outboundTag: 'api' }),
	rule({ inboundTag: [ 'dns-in' ] }, { outboundTag: 'dns-out' }),
	rule({ inboundTag: [ 'dns-internal' ], ip: [ dns_direct ] }, { outboundTag: 'direct' }),
	rule({ inboundTag: [ 'dns-internal' ] }, target),
	rule({ inboundTag: [ 'socks-in' ] }, target)
];

uci.foreach('xraypanel', 'rule', (s) => {
	if (!on(s.enabled, true)) return;
	let dom = [], ip = [], port = [];
	for (let v in list(s.match)) {
		v = trim(v);
		if (v == '') continue;
		if (match(v, /^port:/)) push(port, substr(v, 5));
		else if (match(v, /^(geoip|ext-ip):/)) push(ip, v);
		else if (match(v, /^[0-9.]+(\/[0-9]+)?$/) || match(v, /^[0-9a-fA-F]*:[0-9a-fA-F:]+(\/[0-9]+)?$/)) push(ip, v);
		else push(dom, v);
	}
	const t = outref(opt(s.outbound, 'direct'));
	if (length(dom)) push(rules, rule({ domain: dom }, t));
	if (length(ip)) push(rules, rule({ ip: ip }, t));
	if (length(port)) push(rules, rule({ port: join(',', port) }, t));
});

push(rules, rule({ network: 'tcp,udp' }, (opt(main.default_out, 'proxy') == 'direct') ? { outboundTag: 'direct' } : target));

let outbounds = [
	{ tag: 'direct', protocol: 'freedom', streamSettings: { sockopt: { mark: RESERVED_MARK, domainStrategy: 'UseIPv4' } } }
];
for (let n in nodes) push(outbounds, n);
push(outbounds, { tag: 'block', protocol: 'blackhole' });
push(outbounds, { tag: 'dns-out', protocol: 'dns', streamSettings: { sockopt: { mark: RESERVED_MARK } } });

let balancers = null, observatory = null;
if (target.balancerTag) {
	balancers = [ {
		tag: 'balancer',
		selector: [ 'node-' ],
		strategy: { type: strategy },
		fallbackTag: nodes[0].tag
	} ];
	if (strategy == 'leastPing')
		observatory = {
			subjectSelector: [ 'node-' ],
			probeUrl: probe_url,
			probeInterval: `${int(opt(main.probe_interval, 60))}s`,
			enableConcurrency: true
		};
}

const cfg = clean({
	log: {
		loglevel: opt(main.loglevel, 'warning'),
		access: on(main.access_log, false) ? null : 'none'
	},
	api: { tag: 'api', services: [ 'RoutingService' ] },
	dns: {
		tag: 'dns-internal',
		queryStrategy: 'UseIPv4',
		servers: [
			length(server_domains) ? { address: dns_direct, domains: server_domains, skipFallback: true } : null,
			{ address: dns_direct, domains: [ 'geosite:ir', 'domain:ir' ], skipFallback: true },
			dns_remote
		]
	},
	inbounds: [
		{ tag: 'redir-in', port: 12345, protocol: 'dokodemo-door',
		  settings: { network: 'tcp', followRedirect: true },
		  sniffing: { enabled: true, destOverride: [ 'http', 'tls' ] } },
		{ tag: 'socks-in', listen: '127.0.0.1', port: 10808, protocol: 'socks', settings: { udp: false } },
		{ tag: 'dns-in', listen: '127.0.0.1', port: 5353, protocol: 'dokodemo-door',
		  settings: { address: dns_remote, port: 53, network: 'tcp,udp' } },
		{ tag: 'api-in', listen: '127.0.0.1', port: 10085, protocol: 'dokodemo-door',
		  settings: { address: '127.0.0.1' } }
	],
	outbounds,
	routing: { domainStrategy: 'IPIfNonMatch', rules, balancers },
	observatory,
	policy: { levels: { '0': { handshake: 4, connIdle: 300, uplinkOnly: 1, downlinkOnly: 1, bufferSize: 64 } } }
});

print(sprintf('%J', cfg), '\n');
for (let w in warnings) warn(w, '\n');
