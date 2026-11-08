#!/bin/sh
# Downloads geoip/geosite, checks them against the current config, then swaps them in.

ASSET=/usr/share/xraypanel/geo
TMP=/tmp/xraypanel-geo
CONF=/var/etc/xraypanel/config.json

fetch() {
	curl -fsSL --max-time 180 --socks5-hostname 127.0.0.1:10808 -o "$2" "$1" 2>/dev/null ||
	curl -fsSL --max-time 180 -o "$2" "$1"
}

fail() {
	logger -t xraypanel "geo update failed: $1"
	echo "ERROR: $1"
	rm -rf "$TMP"
	exit 1
}

rm -rf "$TMP"
mkdir -p "$TMP" "$ASSET"

for kind in geoip geosite; do
	url=$(uci -q get "xraypanel.main.${kind}_url")
	[ -n "$url" ] || fail "no URL set for $kind"
	fetch "$url" "$TMP/$kind.dat" || fail "could not download $kind"
	[ "$(wc -c < "$TMP/$kind.dat")" -gt 1000 ] || fail "$kind file is too small"
done

if [ -f "$CONF" ]; then
	XRAY_LOCATION_ASSET="$TMP" /usr/bin/xray run -test -c "$CONF" >/dev/null 2>&1 ||
		fail "new files do not work with the current rules"
fi

if cmp -s "$TMP/geoip.dat" "$ASSET/geoip.dat" && cmp -s "$TMP/geosite.dat" "$ASSET/geosite.dat"; then
	date +%s > "$ASSET/updated"
	rm -rf "$TMP"
	echo "OK: geo files are already current"
	exit 0
fi

mv "$TMP/geoip.dat" "$ASSET/geoip.dat"
mv "$TMP/geosite.dat" "$ASSET/geosite.dat"
date +%s > "$ASSET/updated"
rm -rf "$TMP"
logger -t xraypanel "geo files updated"

pidof xray >/dev/null && /etc/init.d/xraypanel restart
echo "OK: geo files updated"
