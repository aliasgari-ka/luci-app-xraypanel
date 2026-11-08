# luci-app-xraypanel

A small LuCI panel that runs [Xray](https://github.com/XTLS/Xray-core) on an OpenWrt router: several servers, load balancing, routing rules, automatic geo updates, and a watchdog that sends LAN traffic back to direct when the proxy stops answering.

It is built for routers with little memory. There is no extra daemon: the panel uses LuCI, `uci`, `ucode` and `cron`, which OpenWrt already has. With the lite geo files Xray uses about 23 MB of RAM.

[فارسی](#فارسی)

## Features

- **Several servers.** Paste `vmess://`, `vless://` (including REALITY), `trojan://` and `ss://` share links, several at once, or a full Xray outbound as JSON. Transports: tcp, ws, grpc, httpupgrade, xhttp, http, kcp.
- **Load balancing.** Lowest latency (Xray observatory), round robin or random. Or pin one server.
- **Routing like 3x-ui.** A *Basic* block with blocked/direct IP and domain lists, then an ordered table of full Xray rules: domain, IP, port, source IP and port (per device), network, protocol (sniffed), inbound and HTTP attributes. Each rule goes direct, through the proxy (balancer), to one chosen server, or is blocked. Entries use `geosite:`, `geoip:`, `domain:`, `full:`, `keyword:`, `regexp:`, `ext:`/`ext-ip:` and IP ranges. Iranian sites, banks and apps go direct by default. Domain entries are matched first; IP entries apply once no domain entry matched.
- **DNS through Xray.** Avoids poisoned answers. Iranian domains and your proxy servers' hostnames are resolved directly.
- **Automatic geo updates.** Daily or weekly through cron, downloaded through the proxy when possible. Files are checked against the published SHA-256 when the source has one, and tested against your rules before they replace the old ones.
- **Fail-open watchdog.** Every minute the router checks the proxy. LAN traffic only goes through Xray while it answers. After three failed checks, LAN goes back to direct until the proxy recovers.
- **Per-device and per-network bypass.** Choose which interfaces are routed (for example only `br-lan`, so a second "direct" Wi-Fi stays direct) and which IPs never go through Xray.
- **QUIC blocking** so apps fall back to TCP, which the redirect can carry.

## Requirements

- OpenWrt 23.05 or newer with `firewall4` (nftables). Works with both `apk` and `opkg`.
- Packages: `xray-core`, `curl`, `ucode`, `ucode-mod-uci`, `ucode-mod-fs`, `luci-base`.

Tested on a Xiaomi AX3000T (RD03v2, IPQ5018, 256 MB RAM) running an OpenWrt snapshot with `apk` and Xray 26.10.21.

## Install

On the router, as root:

```sh
curl -fsSL https://raw.githubusercontent.com/aliasgari-ka/luci-app-xraypanel/main/install.sh | sh
```

If the router has no `curl` yet, install it first (`apk add curl` or `opkg install curl`).

The script installs whatever is on `main` at that moment. To install a version you have reviewed, download the script and pass a commit or tag: `sh install.sh <commit>`. It prints the SHA-256 of the source it downloaded.

To build an installable package instead, put this folder under `package/` in an OpenWrt SDK that has the `luci` feed installed (`./scripts/feeds update luci && ./scripts/feeds install luci-base`) and run `make package/luci-app-xraypanel/compile`.

## Use

Open `http://192.168.1.1` (your router's LAN address), log in, then go to **Services → Xray**.

1. **Servers**: paste your links into *Add servers from links*, turn on *Enable Xray*, then **Save & Apply**.
2. **Routing**: pick direct/blocked lists under *Basic*, then add rules. Rules are checked from the top and the first match wins; inside one rule every filled field must match.
3. **Settings**: interfaces to route, devices that stay direct, DNS, geo update schedule.
4. **Status**: service state, whether LAN is going through Xray, proxy latency, memory use, log, and buttons to restart or update geo files.

If a change is wrong (a server Xray rejects, a typo in a rule), the panel skips the broken server or keeps the last working settings running and shows the error on the Status page. LuCI's own rollback only helps if you lose access to the router itself, not if the internet stops working.

## How it works

| File | Purpose |
|---|---|
| `/etc/config/xraypanel` | Settings, servers and rules (UCI) |
| `/usr/share/xraypanel/gen.uc` | Turns the UCI config and share links into Xray's JSON |
| `/etc/init.d/xraypanel` | procd service: generates and tests the config, starts Xray, sets up cron |
| `/usr/share/xraypanel/firewall.sh` | Adds or removes the nftables redirect table and the dnsmasq hand-off |
| `/usr/share/xraypanel/watchdog.sh` | Runs every minute; applies or removes the redirect based on a proxy check |
| `/usr/share/xraypanel/geoupdate.sh` | Downloads and tests geo files |
| `/usr/share/xraypanel/test.uc` | Tests every server through its own local port |
| `/usr/share/xraypanel/common.sh` | Paths and ports shared by the shell scripts |

TCP from LAN clients is redirected (`nft redirect`) to Xray's `dokodemo-door` inbound with sniffing. This works on kernels without the TPROXY module. Xray connects to the servers from the router itself, so its own traffic is never redirected. A small guard table drops connections to the redirect port that were not redirected, so a client cannot make Xray dial itself.

## Limits

- Only TCP is proxied. UDP (apart from DNS) goes direct, and UDP 443 is blocked so apps use TCP instead.
- IPv4 only.
- The lite geo files only contain `ir`, `category-ir`, `private` and `ads`. Switch to the full files in *Settings* if your rules need more categories. The full files use much more memory.

## Uninstall

```sh
uci set xraypanel.main.enabled=0; uci commit xraypanel
/etc/init.d/xraypanel stop; /etc/init.d/xraypanel disable
sed -i '/# xraypanel$/d' /etc/crontabs/root; /etc/init.d/cron restart
rm -rf /etc/init.d/xraypanel /etc/config/xraypanel /usr/share/xraypanel \
  /usr/share/luci/menu.d/luci-app-xraypanel.json /usr/share/rpcd/acl.d/luci-app-xraypanel.json \
  /www/luci-static/resources/view/xraypanel
/etc/init.d/rpcd restart
```

Geo data: [Chocolate4U/Iran-v2ray-rules](https://github.com/Chocolate4U/Iran-v2ray-rules).

---

## فارسی

پنل سبک LuCI برای اجرای Xray روی روتر OpenWrt: چند سرور، لودبالانس، قوانین روتینگ، آپدیت خودکار geo، و watchdog که اگر پروکسی جواب ندهد شبکه را خودکار به حالت مستقیم برمی‌گرداند تا اینترنت قطع نشود.

**نصب** (روی روتر):

```sh
curl -fsSL https://raw.githubusercontent.com/aliasgari-ka/luci-app-xraypanel/main/install.sh | sh
```

**استفاده:** آدرس `http://192.168.1.1` را باز کنید، وارد شوید و به **Services → Xray** بروید.

- **Servers**: لینک‌های `vmess://`، `vless://`، `trojan://` یا `ss://` را پیست کنید، *Enable Xray* را روشن کنید و **Save & Apply** بزنید.
- **Routing**: مثل پنل ثنایی (3x-ui): بخش Basic برای لیست‌های مستقیم و مسدود، و جدول قوانین با دامنه، IP، پورت، IP دستگاه مبدأ، پروتکل و خروجی (مستقیم، پروکسی، یک سرور خاص یا مسدود). سایت‌ها، بانک‌ها و اپ‌های ایرانی به‌صورت پیش‌فرض مستقیم می‌روند.
- **Settings**: انتخاب شبکه‌هایی که از Xray رد شوند، دستگاه‌هایی که همیشه مستقیم بمانند، DNS و زمان‌بندی آپدیت geo.
- **Status**: وضعیت، تأخیر پروکسی، مصرف رم و لاگ.

فقط TCP از پروکسی رد می‌شود و فقط IPv4 پشتیبانی می‌شود.
