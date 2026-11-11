#!/bin/sh
# Emits a JSON array of LAN devices for the Xray panel "Devices" page.
# Each device: {ip, mac, host, iface, online, proxied, bypassed}
#   proxied  = its interface is in xraypanel.main.lan_ifaces (goes through Xray by default)
#   bypassed = its IP is listed in xraypanel.main.bypass_src (forced direct)
# busybox/ash only, no bashisms, kept light (router is low on RAM).

. /lib/functions.sh

LANIFS=""
BYPASS=""
add_if()  { LANIFS="$LANIFS $1"; }
add_bp()  { BYPASS="$BYPASS $1"; }

config_load xraypanel
config_list_foreach main lan_ifaces add_if
config_list_foreach main bypass_src add_bp
[ -n "$LANIFS" ] || LANIFS=" br-lan"

LEASES=/tmp/dhcp.leases

in_list() { # $1 item, $2 space-list
	case " $2 " in *" $1 "*) return 0 ;; esac
	return 1
}
jesc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

lease_host() { awk -v ip="$1" '$3==ip && $4!="*" {print $4; exit}' "$LEASES" 2>/dev/null; }
lease_mac()  { awk -v ip="$1" '$3==ip {print $2; exit}' "$LEASES" 2>/dev/null; }

SEEN=""
SEP=""

emit() { # ip mac host iface online
	ip="$1"; mac="$2"; host="$3"; iface="$4"; online="$5"
	proxied=false; bypassed=false
	in_list "$iface" "$LANIFS" && proxied=true
	in_list "$ip" "$BYPASS" && bypassed=true
	[ -n "$SEP" ] && printf ','
	SEP=1
	printf '{"ip":"%s","mac":"%s","host":"%s","iface":"%s","online":%s,"proxied":%s,"bypassed":%s}' \
		"$(jesc "$ip")" "$(jesc "$mac")" "$(jesc "$host")" "$(jesc "$iface")" "$online" "$proxied" "$bypassed"
}

NEIGH=$(ip -4 neigh show 2>/dev/null)

printf '['

# Devices currently present (neighbour table has the interface for each).
while read -r ip _dev dev _ll mac _rest; do
	[ -n "$ip" ] || continue
	[ "$_dev" = dev ] || continue
	[ "$_ll" = lladdr ] || continue   # skip FAILED/INCOMPLETE entries (no MAC)
	case "$ip" in 169.254.*) continue ;; esac
	# Only LAN-side devices: a routed interface, any bridge, or an explicit bypass.
	keep=0
	in_list "$dev" "$LANIFS" && keep=1
	case "$dev" in br-*) keep=1 ;; esac
	in_list "$ip" "$BYPASS" && keep=1
	[ "$keep" = 1 ] || continue
	h=$(lease_host "$ip")
	emit "$ip" "$mac" "$h" "$dev" true
	SEEN="$SEEN $ip"
done <<EOF
$NEIGH
EOF

# Bypassed IPs that are offline right now: still show them so they can be removed.
for ip in $BYPASS; do
	in_list "$ip" "$SEEN" && continue
	case "$ip" in */*) continue ;; esac   # skip ranges, only plain hosts get a row
	emit "$ip" "$(lease_mac "$ip")" "$(lease_host "$ip")" "" false
done

printf ']'
