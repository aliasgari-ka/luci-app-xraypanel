'use strict';
// Checks every server through its own local socks port and saves the results.

import * as fs from 'fs';

const RUN = '/var/run/xraypanel';
const CFG = '/var/etc/xraypanel/config.json';

function running() {
	return system(`ubus call service list '{"name":"xraypanel"}' 2>/dev/null | grep -q '"running": true'`) == 0;
}

// Single-quotes a value for the shell.
function shq(s) {
	return "'" + replace(`${s}`, "'", "'\\''") + "'";
}

let cfg = null;
try { cfg = json(fs.readfile(CFG) ?? ''); } catch (e) {}
if (!cfg || !running()) {
	print('ERROR: Xray is not running\n');
	exit(0);
}

const p = fs.popen('uci -q get xraypanel.main.probe_url', 'r');
const url = trim(p?.read('all') ?? '') || 'https://www.gstatic.com/generate_204';
p?.close();

fs.mkdir(RUN);
let names = [], cmds = [];
for (let ib in cfg.inbounds) {
	if (substr(ib.tag, 0, 5) != 'test-') continue;
	const name = substr(ib.tag, 5);
	if (!match(name, /^[A-Za-z0-9_]+$/)) continue;
	push(names, name);
	push(cmds, sprintf("(curl -s -o /dev/null -m 10 -w '%%{http_code} %%{time_total}' -x socks5h://127.0.0.1:%d %s > %s/t-%s 2>/dev/null) & ",
		int(ib.port), shq(url), RUN, name));
}
// All at once: a curl costs about 200 KB here, and LuCI gives up on a command after 30 s.
system(join('', cmds) + 'wait');

let res = {};
const now = time();
for (let name in names) {
	const f = `${RUN}/t-${name}`;
	const out = split(trim(fs.readfile(f) ?? ''), ' ');
	fs.unlink(f);
	const code = int(out[0] ?? 0);
	res[name] = {
		ok: code >= 200 && code < 400,
		code,
		ms: (code >= 200 && code < 400) ? int(+out[1] * 1000) : null,
		at: now
	};
}
fs.writefile(`${RUN}/tests.json`, sprintf('%J', res));

const good = sort(filter(names, n => res[n].ok), (a, b) => res[a].ms - res[b].ms);
if (!length(good)) {
	print(`ERROR: none of ${length(names)} servers answered\n`);
	exit(0);
}
const lp = fs.popen(`uci -q get xraypanel.${good[0]}.label`, 'r');
const best = trim(lp?.read('all') ?? '') || good[0];
lp?.close();
print(`OK: ${length(good)} of ${length(names)} servers answered. Fastest: ${best} (${res[good[0]].ms} ms)\n`);
