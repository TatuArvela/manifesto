import { BlockList, isIP } from "node:net";

/**
 * If the server can open a connection to an address for a user.
 *
 * Link previews make the server get a URL that the user typed. Without this,
 * each account could read the admin ports of the server, the cloud metadata
 * service at 169.254.169.254, or all other systems on its network. Only
 * globally routable unicast addresses pass.
 *
 * `BlockList` checks an IPv4-mapped IPv6 address (`::ffff:127.0.0.1`) against
 * the IPv4 rules. Thus, it refuses a mapped loopback without its own rule.
 */
const blocked = new BlockList();

const IPV4_SPECIAL: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata endpoints
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and the broadcast address
];

for (const [net, prefix] of IPV4_SPECIAL) {
  blocked.addSubnet(net, prefix, "ipv4");
}

/**
 * Global unicast. The code refuses all addresses outside it (loopback, ULA,
 * link-local, multicast, NAT64, mapped) before it uses the list below.
 */
const ipv6GlobalUnicast = new BlockList();
ipv6GlobalUnicast.addSubnet("2000::", 3, "ipv6");

const IPV6_SPECIAL: [string, number][] = [
  ["2001::", 23], // IETF protocol assignments, including Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, which embeds an arbitrary IPv4 address
  ["3fff::", 20], // documentation
];

for (const [net, prefix] of IPV6_SPECIAL) {
  blocked.addSubnet(net, prefix, "ipv6");
}

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  const [, mapped] = MAPPED_IPV4.exec(address) ?? [];
  if (mapped !== undefined) return !blocked.check(mapped, "ipv4");
  if (!ipv6GlobalUnicast.check(address, "ipv6")) return false;
  return !blocked.check(address, "ipv6");
}

/**
 * The local network, for webhooks that an operator permitted to reach it
 * (`WEBHOOKS=private`): a Home Assistant or n8n near the server. Private
 * ranges, carrier-grade NAT (where overlay networks such as Tailscale are),
 * loopback and IPv6 unique-local. Link-local stays blocked, because cloud
 * metadata services answer there.
 */
const localNetwork = new BlockList();
for (const [net, prefix] of [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  localNetwork.addSubnet(net, prefix, "ipv4");
}
localNetwork.addAddress("::1", "ipv6");
localNetwork.addSubnet("fc00::", 7, "ipv6");

export function isLocalNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return localNetwork.check(address, "ipv4");
  if (family !== 6) return false;
  const [, mapped] = MAPPED_IPV4.exec(address) ?? [];
  if (mapped !== undefined) return localNetwork.check(mapped, "ipv4");
  return localNetwork.check(address, "ipv6");
}
