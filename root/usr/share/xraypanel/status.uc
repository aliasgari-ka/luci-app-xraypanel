'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';

const RUN = '/var/run/xraypanel';
const GEO = '/usr/share/xraypanel/geo';

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

const pid = sh('pidof xray');
let rss = null;
if (pid) {
	let st = rd(`/proc/${split(pid, ' ')[0]}/status`);
	let m = st ? match(st, /VmRSS:\s+([0-9]+)/) : null;
	if (m) rss = int(m[1]);
}

const uci = cursor();
uci.load('xraypanel');
let nodes = 0;
let servers = [];
uci.foreach('xraypanel', 'node', (s) => {
	const on = s.enabled != '0' && !!s.link;
	if (on) nodes++;
	push(servers, { name: s['.name'], label: s.label ?? s['.name'], enabled: on });
});

// Traffic counters since Xray started, per outbound tag.
let traffic = {};
if (pid) {
	let q = null;
	try { q = json(sh('/usr/bin/xray api statsquery --server=127.0.0.1:10085 -pattern "outbound>>>" 2>/dev/null') || '{}'); } catch (e) {}
	for (let st in (q?.stat ?? [])) {
		let m = match(st.name, /^outbound>>>(.+)>>>traffic>>>(uplink|downlink)$/);
		if (!m) continue;
		traffic[m[1]] ??= { up: 0, down: 0 };
		traffic[m[1]][m[2] == 'uplink' ? 'up' : 'down'] = +(st.value ?? 0);
	}
}

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

const mode = uci.get('xraypanel', 'main', 'mode') ?? 'balance';
let balancer = null, in_use = [];
if (pid && mode != 'single' && nodes > 1) {
	balancer = sh('/usr/bin/xray api bi --server=127.0.0.1:10085 balancer 2>/dev/null');
	for (let l in split(balancer ?? '', '
')) {
		let m = match(l, /node-([A-Za-z0-9_]+)/);
		if (m && index(lc(l), 'selected') >= 0) push(in_use, m[1]);
	}
}
else if (pid) {
	let want = uci.get('xraypanel', 'main', 'node');
	let on = filter(servers, s => s.enabled);
	let hit = filter(on, s => s.name == want);
	if (length(hit) || length(on)) push(in_use, (hit[0] ?? on[0]).name);
}

print(sprintf('%J', {
	enabled: uci.get('xraypanel', 'main', 'enabled') == '1',
	running: !!pid,
	rss_kb: rss,
	active: fs.access(`${RUN}/active`),
	fails: int(rd(`${RUN}/fails`) || 0),
	latency: rd(`${RUN}/latency`),
	last_ok: int(rd(`${RUN}/last_ok`) || 0),
	error: rd(`${RUN}/error`),
	warnings: rd(`${RUN}/warnings`),
	nodes,
	geo,
	geo_updated: int(rd(`${GEO}/updated`) || 0),
	now: time(),
	balancer,
	mode,
	strategy: uci.get('xraypanel', 'main', 'strategy') ?? 'leastPing',
	servers,
	in_use,
	direct: traffic['direct'] ?? { up: 0, down: 0 },
	blocked: traffic['block'] ?? { up: 0, down: 0 },
	version: sh("/usr/bin/xray version 2>/dev/null | head -n1 | cut -d' ' -f2")
}), '\n');
