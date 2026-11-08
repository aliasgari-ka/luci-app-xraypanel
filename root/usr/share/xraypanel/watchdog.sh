#!/bin/sh
# Fail-open guard, run every minute: LAN goes through Xray only while the proxy answers.

RUN=/var/run/xraypanel
FW=/usr/share/xraypanel/firewall.sh
mkdir -p "$RUN"

exec 9>"$RUN/lock"
flock -n 9 || exit 0

if [ "$(uci -q get xraypanel.main.enabled)" != 1 ] || ! pidof xray >/dev/null; then
	[ -f "$RUN/active" ] && $FW stop
	exit 0
fi

url=$(uci -q get xraypanel.main.probe_url)
res=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 10 \
	--socks5-hostname 127.0.0.1:10808 "${url:-https://www.gstatic.com/generate_204}")
code=${res%% *}

if [ "$code" = 204 ] || [ "$code" = 200 ]; then
	echo 0 > "$RUN/fails"
	echo "${res#* }" > "$RUN/latency"
	date +%s > "$RUN/last_ok"
	[ -f "$RUN/active" ] || $FW start
else
	fails=$(( $(cat "$RUN/fails" 2>/dev/null || echo 0) + 1 ))
	echo "$fails" > "$RUN/fails"
	if [ "$fails" -ge 3 ] && [ -f "$RUN/active" ]; then
		logger -t xraypanel "proxy did not answer $fails times in a row; LAN stays direct until it recovers"
		$FW stop
	fi
fi
