# Shared paths and ports for the xraypanel shell scripts. Ports must match gen.uc.

XP_DIR=/usr/share/xraypanel
XP_RUN=/var/run/xraypanel
XP_ETC=/var/etc/xraypanel
XP_CONF=$XP_ETC/config.json
XP_ASSET=$XP_DIR/geo

XP_PORT_REDIR=12345
XP_PORT_SOCKS=10808
XP_PORT_DNS=10853

XP_PROBE_DEFAULT=https://www.gstatic.com/generate_204

# True while procd runs this package's Xray instance (other xray processes don't count).
xp_running() {
	ubus call service list '{"name":"xraypanel"}' 2>/dev/null | grep -q '"running": true'
}

xp_enabled() {
	[ "$(uci -q get xraypanel.main.enabled)" = 1 ]
}
