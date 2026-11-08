#!/bin/sh
# Downloads geoip/geosite, checks them against the current config, then swaps them in.

. /usr/share/xraypanel/common.sh

mkdir -p "$XP_RUN" "$XP_ASSET"
exec 8>"$XP_RUN/geo.lock"
flock -n 8 || { echo "ERROR: a geo update is already running"; exit 1; }

TMP=$(mktemp -d /tmp/xraypanel-geo.XXXXXX) || { echo "ERROR: cannot create a temp folder"; exit 1; }
trap 'rm -rf "$TMP"' EXIT

fetch() {
	curl -fsSL --max-time 120 --socks5-hostname 127.0.0.1:$XP_PORT_SOCKS -o "$2" "$1" 2>/dev/null ||
	curl -fsSL --max-time 120 -o "$2" "$1"
}

fail() {
	logger -t xraypanel "geo update failed: $1"
	echo "ERROR: $1"
	exit 1
}

for kind in geoip geosite; do
	url=$(uci -q get "xraypanel.main.${kind}_url")
	[ -n "$url" ] || fail "no URL set for $kind"
	fetch "$url" "$TMP/$kind.dat" || fail "could not download $kind"
	[ "$(wc -c < "$TMP/$kind.dat")" -gt 1000 ] || fail "$kind file is too small"
	# Verify against the published checksum when the source has one.
	if fetch "$url.sha256sum" "$TMP/$kind.sum" 2>/dev/null; then
		want=$(cut -d' ' -f1 < "$TMP/$kind.sum")
		have=$(sha256sum "$TMP/$kind.dat" | cut -d' ' -f1)
		[ "$want" = "$have" ] || fail "$kind file does not match its published checksum"
	fi
done

if [ -f "$XP_CONF" ]; then
	XRAY_LOCATION_ASSET="$TMP" /usr/bin/xray run -test -c "$XP_CONF" >/dev/null 2>&1 ||
		fail "new files do not work with the current rules"
fi

if cmp -s "$TMP/geoip.dat" "$XP_ASSET/geoip.dat" && cmp -s "$TMP/geosite.dat" "$XP_ASSET/geosite.dat"; then
	date +%s > "$XP_ASSET/updated"
	echo "OK: geo files are already current"
	exit 0
fi

cp "$TMP/geoip.dat" "$XP_ASSET/geoip.dat.new" && cp "$TMP/geosite.dat" "$XP_ASSET/geosite.dat.new" ||
	fail "not enough space to store the new files"
mv "$XP_ASSET/geoip.dat.new" "$XP_ASSET/geoip.dat"
mv "$XP_ASSET/geosite.dat.new" "$XP_ASSET/geosite.dat"
date +%s > "$XP_ASSET/updated"
logger -t xraypanel "geo files updated"

# Restart also covers the first install, when Xray could not start without geo files.
xp_enabled && /etc/init.d/xraypanel restart
echo "OK: geo files updated"
