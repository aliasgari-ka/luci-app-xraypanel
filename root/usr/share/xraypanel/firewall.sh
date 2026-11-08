#!/bin/sh
# Turns the LAN redirect and the dnsmasq hand-off on or off.
#   start | stop    LAN redirect + DNS hand-off (switched by the watchdog)
#   guard | unguard blocks direct connections to Xray's redirect port (while Xray runs)
#   check           exits 0 if the redirect table is loaded

. /lib/functions.sh
. /lib/functions/network.sh
. /usr/share/xraypanel/common.sh

TABLE=xraypanel
GUARD=xraypanel_guard

# Every dnsmasq instance has its own conf-dir.
dnsmasq_confdirs() {
	local d
	d=$(sed -n 's/^conf-dir=\([^,]*\).*/\1/p' /var/etc/dnsmasq.conf.* 2>/dev/null | sort -u)
	echo "${d:-/tmp/dnsmasq.d}"
}

note() {
	echo "$1" >> "$XP_RUN/fw_warn"
	logger -t xraypanel "$1"
}

IFACES=""
SRCS=""
# Accepts a device (br-lan) or a network name (lan), which is turned into its device.
add_iface() {
	local dev="$1"
	case "$dev" in
		''|*[!A-Za-z0-9._@-]*) note "Interface \"$1\" has an invalid name and was ignored"; return ;;
	esac
	if [ ! -e "/sys/class/net/$dev" ]; then
		network_get_device dev "$1" || network_get_physdev dev "$1"
		if [ -z "$dev" ] || [ ! -e "/sys/class/net/$dev" ]; then
			note "Interface \"$1\" does not exist on this router and was ignored"
			return
		fi
	fi
	case ", $IFACES," in *", \"$dev\","*) return ;; esac
	IFACES="${IFACES:+$IFACES, }\"$dev\""
}
add_src() {
	if echo "$1" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$'; then
		SRCS="${SRCS:+$SRCS, }$1"
	else
		note "Direct device \"$1\" is not an IPv4 address or range and was ignored"
	fi
}

dns_handoff() {
	local d changed=0
	for d in $(dnsmasq_confdirs); do
		if [ "$1" = on ]; then
			mkdir -p "$d"
			printf 'server=127.0.0.1#%s\nno-resolv\n' "$XP_PORT_DNS" > "$d/xraypanel.conf.new"
			if cmp -s "$d/xraypanel.conf.new" "$d/xraypanel.conf"; then
				rm -f "$d/xraypanel.conf.new"
			else
				mv "$d/xraypanel.conf.new" "$d/xraypanel.conf"
				changed=1
			fi
		elif [ -f "$d/xraypanel.conf" ]; then
			rm -f "$d/xraypanel.conf"
			changed=1
		fi
	done
	[ "$changed" = 1 ] && /etc/init.d/dnsmasq restart >/dev/null 2>&1
	return 0
}

start() {
	local quic dns out

	mkdir -p "$XP_RUN"
	rm -f "$XP_RUN/fw_warn"
	config_load xraypanel
	config_list_foreach main lan_ifaces add_iface
	config_list_foreach main bypass_src add_src
	config_get_bool quic main block_quic 1
	config_get_bool dns main dns_enabled 1
	[ -n "$IFACES" ] || IFACES='"br-lan"'

	local src_elems="" quic_rule=""
	[ -n "$SRCS" ] && src_elems="elements = { $SRCS }"
	[ "$quic" = 1 ] && quic_rule='iifname @lan_if ip saddr != @bypass_src ip daddr != @bypass_dst udp dport 443 reject'

	if ! out=$(nft -f - 2>&1 <<EOF
table ip $TABLE
delete table ip $TABLE
table ip $TABLE {
	set lan_if {
		type ifname
		elements = { $IFACES }
	}
	set bypass_src {
		type ipv4_addr
		flags interval
		auto-merge
		$src_elems
	}
	set bypass_dst {
		type ipv4_addr
		flags interval
		auto-merge
		elements = { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16,
			     172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16, 198.18.0.0/15,
			     224.0.0.0/4, 240.0.0.0/4 }
	}
	chain prerouting {
		type nat hook prerouting priority dstnat - 5; policy accept;
		iifname != @lan_if return
		ip saddr @bypass_src return
		ip daddr @bypass_dst return
		meta l4proto tcp redirect to :$XP_PORT_REDIR
	}
	chain forward {
		type filter hook forward priority filter - 5; policy accept;
		$quic_rule
	}
}
EOF
	); then
		echo "Could not load the firewall rules, LAN stays direct: $out" > "$XP_RUN/fw_error"
		logger -t xraypanel "nft failed: $out"
		return 1
	fi
	rm -f "$XP_RUN/fw_error"

	if [ "$dns" = 1 ]; then dns_handoff on; else dns_handoff off; fi

	if [ ! -f "$XP_RUN/active" ]; then
		touch "$XP_RUN/active"
		logger -t xraypanel "LAN traffic now goes through Xray"
	fi
}

stop() {
	nft delete table ip $TABLE 2>/dev/null
	dns_handoff off
	if [ -f "$XP_RUN/active" ]; then
		rm -f "$XP_RUN/active"
		logger -t xraypanel "LAN traffic is direct again"
	fi
}

# Only redirected connections may reach the redirect port; a direct one would make Xray dial itself.
guard() {
	# inet, because Xray listens on IPv6 too (:::port).
	nft delete table ip $GUARD 2>/dev/null
	nft -f - <<EOF
table inet $GUARD
delete table inet $GUARD
table inet $GUARD {
	chain input {
		type filter hook input priority filter - 5; policy accept;
		tcp dport $XP_PORT_REDIR ct status dnat accept
		tcp dport $XP_PORT_REDIR drop
	}
}
EOF
}

unguard() {
	nft delete table inet $GUARD 2>/dev/null
	nft delete table ip $GUARD 2>/dev/null
	return 0
}

case "$1" in
	start) start ;;
	stop) stop ;;
	guard) guard ;;
	unguard) unguard ;;
	check) nft list table ip $TABLE >/dev/null 2>&1 ;;
	*) echo "usage: $0 start|stop|guard|unguard|check" >&2; exit 1 ;;
esac
