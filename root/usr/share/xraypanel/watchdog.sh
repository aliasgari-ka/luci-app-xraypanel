#!/bin/sh
# Fail-open guard, run every minute: LAN goes through Xray only while the proxy answers.

. /usr/share/xraypanel/common.sh

FW=$XP_DIR/firewall.sh
mkdir -p "$XP_RUN"

exec 9>"$XP_RUN/lock"
flock -n 9 || exit 0

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
	# Also re-applies the rules if something (for example a firewall restart) removed them.
	if [ ! -f "$XP_RUN/active" ] || ! $FW check; then
		$FW start
	fi
else
	fails=$(( $(cat "$XP_RUN/fails" 2>/dev/null || echo 0) + 1 ))
	echo "$fails" > "$XP_RUN/fails"
	if [ "$fails" -ge 3 ] && [ -f "$XP_RUN/active" ]; then
		logger -t xraypanel "proxy did not answer $fails times in a row; LAN stays direct until it recovers"
		$FW stop
	fi
fi
