#!/bin/sh

case "$1" in
	restart)
		/etc/init.d/xraypanel restart
		sleep 2
		if [ "$(uci -q get xraypanel.main.enabled)" = 1 ] && ! pidof xray >/dev/null; then
			echo "ERROR: $(cat /var/run/xraypanel/error 2>/dev/null || echo 'Xray did not start')"
		else
			echo "OK: restarted"
		fi
		;;
	geo)
		/usr/share/xraypanel/geoupdate.sh
		;;
	*)
		echo "ERROR: unknown action"
		;;
esac
exit 0
