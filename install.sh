#!/bin/sh
# Installs luci-app-xraypanel on an OpenWrt router. Run it on the router as root.
set -e

REPO="aliasgari-ka/luci-app-xraypanel"
REF="${1:-main}"
TMP=/tmp/xraypanel-install
DEPS="xray-core curl ucode ucode-mod-uci ucode-mod-fs"

echo "Installing dependencies: $DEPS"
if command -v apk >/dev/null 2>&1; then
	apk update >/dev/null 2>&1 || true
	apk add $DEPS
else
	opkg update
	opkg install $DEPS
fi

echo "Downloading $REPO ($REF)"
rm -rf "$TMP"
mkdir -p "$TMP"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP"
SRC=$(ls -d "$TMP"/*/ | head -n1)

[ -f /etc/config/xraypanel ] && rm -f "$SRC/root/etc/config/xraypanel"
cp -r "$SRC/htdocs/." /www/
cp -r "$SRC/root/." /
chmod 755 /etc/init.d/xraypanel /usr/share/xraypanel/*.sh
rm -rf "$TMP"

echo "Downloading geo files"
/usr/share/xraypanel/geoupdate.sh || echo "Geo download failed. Use 'Update geo files now' in the panel later."

/etc/init.d/xraypanel enable
/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache

echo
echo "Done. Open LuCI -> Services -> Xray, add your servers and turn on 'Enable Xray'."
