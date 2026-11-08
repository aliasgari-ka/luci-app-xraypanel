#!/bin/sh
# Turns the LAN redirect and the dnsmasq hand-off on or off.

. /lib/functions.sh

RUN=/var/run/xraypanel
TABLE=xraypanel

dnsmasq_confdir() {
	local d
	d=$(sed -n 's/^conf-dir=\([^,]*\).*/\1/p' /var/etc/dnsmasq.conf.* 2>/dev/null | head -n1)
	echo "${d:-/tmp/dnsmasq.d}"
}

IFACES=""
SRCS=""
add_iface() { IFACES="${IFACES:+$IFACES, }\"$1\""; }
add_src() { SRCS="${SRCS:+$SRCS, }$1"; }

start() {
	local quic dns

	config_load xraypanel
	config_list_foreach main lan_ifaces add_iface
	config_list_foreach main bypass_src add_src
	config_get_bool quic main block_quic 1
	config_get_bool dns main dns_enabled 1
	[ -n "$IFACES" ] || IFACES='"br-lan"'

	local src_elems="" quic_rule=""
	[ -n "$SRCS" ] && src_elems="elements = { $SRCS }"
	[ "$quic" = 1 ] && quic_rule='iifname @lan_if ip saddr != @bypass_src ip daddr != @bypass_dst udp dport 443 reject'

	nft -f - <<EOF || return 1
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
		meta l4proto tcp redirect to :12345
	}
	chain forward {
		type filter hook forward priority filter - 5; policy accept;
		$quic_rule
	}
}
EOF

	if [ "$dns" = 1 ]; then
		local d
		d=$(dnsmasq_confdir)
		mkdir -p "$d"
		printf 'server=127.0.0.1#5353\nno-resolv\n' > "$d/xraypanel.conf"
		/etc/init.d/dnsmasq restart >/dev/null 2>&1
	fi

	mkdir -p "$RUN"
	touch "$RUN/active"
	logger -t xraypanel "LAN traffic now goes through Xray"
}

stop() {
	local d
	nft delete table ip $TABLE 2>/dev/null
	d=$(dnsmasq_confdir)
	if [ -f "$d/xraypanel.conf" ]; then
		rm -f "$d/xraypanel.conf"
		/etc/init.d/dnsmasq restart >/dev/null 2>&1
	fi
	if [ -f "$RUN/active" ]; then
		rm -f "$RUN/active"
		logger -t xraypanel "LAN traffic is direct again"
	fi
}

case "$1" in
	start) start ;;
	stop) stop ;;
	*) echo "usage: $0 start|stop" >&2; exit 1 ;;
esac
