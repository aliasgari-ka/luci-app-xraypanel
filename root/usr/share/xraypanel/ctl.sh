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
	*)
		echo "ERROR: unknown action"
		;;
esac
exit 0
