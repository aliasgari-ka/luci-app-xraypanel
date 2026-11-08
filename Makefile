include $(TOPDIR)/rules.mk

LUCI_TITLE:=Lightweight Xray panel with load balancing and fail-open routing
LUCI_DEPENDS:=+xray-core +curl +ucode +ucode-mod-uci +ucode-mod-fs
LUCI_PKGARCH:=all

PKG_LICENSE:=MIT
PKG_MAINTAINER:=aliasgari-ka

define Package/luci-app-xraypanel/conffiles
/etc/config/xraypanel
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
