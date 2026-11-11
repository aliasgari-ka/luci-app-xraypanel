#!/bin/sh
# Actions behind the panel's buttons. Always prints one OK:/ERROR: line.

. /usr/share/xraypanel/common.sh

case "$1" in
	restart)
		if ! xp_enabled; then
			echo 'ERROR: Xray is turned off. Turn on "Enable Xray" on the Servers page first.'
			exit 0
		fi
		/etc/init.d/xraypanel restart
		sleep 2
		if xp_running; then
			echo "OK: restarted"
		else
			echo "ERROR: $(cat "$XP_RUN/error" 2>/dev/null || echo 'Xray did not start')"
		fi
		;;
	geo)
		# Downloads can take minutes on a slow link, longer than the browser waits.
		mkdir -p "$XP_RUN"
		echo "Updating geo files..." > "$XP_RUN/geo_result"
		( $XP_DIR/geoupdate.sh > "$XP_RUN/geo_result.new" 2>&1
		  mv "$XP_RUN/geo_result.new" "$XP_RUN/geo_result" ) </dev/null >/dev/null 2>&1 &
		echo "OK: geo update started. The result shows on the Status page."
		;;
	test)
		/usr/bin/ucode $XP_DIR/test.uc
		;;
	bypass)
		# Remaining args are the IPs that should stay direct (the "bypass" list).
		# Persists to uci and syncs the live nftables set in place, without
		# rebuilding the table or restarting Xray/dnsmasq (no service blip).
		shift
		is_ip() { echo "$1" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$'; }
		uci -q delete xraypanel.main.bypass_src 2>/dev/null
		n=0
		for ip in "$@"; do
			is_ip "$ip" || continue
			uci add_list xraypanel.main.bypass_src="$ip"
			n=$((n+1))
		done
		uci commit xraypanel
		if nft list set ip xraypanel bypass_src >/dev/null 2>&1; then
			# One nft transaction: flush and refill apply together, so a direct device is
			# never briefly redirected to Xray. If the batch fails nothing changes.
			els=""
			for ip in "$@"; do
				is_ip "$ip" && els="$els${els:+, }$ip"
			done
			if { echo "flush set ip xraypanel bypass_src"
			     [ -n "$els" ] && echo "add element ip xraypanel bypass_src { $els }"
			   } | nft -f - 2>/dev/null; then
				echo "OK: $n device(s) set to direct"
			else
				echo "ERROR: saved, but the live list could not be updated. Press Restart on the Status page."
			fi
		else
			echo "OK: $n device(s) saved (will apply when Xray routing is active)"
		fi
		;;
	sub)
		# Updates every enabled subscription. Writes servers to uci only;
		# Xray is not restarted, new servers are used after the next Save & Apply.
		. /lib/functions.sh
		IDS=""
		add_sub() {
			local en
			config_get_bool en "$1" enabled 1
			[ "$en" = 1 ] && IDS="$IDS $1"
		}
		config_load xraypanel
		config_foreach add_sub subscription
		[ -n "$IDS" ] || { echo "ERROR: no enabled subscription. Add one and press Save & Apply first."; exit 0; }
		for id in $IDS; do
			case "$id" in *[!A-Za-z0-9_]*) continue ;; esac
			name=$(uci -q get "xraypanel.$id.label"); [ -n "$name" ] || name="$id"
			url=$(uci -q get "xraypanel.$id.url")
			case "$url" in http://*|https://*) ;; *) echo "ERROR: $name: no valid URL"; continue ;; esac
			f="/tmp/xraypanel-sub.$id"
			rm -f "$f"
			# Through Xray first (the address may be filtered), then directly.
			curl -fsSL --max-time 30 --max-filesize 2000000 -A 'v2rayN/7.0' \
				-x socks5h://127.0.0.1:$XP_PORT_SOCKS -o "$f" "$url" 2>/dev/null ||
			curl -fsSL --max-time 30 --max-filesize 2000000 -A 'v2rayN/7.0' -o "$f" "$url" 2>/dev/null ||
				{ rm -f "$f"; echo "ERROR: $name: download failed"; continue; }
			/usr/bin/ucode $XP_DIR/sub.uc "$id" "$f" 2>&1 | head -n 1
			rm -f "$f"
		done
		;;
	speed)
		# Downloads up to 10 MB through the route in use (counts against that server's traffic).
		xp_running || { echo "ERROR: Xray is not running"; exit 0; }
		# The body is piped away instead of written to /dev/null: on some builds /dev/null is a
		# plain file on a tiny /dev tmpfs, and curl stops with a write error after ~0.5 MB.
		set -- $(curl -s -w '\n%{http_code} %{speed_download} %{size_download} %{time_total}' \
			-x socks5h://127.0.0.1:$XP_PORT_SOCKS -m 15 'https://speed.cloudflare.com/__down?bytes=10000000' 2>&1 | tail -n 1)
		echo "${2:-0} ${3:-0} ${4:-0}" | awk '$2 > 100000 { printf "OK: download %.1f Mbit/s (%.1f MB in %.1f s)\n", $1 * 8 / 1000000, $2 / 1048576, $3; ok = 1 }
			END { exit !ok }' || echo "ERROR: speed test failed (HTTP ${1:-none})"
		;;
	*)
		echo "ERROR: unknown action"
		;;
esac
exit 0
