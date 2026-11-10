#!/bin/sh
# Downloads geoip/geosite (and the optional extra geosite with more categories), checks them
# against the current config, then swaps them in.

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

KINDS="geoip geosite"
extra_url=$(uci -q get xraypanel.main.geosite_extra_url)
if [ -n "$extra_url" ]; then
	KINDS="$KINDS geosite_extra"
elif [ -f "$XP_ASSET/geosite_extra.dat" ]; then
	# Turned off: the current config may still point at it, so test with it and remove it after.
	cp "$XP_ASSET/geosite_extra.dat" "$TMP/geosite_extra.dat"
fi

for kind in $KINDS; do
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

changed=0
for kind in $KINDS; do
	cmp -s "$TMP/$kind.dat" "$XP_ASSET/$kind.dat" || changed=1
done
[ -z "$extra_url" ] && [ -f "$XP_ASSET/geosite_extra.dat" ] && changed=1

if [ "$changed" = 0 ]; then
	date +%s > "$XP_ASSET/updated"
	echo "OK: geo files are already current"
	exit 0
fi

for kind in $KINDS; do
	cp "$TMP/$kind.dat" "$XP_ASSET/$kind.dat.new" || {
		rm -f "$XP_ASSET"/*.dat.new
		fail "not enough space to store the new files"
	}
done
for kind in $KINDS; do
	mv "$XP_ASSET/$kind.dat.new" "$XP_ASSET/$kind.dat"
done
[ -z "$extra_url" ] && rm -f "$XP_ASSET/geosite_extra.dat"
date +%s > "$XP_ASSET/updated"
logger -t xraypanel "geo files updated"

# Restart also covers the first install, when Xray could not start without geo files, and
# regenerates the config so rules use (or stop using) the extra categories. A service that was
# stopped or disabled by hand stays stopped.
if xp_enabled && { xp_running || { [ ! -f "$XP_CONF" ] && /etc/init.d/xraypanel enabled; }; }; then
	/etc/init.d/xraypanel restart
fi
echo "OK: geo files updated"
