'use strict';
// Imports the servers of one subscription into uci.
// Usage: ucode sub.uc <subscription-section> <downloaded-file>
// Servers are matched by name, so they keep their section name across updates.
// Only uci is written; Xray is not touched (new servers are used after the next apply).

import * as fs from 'fs';
import { cursor } from 'uci';

const MAX = 60;
const uci = cursor();
uci.load('xraypanel');
const sid = ARGV[0], file = ARGV[1];

function out(s) { print(s, '\n'); exit(0); }

function urldec(s) {
	if (s == null) return null;
	return replace(s, /%([0-9A-Fa-f]{2})/g, (m, h) => chr(hex(h)));
}

function b64(s) {
	if (s == null) return null;
	s = replace(replace(replace(s, /\s+/g, ''), /-/g, '+'), /_/g, '/');
	s = replace(s, /=+$/, '');
	while (length(s) % 4) s += '=';
	return b64dec(s);
}

function link_name(l) {
	if (match(l, /^vmess:\/\//i)) {
		let raw = b64(substr(l, 8)), j = null;
		if (raw != null) try { j = json(raw); } catch (e) {}
		return (j && j.ps) ? `${j.ps}` : ((j && j.add) ? `vmess ${j.add}` : null);
	}
	let h = index(l, '#');
	if (h >= 0 && h < length(l) - 1) return urldec(substr(l, h + 1));
	let m = match(l, /^([a-z0-9]+):\/\/(.*@)?([^:\/?#@]+)/i);
	return m ? `${lc(m[1])} ${m[3]}` : null;
}

// Same fixed-width names as nodes.js nodeName(): anonymous sections get renamed when one above
// them is deleted, and Xray selectors match tag prefixes, so no name may start another.
let seq = 0;
function b36(n, w) {
	const d = '0123456789abcdefghijklmnopqrstuvwxyz';
	let r = '';
	r = substr(d, n % 36, 1);
	n = int(n / 36);
	while (n > 0) { r = substr(d, n % 36, 1) + r; n = int(n / 36); }
	while (length(r) < w) r = '0' + r;
	return r;
}
function node_name() {
	let c = clock(), ms = c ? c[0] * 1000 + int(c[1] / 1000000) : time() * 1000, name;
	name = 'n' + b36(ms, 8) + b36(seq++ % 1296, 2);
	while (uci.get('xraypanel', name) != null)
		name = 'n' + b36(ms, 8) + b36(seq++ % 1296, 2);
	return name;
}

if (uci.get('xraypanel', sid) != 'subscription') out('ERROR: unknown subscription');

let body = trim(fs.readfile(file) ?? '');
if (!length(body)) out('ERROR: subscription is empty');
if (!match(body, /:\/\//)) {
	let dec = b64(body);
	if (dec == null) out('ERROR: subscription is neither links nor base64');
	body = dec;
}

let links = [];
for (let l in split(body, /\r?\n/)) {
	l = trim(l);
	if (match(l, /^(vmess|vless|trojan|ss):\/\/\S+$/i)) push(links, l);
}
if (!length(links)) out('ERROR: no supported servers (vmess, vless, trojan, ss) in the subscription');
if (length(links) > MAX) links = slice(links, 0, MAX);

const subname = uci.get('xraypanel', sid, 'label') || sid;
// Servers the configuration points at are never removed by an update.
let pinned = {};
for (let k in [ 'node', 'backup' ]) {
	let v = uci.get('xraypanel', 'main', k);
	if (v) pinned[v] = true;
}
uci.foreach('xraypanel', 'rule', (r) => {
	if (substr(r.outbound ?? '', 0, 5) == 'node-') pinned[substr(r.outbound, 5)] = true;
});

let old = {};
uci.foreach('xraypanel', 'node', (s) => {
	if (s.sub == sid) old[s.label ?? s['.name']] = s['.name'];
});

let used = {}, added = 0, updated = 0, removed = 0, kept = 0;
for (let l in links) {
	let base = replace(link_name(l) || 'server', /[\r\n\t]/g, ' '), name = base, n = 2;
	while (used[name]) name = `${base} (${n++})`;
	used[name] = true;
	let s = old[name];
	if (s) {
		if (uci.get('xraypanel', s, 'link') != l) {
			uci.set('xraypanel', s, 'link', l);
			updated++;
		}
		delete old[name];
	}
	else {
		s = node_name();
		uci.set('xraypanel', s, 'node');
		uci.set('xraypanel', s, 'label', name);
		uci.set('xraypanel', s, 'link', l);
		uci.set('xraypanel', s, 'enabled', '1');
		uci.set('xraypanel', s, 'sub', sid);
		added++;
	}
}

for (let name, s in old) {
	if (pinned[s]) { kept++; continue; }
	uci.delete('xraypanel', s);
	removed++;
}

uci.set('xraypanel', sid, 'updated', `${time()}`);
uci.set('xraypanel', sid, 'count', `${length(links)}`);
uci.commit('xraypanel');

let msg = sprintf('%s: %d servers (%d new, %d changed, %d removed)', subname, length(links), added, updated, removed);
if (kept) msg += sprintf(', %d kept because the settings or a rule use them', kept);
out('OK: ' + msg);
