#!/bin/sh
# 由 maishu-docker.service 的 EnvironmentFile 提供非秘密参数；需 root。
# 只管理 maishu0、MAISHU-* 链及到这些链的跳转，不修改旧 Docker 网络/链/策略。
set -eu
: "${MAISHU_CONTROLLER_TAIL_IP:?填写控制端 Tailscale IPv4}"
: "${MAISHU_EXECUTOR_TAIL_IP:?填写执行端 Tailscale IPv4}"
MAISHU_CONTROLLER_PORT=${MAISHU_CONTROLLER_PORT:-443}
export MAISHU_CONTROLLER_TAIL_IP MAISHU_EXECUTOR_TAIL_IP MAISHU_CONTROLLER_PORT

# 在任何修改前验证地址、网段冲突和现有 maishu0 的归属。
python3 - <<'PY'
import ipaddress, json, os, subprocess

def ip(*args):
    return json.loads(subprocess.check_output(['ip', '-j', *args], text=True))

controller = ipaddress.IPv4Address(os.environ['MAISHU_CONTROLLER_TAIL_IP'])
executor = ipaddress.IPv4Address(os.environ['MAISHU_EXECUTOR_TAIL_IP'])
tail = ipaddress.ip_network('100.64.0.0/10')
if controller not in tail or executor not in tail or controller == executor:
    raise SystemExit('必须提供不同的控制端/执行端 Tailscale IPv4')
port = os.environ['MAISHU_CONTROLLER_PORT']
if not port.isdecimal() or not 1 <= int(port) <= 65535:
    raise SystemExit('控制端口必须为 1—65535 的整数')
interfaces = ip('-4', 'addr', 'show')
if not any(a['ifname'] == 'tailscale0' and any(v['local'] == str(executor) for v in a.get('addr_info', [])) for a in interfaces):
    raise SystemExit('执行端 Tailscale 地址不属于本机 tailscale0，停止')
subnet = ipaddress.ip_network('172.30.0.0/24')
for interface in interfaces:
    for address in interface.get('addr_info', []):
        network = ipaddress.ip_network(f"{address['local']}/{address['prefixlen']}", strict=False)
        if network.overlaps(subnet) and (interface['ifname'] != 'maishu0' or address['local'] != '172.30.0.1' or address['prefixlen'] != 24):
            raise SystemExit('172.30.0.0/24 与已有接口冲突，停止')
for route in ip('-4', 'route', 'show', 'table', 'main'):
    if route.get('dst', 'default') != 'default' and ipaddress.ip_network(route['dst'], strict=False).overlaps(subnet) and route.get('dev') != 'maishu0':
        raise SystemExit('172.30.0.0/24 与已有路由冲突，停止')
for link in ip('-d', 'link', 'show'):
    if link['ifname'] == 'maishu0' and link.get('linkinfo', {}).get('info_kind') != 'bridge':
        raise SystemExit('maishu0 已存在且不是网桥，停止')
PY

MAISHU_UPLINK=$(ip -4 route get 1.1.1.1 | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n 1)
case "$MAISHU_UPLINK" in ''|maishu0|docker0|br*|tailscale0) echo '未找到独立公网出口，请先检查路由' >&2; exit 1;; esac
ip link show maishu0 >/dev/null 2>&1 || ip link add maishu0 type bridge
ip -4 addr show dev maishu0 | grep -q 'inet 172.30.0.1/24 ' || ip address add 172.30.0.1/24 dev maishu0
ip link set maishu0 up
sysctl -w net.ipv4.ip_forward=1 >/dev/null

# 规则只作用于本产品网段/端口。链名专属，绝不 flush INPUT/FORWARD/DOCKER。
for MAISHU_CHAIN in MAISHU-INPUT MAISHU-EXEC MAISHU-RETURN; do
    iptables -w -N "$MAISHU_CHAIN" 2>/dev/null || iptables -w -S "$MAISHU_CHAIN" >/dev/null
    iptables -w -F "$MAISHU_CHAIN"
done
iptables -w -t nat -N MAISHU-NAT 2>/dev/null || iptables -w -t nat -S MAISHU-NAT >/dev/null
iptables -w -t nat -F MAISHU-NAT
iptables -w -t nat -A MAISHU-NAT -j MASQUERADE
iptables -w -t nat -C POSTROUTING -s 172.30.0.0/24 ! -o maishu0 -j MAISHU-NAT 2>/dev/null || iptables -w -t nat -I POSTROUTING 1 -s 172.30.0.0/24 ! -o maishu0 -j MAISHU-NAT

iptables -w -A MAISHU-INPUT -s "$MAISHU_CONTROLLER_TAIL_IP" -j ACCEPT
iptables -w -A MAISHU-INPUT -s "$MAISHU_EXECUTOR_TAIL_IP" -j ACCEPT
iptables -w -A MAISHU-INPUT -j DROP
iptables -w -C INPUT -d "$MAISHU_EXECUTOR_TAIL_IP" -p tcp -m multiport --dports 8818,48000:49999 -j MAISHU-INPUT 2>/dev/null || iptables -w -I INPUT 1 -d "$MAISHU_EXECUTOR_TAIL_IP" -p tcp -m multiport --dports 8818,48000:49999 -j MAISHU-INPUT

iptables -w -A MAISHU-EXEC -o maishu0 -j DROP
iptables -w -A MAISHU-EXEC -o docker0 -j DROP
iptables -w -A MAISHU-EXEC -o br+ -j DROP
iptables -w -A MAISHU-EXEC -o tailscale0 -d "$MAISHU_CONTROLLER_TAIL_IP" -p tcp --dport "$MAISHU_CONTROLLER_PORT" -j ACCEPT
for MAISHU_PROTOCOL in tcp udp; do
    iptables -w -A MAISHU-EXEC -d 100.100.100.100 -p "$MAISHU_PROTOCOL" --dport 53 -j ACCEPT
done
iptables -w -A MAISHU-EXEC -o "$MAISHU_UPLINK" -j ACCEPT
iptables -w -A MAISHU-EXEC -j DROP
iptables -w -A MAISHU-RETURN -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -w -A MAISHU-RETURN -j DROP
iptables -w -C FORWARD -i maishu0 -j MAISHU-EXEC 2>/dev/null || iptables -w -I FORWARD 1 -i maishu0 -j MAISHU-EXEC
iptables -w -C FORWARD -o maishu0 -j MAISHU-RETURN 2>/dev/null || iptables -w -I FORWARD 2 -o maishu0 -j MAISHU-RETURN
