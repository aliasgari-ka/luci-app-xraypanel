'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';

const RUN = '/var/run/xraypanel';
const GEO = '/usr/share/xraypanel/geo';
const CONF = '/var/etc/xraypanel/config.json';
const CACHE = `${RUN}/status-cache.json`;
// The panel polls every 5 s; Xray's counters are refreshed at most this often.
const CACHE_SECONDS = 15;
// Keep in sync with gen.uc.
const PORT_METRICS = 10085;

function rd(p) {
	let s = fs.readfile(p);
	return (s != null) ? trim(s) : null;
}

function sh(cmd) {
	let p = fs.popen(cmd, 'r');
	if (!p) return null;
	let s = p.read('all');
	p.close();
	return trim(s ?? '');
}

function joined(...parts) {
	parts = filter(parts, p => p != null && p != '');
	return length(parts) ? join('\n', parts) : null;
}

// Only this package's procd instance counts, not any other xray process.
let pid = null;
try {
	const svc = json(sh(`ubus call service list '{"name":"xraypanel"}' 2>/dev/null`) || '{}');
	const inst = svc?.xraypanel?.instances?.xray;
	if (inst?.running) pid = inst.pid;
} catch (e) {}

let rss = null;
if (pid) {
	let st = rd(`/proc/${pid}/status`);
	let m = st ? match(st, /VmRSS:\s+([0-9]+)/) : null;
	if (m) rss = int(m[1]);
}

const uci = cursor();
uci.load('xraypanel');
const mode = uci.get('xraypanel', 'main', 'mode') ?? 'balance';

// What Xray actually runs with: servers that were skipped are not counted.
let conf = null;
if (pid) {
	try { conf = json(fs.readfile(CONF) ?? ''); } catch (e) {}
}
let used = {}, target = null;
for (let ob in (conf?.outbounds ?? []))
	if (substr(ob.tag ?? '', 0, 5) == 'node-') used[substr(ob.tag, 5)] = true;
// gen.uc's own socks-in rule carries the proxy target; Xray uses the first match.
for (let r in (conf?.routing?.rules ?? []))
	if (r.inboundTag?.[0] == 'socks-in') {
		target = r.outboundTag ?? 'balancer';
		break;
	}

let nodes = 0;
let servers = [];
uci.foreach('xraypanel', 'node', (s) => {
	const on = s.enabled != '0' && !!s.link;
	const active = conf ? !!used[s['.name']] : on;
	if (active) nodes++;
	push(servers, { name: s['.name'], label: s.label ?? s['.name'], enabled: on, active });
});

let cache = null;
try { cache = json(rd(CACHE) || 'null'); } catch (e) {}
if (!pid || !cache || cache.pid != pid || time() - (cache.at ?? 0) >= CACHE_SECONDS) {
	cache = { pid, at: time(), version: cache?.version, traffic: {}, observatory: null };
	if (!cache.version)
		cache.version = sh("/usr/bin/xray version 2>/dev/null | head -n1 | cut -d' ' -f2");
	if (pid) {
		// Xray's metrics endpoint (see gen.uc): a small HTTP fetch instead of starting the xray CLI.
		let v = null;
		try { v = json(sh(`uclient-fetch -q -T 3 -O - http://127.0.0.1:${PORT_METRICS}/debug/vars 2>/dev/null`) || 'null'); } catch (e) {}
		for (let tag, t in (v?.stats?.outbound ?? {}))
			cache.traffic[tag] = { up: +(t.uplink ?? 0), down: +(t.downlink ?? 0) };
		cache.observatory = v?.observatory;
	}
	fs.writefile(CACHE, sprintf('%J', cache));
}
const traffic = cache.traffic ?? {};

let tests = {};
try { tests = json(rd(`${RUN}/tests.json`) || '{}'); } catch (e) {}

for (let s in servers) {
	const t = traffic['node-' + s.name];
	s.up = t?.up ?? 0;
	s.down = t?.down ?? 0;
	s.test = tests[s.name];
}

let geo = {};
for (let k in [ 'geoip', 'geosite' ]) {
	let st = fs.stat(`${GEO}/${k}.dat`);
	geo[k] = st ? st.size : null;
}

let in_use = [];
if (target == 'balancer') {
	// Same choice the balancer makes from the observatory: { "node-x": { "alive": true, "delay": 120 } }.
	const bal = conf?.routing?.balancers?.[0];
	let alive = [];
	for (let tag, o in (cache.observatory ?? {}))
		if (o?.alive && substr(tag, 0, 5) == 'node-') push(alive, [ tag, +(o.delay ?? 0) ]);
	if (bal?.strategy?.type == 'leastPing' && length(alive))
		alive = [ sort(alive, (a, b) => a[1] - b[1])[0] ];
	for (let t in (length(alive) ? map(alive, a => a[0]) : [ bal?.fallbackTag ]))
		if (t && substr(t, 0, 5) == 'node-') push(in_use, substr(t, 5));
}
else if (target && substr(target, 0, 5) == 'node-') {
	push(in_use, substr(target, 5));
}

print(sprintf('%J', {
	enabled: uci.get('xraypanel', 'main', 'enabled') == '1',
	running: !!pid,
	rss_kb: rss,
	active: fs.access(`${RUN}/active`),
	fails: int(rd(`${RUN}/fails`) || 0),
	latency: rd(`${RUN}/latency`),
	last_ok: int(rd(`${RUN}/last_ok`) || 0),
	error: joined(rd(`${RUN}/error`), rd(`${RUN}/fw_error`)),
	warnings: joined(rd(`${RUN}/warnings`), rd(`${RUN}/fw_warn`)),
	// Shown for 10 minutes after a manual geo update.
	geo_result: (time() - (fs.stat(`${RUN}/geo_result`)?.mtime ?? 0) < 600) ? rd(`${RUN}/geo_result`) : null,
	nodes,
	geo,
	geo_updated: int(rd(`${GEO}/updated`) || 0),
	now: time(),
	mode,
	strategy: uci.get('xraypanel', 'main', 'strategy') ?? 'leastPing',
	servers,
	in_use,
	direct: traffic['direct'] ?? { up: 0, down: 0 },
	blocked: traffic['block'] ?? { up: 0, down: 0 },
	version: cache.version
}), '\n');
