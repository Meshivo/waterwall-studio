import { describe, expect, it } from "vitest";
import type { StudioNode } from "../types";
import { getDefinition } from "./schema";
import { validateGraph } from "./validator";

const node = (
  id: string,
  type: string,
  settings: Record<string, unknown> = {},
): StudioNode => ({
  id,
  type: "waterwall",
  position: { x: 0, y: 0 },
  data: { type, name: id, settings, definition: getDefinition(type) },
});

const codes = (nodes: StudioNode[]) =>
  validateGraph(nodes, []).map((item) => item.code);

describe("value-level setting rules", () => {
  it("rejects a port outside 1..65535", () => {
    expect(codes([node("in", "TcpListener", { port: 70000 })])).toContain(
      "invalid-setting",
    );
    expect(codes([node("in", "TcpListener", { port: 0 })])).toContain(
      "invalid-setting",
    );
  });

  it("accepts a port inside the range", () => {
    expect(codes([node("in", "TcpListener", { port: 443 })])).not.toContain(
      "invalid-setting",
    );
  });

  it("rejects an IPv4 octet above 255", () => {
    expect(
      codes([node("out", "TcpConnector", { address: "10.0.0.999", port: 443 })]),
    ).toContain("invalid-setting");
  });

  it("rejects an IPv4 prefix above 32", () => {
    expect(
      codes([node("tun", "TunDevice", { "device-ip": "10.0.0.1/64" })]),
    ).toContain("invalid-setting");
  });

  it("leaves a hostname alone", () => {
    expect(
      codes([
        node("out", "TcpConnector", { address: "example.com", port: 443 }),
      ]),
    ).not.toContain("invalid-setting");
  });

  it("rejects a negative timeout", () => {
    expect(
      codes([
        node("in", "TcpListener", {
          port: 443,
          "active-idle-timeout-ms": -5,
        }),
      ]),
    ).toContain("invalid-setting");
  });

  /**
   * Real configs are full of $var$ tokens. parseWaterWall keeps them as literal
   * strings, so a value rule that does not skip them makes every field red.
   */
  it("skips unresolved $variable$ tokens", () => {
    expect(
      codes([
        node("in", "TcpListener", {
          port: "$port_to_listen$",
          address: "$ip_server_iran$",
        }),
      ]),
    ).not.toContain("invalid-setting");
  });
});

describe("port collisions", () => {
  it("reports two TCP listeners bound to the same port", () => {
    const issues = validateGraph(
      [
        node("a", "TcpListener", { port: 443 }),
        node("b", "TcpListener", { port: 443 }),
      ],
      [],
    ).filter((item) => item.code === "port-conflict");

    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].technical).toContain("tcp://0.0.0.0:443");
  });

  it("allows the same port on different addresses", () => {
    expect(
      codes([
        node("a", "TcpListener", { port: 443, address: "10.0.0.1" }),
        node("b", "TcpListener", { port: 443, address: "10.0.0.2" }),
      ]),
    ).not.toContain("port-conflict");
  });

  it("allows TCP and UDP to share a port number", () => {
    expect(
      codes([
        node("a", "TcpListener", { port: 443 }),
        node("b", "UdpListener", { port: 443 }),
      ]),
    ).not.toContain("port-conflict");
  });

  it("reports a TcpUdpListener colliding with a plain TcpListener", () => {
    expect(
      codes([
        node("a", "TcpUdpListener", { port: 443 }),
        node("b", "TcpListener", { port: 443 }),
      ]),
    ).toContain("port-conflict");
  });

  /** A connector's `port` is a destination, not a binding — two are fine. */
  it("ignores connectors dialling the same remote port", () => {
    expect(
      codes([
        node("a", "TcpConnector", { address: "10.0.0.1", port: 443 }),
        node("b", "TcpConnector", { address: "10.0.0.2", port: 443 }),
      ]),
    ).not.toContain("port-conflict");
  });

  it("ignores listeners whose port is still a variable", () => {
    expect(
      codes([
        node("a", "TcpListener", { port: "$p$" }),
        node("b", "TcpListener", { port: "$p$" }),
      ]),
    ).not.toContain("port-conflict");
  });
});
