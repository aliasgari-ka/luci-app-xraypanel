#!/bin/sh
# Turns the LAN redirect (TCP and DNS) on or off.
#   start | stop    LAN redirect (switched by the watchdog)
#   guard | unguard blocks direct connections to Xray's redirect port (while Xray runs)
#   check           exits 0 if the redirect table is loaded

. /lib/functions.sh
. /lib/functions/network.sh
. /usr/share/xraypanel/common.sh

TABLE=xraypanel
GUARD=xraypanel_guard

# Every dnsmasq instance has its own conf-dir. Older versions handed all of dnsmasq's DNS to Xray there.
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
IFACES_SET=0
SRCS=""
# Accepts a device (br-lan) or a network name (lan), which is turned into its device.
# nft matches devices by name, so one that is not there yet (a Wi-Fi still starting) is kept.
add_iface() {
	local dev="$1"
	IFACES_SET=1
	case "$dev" in
		''|*[!A-Za-z0-9._@-]*) note "Interface \"$1\" has an invalid name and was ignored"; return ;;
	esac
	if [ ! -e "/sys/class/net/$dev" ]; then
		network_get_device dev "$1" || network_get_physdev dev "$1"
		if [ -z "$dev" ]; then
			dev="$1"
			note "Interface \"$1\" does not exist right now; it is routed once it appears"
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

# Removes the hand-off file of older versions; DNS is now redirected by nft for routed interfaces only.
dns_cleanup() {
	local d changed=0
	for d in $(dnsmasq_confdirs); do
		if [ -f "$d/xraypanel.conf" ]; then
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
	# br-lan only when no interface is chosen at all, not when the chosen ones are missing.
	[ "$IFACES_SET" = 1 ] || IFACES='"br-lan"'

	local if_elems="" src_elems="" quic_rule="" dns_rule=""
	[ -n "$IFACES" ] && if_elems="elements = { $IFACES }"
	[ -n "$SRCS" ] && src_elems="elements = { $SRCS }"
	[ "$quic" = 1 ] && quic_rule='iifname @lan_if ip saddr != @bypass_src ip daddr != @bypass_dst udp dport 443 reject'
	# Any DNS server a client asks (the router or a hard-coded one) is answered by Xray.
	[ "$dns" = 1 ] && dns_rule="meta l4proto { tcp, udp } th dport 53 redirect to :$XP_PORT_DNS"

	if ! out=$(nft -f - 2>&1 <<EOF
table ip $TABLE
delete table ip $TABLE
table ip $TABLE {
	set lan_if {
		type ifname
		$if_elems
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
		$dns_rule
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

	# DNS over IPv6 to the router (it advertises itself as a resolver); bypass_src is IPv4 only.
	nft delete table ip6 $TABLE 2>/dev/null
	if [ "$dns" = 1 ] && ! out=$(nft -f - 2>&1 <<EOF
table ip6 $TABLE {
	set lan_if {
		type ifname
		$if_elems
	}
	chain prerouting {
		type nat hook prerouting priority dstnat - 5; policy accept;
		iifname != @lan_if return
		$dns_rule
	}
}
EOF
	); then
		note "DNS over IPv6 is not sent through Xray: $out"
	fi
	dns_cleanup

	if [ ! -f "$XP_RUN/active" ]; then
		touch "$XP_RUN/active"
		logger -t xraypanel "LAN traffic now goes through Xray"
	fi
}

stop() {
	nft delete table ip $TABLE 2>/dev/null
	nft delete table ip6 $TABLE 2>/dev/null
	dns_cleanup
	if [ -f "$XP_RUN/active" ]; then
		rm -f "$XP_RUN/active"
		logger -t xraypanel "LAN traffic is direct again"
	fi
}

# Only redirected connections may reach the redirect port; a direct one would make Xray dial itself.
# The DNS port listens on every address too, so only redirected (or local) queries may reach it.
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
		meta l4proto { tcp, udp } th dport $XP_PORT_DNS ct status dnat accept
		meta l4proto { tcp, udp } th dport $XP_PORT_DNS iif lo accept
		meta l4proto { tcp, udp } th dport $XP_PORT_DNS drop
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
