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
uci.foreach('xraypanel', 'node', (s) => {
	if (s.enabled != '0' && s.link) nodes++;
});

let geo = {};
for (let k in [ 'geoip', 'geosite' ]) {
	let st = fs.stat(`${GEO}/${k}.dat`);
	geo[k] = st ? st.size : null;
}

let balancer = null;
if (pid && uci.get('xraypanel', 'main', 'mode') != 'single')
	balancer = sh('/usr/bin/xray api bi --server=127.0.0.1:10085 balancer 2>/dev/null');

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
	version: sh("/usr/bin/xray version 2>/dev/null | head -n1 | cut -d' ' -f2")
}), '\n');
