#!/bin/sh
# Fail-open guard, run every minute: LAN goes through Xray only while the proxy answers.

. /usr/share/xraypanel/common.sh

FW=$XP_DIR/firewall.sh
mkdir -p "$XP_RUN"

exec 9>"$XP_RUN/lock"
flock -n 9 || exit 0

# VMess and REALITY servers refuse clients whose clock is off by about 2 minutes. Where NTP (UDP 123)
# gets no answer the clock drifts, so after a failed probe it is set from a plain HTTP Date header
# (sent directly, not through Xray). Only a clear gap is fixed, so normal NTP keeps control.
fix_clock() {
	local u d t now gap
	for u in http://1.1.1.1/ http://8.8.8.8/; do
		d=$(curl -sI -m 5 "$u" 2>/dev/null | sed -n 's/^[Dd]ate: [A-Za-z]*, *//p' | tr -d '\r')
		[ -n "$d" ] && break
	done
	[ -n "$d" ] || return 0
	t=$(date -u -D '%d %b %Y %H:%M:%S' -d "${d% GMT}" +%s 2>/dev/null) || return 0
	now=$(date +%s)
	gap=$((t - now))
	[ "${gap#-}" -ge 30 ] || return 0
	date -u -s "@$t" >/dev/null 2>&1 || return 0
	logger -t xraypanel "router clock was ${gap}s off (no NTP answer); set from HTTP time"
}

if ! xp_enabled || ! xp_running; then
	[ -f "$XP_RUN/active" ] && $FW stop
	exit 0
fi

url=$(uci -q get xraypanel.main.probe_url)
res=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 10 \
	--socks5-hostname 127.0.0.1:$XP_PORT_SOCKS "${url:-$XP_PROBE_DEFAULT}")
code=${res%% *}

# Any HTTP answer from 200 to 399 means the proxy works (some probe URLs redirect).
if [ "${code:-0}" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ]; then
	echo 0 > "$XP_RUN/fails"
	echo "${res#* }" > "$XP_RUN/latency"
	date +%s > "$XP_RUN/last_ok"
	# The probe can take 10 s; Xray may have been turned off or stopped meanwhile. The init
	# script waits for this lock before it removes the redirect, so this check is final.
	if ! xp_enabled || ! xp_running; then
		[ -f "$XP_RUN/active" ] && $FW stop
		exit 0
	fi
	# Also re-applies the rules if something (for example a firewall restart) removed them.
	if [ ! -f "$XP_RUN/active" ] || ! $FW check; then
		$FW start
	fi
else
	fix_clock
	fails=$(( $(cat "$XP_RUN/fails" 2>/dev/null || echo 0) + 1 ))
	echo "$fails" > "$XP_RUN/fails"
	if [ "$fails" -ge 3 ] && [ -f "$XP_RUN/active" ]; then
		logger -t xraypanel "proxy did not answer $fails times in a row; LAN stays direct until it recovers"
		$FW stop
	fi
fi
