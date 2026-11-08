'use strict';
// Checks every server through its own local socks port and saves the results.

import * as fs from 'fs';

const RUN = '/var/run/xraypanel';
const CFG = '/var/etc/xraypanel/config.json';

let cfg = null;
try { cfg = json(fs.readfile(CFG) ?? ''); } catch (e) {}
if (!cfg || system('pidof xray >/dev/null') != 0) {
	print('ERROR: Xray is not running\n');
	exit(0);
}

const p = fs.popen('uci -q get xraypanel.main.probe_url', 'r');
const url = trim(p?.read('all') ?? '') || 'https://www.gstatic.com/generate_204';
p?.close();

fs.mkdir(RUN);
let cmd = '';
let names = [];
for (let ib in cfg.inbounds) {
	if (substr(ib.tag, 0, 5) != 'test-') continue;
	const name = substr(ib.tag, 5);
	push(names, name);
	cmd += sprintf("(curl -s -o /dev/null -m 10 -w '%%{http_code} %%{time_total}' -x socks5h://127.0.0.1:%d '%s' > %s/t-%s 2>/dev/null) & ",
		ib.port, url, RUN, name);
}
system(cmd + 'wait');

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

const good = length(filter(names, n => res[n].ok));
print(`OK: ${good} of ${length(names)} servers answered\n`);
