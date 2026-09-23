import { describe, expect, it } from "vitest";
import { isLocalNetworkAddress, isPublicAddress } from "./addressPolicy.js";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.215.14",
    "2606:4700:4700::1111",
    "2a00:1450:4001:80b::200e",
    "::ffff:8.8.8.8",
  ])("allows the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback, elsewhere in the block", "127.1.2.3"],
    ["this network", "0.0.0.0"],
    ["private", "10.0.0.5"],
    ["private", "172.16.0.1"],
    ["private", "172.31.255.255"],
    ["private", "192.168.1.1"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["cloud metadata", "169.254.169.254"],
    ["documentation", "203.0.113.7"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unspecified", "::"],
    ["unique local", "fd00::1"],
    ["link-local", "fe80::1"],
    ["IPv6 multicast", "ff02::1"],
    ["mapped loopback", "::ffff:127.0.0.1"],
    ["mapped loopback in hex", "::ffff:7f00:1"],
    ["mapped metadata", "::ffff:169.254.169.254"],
    ["NAT64", "64:ff9b::a9fe:a9fe"],
    ["6to4", "2002:a9fe:a9fe::1"],
    ["Teredo", "2001:0:4136:e378::1"],
    ["IPv6 documentation", "2001:db8::1"],
  ])("refuses a %s address (%s)", (_kind, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("refuses anything that is not an IP address", () => {
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("isLocalNetworkAddress", () => {
  it("admits the local network a webhook may be allowed to reach", () => {
    for (const address of [
      "10.1.2.3",
      "192.168.1.10",
      "172.20.0.5",
      "100.100.1.1",
      "127.0.0.1",
      "::1",
      "fd12:3456::1",
      "::ffff:192.168.1.10",
    ]) {
      expect(isLocalNetworkAddress(address)).toBe(true);
    }
  });

  it("keeps out link-local, where metadata services answer, and the internet", () => {
    for (const address of ["169.254.169.254", "fe80::1", "8.8.8.8", "nope"]) {
      expect(isLocalNetworkAddress(address)).toBe(false);
    }
  });
});
