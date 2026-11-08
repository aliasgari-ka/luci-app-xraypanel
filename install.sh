#!/bin/sh
# Installs luci-app-xraypanel on an OpenWrt router. Run it on the router as root.
#   sh install.sh [REF]   REF is a tag or commit to install (default: main).
#                         Pin a commit you have reviewed, e.g. sh install.sh 1a2b3c4
set -e

REPO="aliasgari-ka/luci-app-xraypanel"
REF="${1:-main}"
DEPS="xray-core curl ucode ucode-mod-uci ucode-mod-fs"

command -v nft >/dev/null 2>&1 || { echo "This needs firewall4 (nftables). OpenWrt 23.05 or newer has it."; exit 1; }

echo "Installing dependencies: $DEPS"
if command -v apk >/dev/null 2>&1; then
	apk update >/dev/null 2>&1 || true
	apk add $DEPS
else
	opkg update
	opkg install $DEPS
fi

TMP=$(mktemp -d /tmp/xraypanel-install.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $REPO ($REF)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP/src.tar.gz"
echo "SHA-256 of the downloaded source: $(sha256sum "$TMP/src.tar.gz" | cut -d' ' -f1)"
tar -xzf "$TMP/src.tar.gz" -C "$TMP"
SRC=$(ls -d "$TMP"/*/ | head -n1)
[ -f "$SRC/root/etc/init.d/xraypanel" ] || { echo "The download does not look like luci-app-xraypanel."; exit 1; }

[ -f /etc/config/xraypanel ] && rm -f "$SRC/root/etc/config/xraypanel"
cp -r "$SRC/htdocs/." /www/
cp -r "$SRC/root/." /
chmod 755 /etc/init.d/xraypanel /usr/share/xraypanel/*.sh

echo "Downloading geo files"
/usr/share/xraypanel/geoupdate.sh || echo "Geo download failed. Press 'Update geo files' on the panel's Status page later."

/etc/init.d/xraypanel enable
/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache

echo
echo "Done. Open LuCI -> Services -> Xray, add your servers and turn on 'Enable Xray'."
