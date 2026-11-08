'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';

const RUN = '/var/run/xraypanel';
const GEO = '/usr/share/xraypanel/geo';
const CONF = '/var/etc/xraypanel/config.json';
const CACHE = `${RUN}/status-cache.json`;
// The panel polls every 5 s; the xray CLI calls below are refreshed at most this often.
const CACHE_SECONDS = 15;

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
for (let r in (conf?.routing?.rules ?? []))
	if (r.inboundTag?.[0] == 'socks-in') target = r.outboundTag ?? 'balancer';

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
	cache = { pid, at: time(), version: cache?.version, traffic: {}, balancer: null };
	if (!cache.version)
		cache.version = sh("/usr/bin/xray version 2>/dev/null | head -n1 | cut -d' ' -f2");
	if (pid) {
		let q = null;
		try { q = json(sh('/usr/bin/xray api statsquery --server=127.0.0.1:10085 -pattern "outbound>>>" 2>/dev/null') || '{}'); } catch (e) {}
		for (let st in (q?.stat ?? [])) {
			let m = match(st.name, /^outbound>>>(.+)>>>traffic>>>(uplink|downlink)$/);
			if (!m) continue;
			cache.traffic[m[1]] ??= { up: 0, down: 0 };
			cache.traffic[m[1]][m[2] == 'uplink' ? 'up' : 'down'] = +(st.value ?? 0);
		}
		if (target == 'balancer')
			cache.balancer = sh('/usr/bin/xray api bi --server=127.0.0.1:10085 balancer 2>/dev/null');
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
	for (let l in split(cache.balancer ?? '', '\n')) {
		let m = match(l, /node-([A-Za-z0-9_]+)/);
		if (m && index(lc(l), 'selected') >= 0) push(in_use, m[1]);
	}
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
	balancer: cache.balancer,
	mode,
	strategy: uci.get('xraypanel', 'main', 'strategy') ?? 'leastPing',
	servers,
	in_use,
	direct: traffic['direct'] ?? { up: 0, down: 0 },
	blocked: traffic['block'] ?? { up: 0, down: 0 },
	version: cache.version
}), '\n');
