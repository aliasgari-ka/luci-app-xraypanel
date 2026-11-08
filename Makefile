include $(TOPDIR)/rules.mk

LUCI_TITLE:=Lightweight Xray panel with load balancing and fail-open routing
# firewall4 brings nftables; dnsmasq is not listed because it may be dnsmasq or dnsmasq-full.
LUCI_DEPENDS:=+xray-core +curl +ucode +ucode-mod-uci +ucode-mod-fs +firewall4 +kmod-nft-nat
LUCI_PKGARCH:=all

PKG_LICENSE:=MIT
PKG_MAINTAINER:=aliasgari-ka

define Package/luci-app-xraypanel/conffiles
/etc/config/xraypanel
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
