import { describe, expect, it } from "vitest";
import { EXPERIENCE, counterpartType } from "../data/node-experience";
import { SCENARIOS, projectFromScenario } from "../data/scenarios";
import type { StudioProject } from "../types";
import { realGraph } from "./__fixtures__/configs";
import { emptyProject, graphFromConfig, parseWaterWall } from "./importer";
import { pairIssuesFor, validatePair, type PairRuleId } from "./pairValidator";
import { schema } from "./schema";

type RawNode = {
  name: string;
  type: string;
  settings?: Record<string, unknown>;
  next?: string;
};

const pairProject = (
  iran: RawNode[],
  kharej: RawNode[],
  variables: Record<string, unknown> = {},
): StudioProject => ({
  ...emptyProject(schema),
  servers: {
    iran: graphFromConfig(
      parseWaterWall(JSON.stringify({ name: "iran", variables, nodes: iran })),
    ),
    kharej: graphFromConfig(
      parseWaterWall(
        JSON.stringify({ name: "kharej", variables, nodes: kharej }),
      ),
    ),
  },
});

const rules = (project: StudioProject): PairRuleId[] =>
  validatePair(project).map((finding) => finding.ruleId);

/** iran: listener -> connector to kharej. kharej: listener -> local connector. */
const tunnel = (
  iranMiddle: RawNode[] = [],
  kharejMiddle: RawNode[] = [],
  ports = { iranOut: 443, kharejIn: 443 },
) => {
  const chain = (nodes: RawNode[]) =>
    nodes.map((node, index) => ({
      ...node,
      next: nodes[index + 1]?.name,
    }));
  return pairProject(
    chain([
      { name: "in", type: "TcpListener", settings: { port: 1080 } },
      ...iranMiddle,
      {
        name: "out",
        type: "TcpConnector",
        settings: { address: "203.0.113.9", port: ports.iranOut },
      },
    ]),
    chain([
      { name: "in", type: "TcpListener", settings: { port: ports.kharejIn } },
      ...kharejMiddle,
      {
        name: "out",
        type: "TcpConnector",
        settings: { address: "127.0.0.1", port: 8080 },
      },
    ]),
  );
};

describe("counterpart table", () => {
  /**
   * The single highest-leverage test here: it keeps the table honest as P10
   * fills in the remaining node types.
   */
  it("is symmetric across every node in the schema", () => {
    const asymmetric: string[] = [];
    for (const definition of schema.nodes) {
      const other = counterpartType(definition.type);
      if (!other || other === "self") continue;
      if (counterpartType(other) !== definition.type)
        asymmetric.push(
          `${definition.type} -> ${other} -> ${String(counterpartType(other))}`,
        );
    }
    expect(asymmetric).toEqual([]);
  });

  it("only names types that exist in the schema", () => {
    const known = new Set(schema.nodes.map((node) => node.type));
    const unknown = schema.nodes
      .map((definition) => counterpartType(definition.type))
      .filter(
        (type): type is string =>
          typeof type === "string" && type !== "self" && !known.has(type),
      );
    expect(unknown).toEqual([]);
  });

  /** Hand-written entries win; the rest come from the Client/Server naming. */
  it("covers every Client/Server pair the schema declares", () => {
    const missing = schema.nodes
      .map((definition) => definition.type)
      .filter((type) => /(?:Client|Server)$/.test(type))
      .filter((type) => {
        const other = type.replace(/(Client|Server)$/, (suffix) =>
          suffix === "Client" ? "Server" : "Client",
        );
        return (
          schema.nodes.some((node) => node.type === other) &&
          counterpartType(type) !== other
        );
      });
    expect(missing).toEqual([]);
  });

  /**
   * Every node the user can drop on the canvas should say what it is for. The
   * fallback in nodeExperience() only repeats the schema description, which is
   * English and written for implementers.
   */
  it("describes every node except the Template placeholder", () => {
    const undescribed = schema.nodes
      .map((definition) => definition.type)
      .filter((type) => !EXPERIENCE[type]);
    expect(undescribed).toEqual(["Template"]);
  });

  it("keeps the hand-written self-pairs", () => {
    expect(EXPERIENCE.Bridge?.counterpart).toBe("self");
    expect(EXPERIENCE.WireGuardDevice?.counterpart).toBe("self");
  });
});

describe("PAIR_PORT_MISMATCH", () => {
  it("fires when the dialled port is not the listening port", () => {
    expect(rules(tunnel([], [], { iranOut: 8443, kharejIn: 443 }))).toContain(
      "PAIR_PORT_MISMATCH",
    );
  });

  it("does not fire when the ports agree", () => {
    expect(rules(tunnel())).not.toContain("PAIR_PORT_MISMATCH");
  });

  /**
   * Every real Kharej config ends by handing off to a local service. Pairing
   * that connector with a remote listener invents a mismatch that is not there.
   */
  it("ignores a connector dialling loopback", () => {
    const project = pairProject(
      [
        {
          name: "out",
          type: "TcpConnector",
          settings: { address: "127.0.0.1", port: 2083 },
        },
      ],
      [{ name: "in", type: "TcpListener", settings: { port: 443 } }],
    );
    expect(rules(project)).not.toContain("PAIR_PORT_MISMATCH");
  });

  /**
   * Real configs write ports as $variables$. parseWaterWall keeps the token as a
   * literal string, so comparing it against a resolved number is a guaranteed
   * false mismatch — the raw text is what the importer actually sees.
   */
  it("resolves $variables$ before comparing", () => {
    const side = (name: string, nodes: string) =>
      graphFromConfig(
        parseWaterWall(`{
          "name": "${name}",
          "variables": { "outbound": 443, "inbound": 443 },
          "nodes": [${nodes}]
        }`),
      );
    const project: StudioProject = {
      ...emptyProject(schema),
      servers: {
        iran: side(
          "iran",
          `{ "name": "out", "type": "TcpConnector",
             "settings": { "address": "203.0.113.9", "port": $outbound$ } }`,
        ),
        kharej: side(
          "kharej",
          `{ "name": "in", "type": "TcpListener",
             "settings": { "port": $inbound$ } }`,
        ),
      },
    };

    expect(rules(project)).not.toContain("PAIR_PORT_MISMATCH");
  });
});

describe("PAIR_SECRET_MISMATCH", () => {
  const withKeys = (iranKey: string, kharejKey: string) =>
    tunnel(
      [{ name: "obf", type: "ObfuscatorClient", settings: { xor_key: iranKey } }],
      [{ name: "obf", type: "ObfuscatorServer", settings: { xor_key: kharejKey } }],
    );

  it("fires when a shared key differs", () => {
    const findings = validatePair(withKeys("abc", "abd"));
    const secret = findings.find(
      (finding) => finding.ruleId === "PAIR_SECRET_MISMATCH",
    )!;
    expect(secret.severity).toBe("error");
    expect(secret.sideA.server).not.toBe(secret.sideB!.server);
    expect(secret.technical).toContain('"abc"');
    expect(secret.technical).toContain('"abd"');
  });

  it("does not fire when the key matches", () => {
    expect(rules(withKeys("abc", "abc"))).not.toContain(
      "PAIR_SECRET_MISMATCH",
    );
  });

  /** A private key shared by both servers is a security defect, not drift. */
  it("fires when both servers share one private key", () => {
    const project = tunnel(
      [
        {
          name: "wg",
          type: "WireGuardDevice",
          settings: { "private-key": "SAME" },
        },
      ],
      [
        {
          name: "wg",
          type: "WireGuardDevice",
          settings: { "private-key": "SAME" },
        },
      ],
    );
    // WireGuardDevice's counterpart is "self": it pairs with the same type on
    // the other server, so the two are matched by type rather than through the
    // client/server table.
    const findings = validatePair(project).filter(
      (finding) => finding.ruleId === "PAIR_SECRET_MISMATCH",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].technical).toContain("identical on both servers");
  });

  /**
   * A client carries sni, its server carries the certificate. That asymmetry is
   * correct, and reporting it would flag every well-formed config.
   */
  it("says nothing about sni and certificates", () => {
    const project = tunnel(
      [{ name: "tls", type: "TlsClient", settings: { sni: "example.com" } }],
      [
        {
          name: "tls",
          type: "TlsServer",
          settings: { "cert-file": "/etc/cert.pem" },
        },
      ],
    );
    expect(rules(project)).not.toContain("PAIR_SECRET_MISMATCH");
  });
});

describe("PAIR_MISSING_COUNTERPART", () => {
  it("fires for a client with no server on the other side", () => {
    const project = tunnel(
      [{ name: "mux", type: "MuxClient", settings: {} }],
      [],
    );
    expect(rules(project)).toContain("PAIR_MISSING_COUNTERPART");
  });

  it("does not fire when the counterpart is present", () => {
    const project = tunnel(
      [{ name: "mux", type: "MuxClient", settings: {} }],
      [{ name: "mux", type: "MuxServer", settings: {} }],
    );
    expect(rules(project)).not.toContain("PAIR_MISSING_COUNTERPART");
  });

  /** Absence of a counterpart claim is not a claim of absence. */
  it("says nothing about a node with no counterpart declared", () => {
    const project = tunnel(
      [{ name: "limit", type: "SpeedLimit", settings: {} }],
      [],
    );
    expect(rules(project)).not.toContain("PAIR_MISSING_COUNTERPART");
  });
});

describe("PAIR_PROTOCOL_MISMATCH", () => {
  it("fires when the transports differ across the link", () => {
    const project = pairProject(
      [
        {
          name: "out",
          type: "UdpConnector",
          settings: { address: "203.0.113.9", port: 443 },
        },
      ],
      [{ name: "in", type: "TcpListener", settings: { port: 443 } }],
    );
    expect(rules(project)).toContain("PAIR_PROTOCOL_MISMATCH");
  });

  it("does not fire when both sides speak TCP", () => {
    expect(rules(tunnel())).not.toContain("PAIR_PROTOCOL_MISMATCH");
  });

  it("accepts a TcpUdp listener against a Tcp connector", () => {
    const project = pairProject(
      [
        {
          name: "out",
          type: "TcpConnector",
          settings: { address: "203.0.113.9", port: 443 },
        },
      ],
      [{ name: "in", type: "TcpUdpListener", settings: { port: 443 } }],
    );
    expect(rules(project)).not.toContain("PAIR_PROTOCOL_MISMATCH");
  });
});

describe("PAIR_TIMEOUT_SKEW", () => {
  it("fires past a factor of two", () => {
    const project = tunnel(
      [
        {
          name: "ka",
          type: "KeepAliveClient",
          settings: { "interval-ms": 1000 },
        },
      ],
      [
        {
          name: "ka",
          type: "KeepAliveServer",
          settings: { "interval-ms": 5000 },
        },
      ],
    );
    expect(rules(project)).toContain("PAIR_TIMEOUT_SKEW");
  });

  it("tolerates a small difference", () => {
    const project = tunnel(
      [
        {
          name: "ka",
          type: "KeepAliveClient",
          settings: { "interval-ms": 1000 },
        },
      ],
      [
        {
          name: "ka",
          type: "KeepAliveServer",
          settings: { "interval-ms": 1500 },
        },
      ],
    );
    expect(rules(project)).not.toContain("PAIR_TIMEOUT_SKEW");
  });
});

describe("PAIR_UNUSED_ENDPOINT", () => {
  it("reports a listener nothing dials", () => {
    const project = pairProject(
      [
        {
          name: "out",
          type: "TcpConnector",
          settings: { address: "203.0.113.9", port: 443 },
        },
      ],
      [
        { name: "in", type: "TcpListener", settings: { port: 443 } },
        { name: "spare", type: "TcpListener", settings: { port: 9999 } },
      ],
    );
    const finding = validatePair(project).find(
      (item) => item.ruleId === "PAIR_UNUSED_ENDPOINT",
    );
    expect(finding?.severity).toBe("info");
  });

  /** With nothing dialling across, the direction makes no claim at all. */
  it("stays quiet when the side has no cross-server connector", () => {
    const project = pairProject(
      [{ name: "in", type: "TcpListener", settings: { port: 1080 } }],
      [{ name: "in", type: "TcpListener", settings: { port: 443 } }],
    );
    expect(rules(project)).not.toContain("PAIR_UNUSED_ENDPOINT");
  });
});

describe("PAIR_OBFUSCATION_ASYMMETRIC", () => {
  /**
   * Presence is PAIR_MISSING_COUNTERPART's job. What this catches is order:
   * both sides hold the same layers but stack them the wrong way round, so
   * each unwraps in the wrong sequence.
   */
  it("fires when the two sides stack the same layers in a different order", () => {
    const project = tunnel(
      [
        { name: "vless", type: "VlessClient", settings: { uuid: "u" } },
        { name: "tls", type: "TlsClient", settings: {} },
      ],
      [
        { name: "vless", type: "VlessServer", settings: { uuid: "u" } },
        { name: "tls", type: "TlsServer", settings: {} },
      ],
    );
    const finding = validatePair(project).find(
      (item) => item.ruleId === "PAIR_OBFUSCATION_ASYMMETRIC",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.technical).toContain("vs");
  });

  it("does not fire for a properly mirrored stack", () => {
    const project = tunnel(
      [
        { name: "vless", type: "VlessClient", settings: { uuid: "u" } },
        { name: "tls", type: "TlsClient", settings: {} },
      ],
      [
        { name: "tls", type: "TlsServer", settings: {} },
        { name: "vless", type: "VlessServer", settings: { uuid: "u" } },
      ],
    );
    expect(rules(project)).not.toContain("PAIR_OBFUSCATION_ASYMMETRIC");
  });

  /** A single layer has no order to get wrong. */
  it("stays quiet for a one-layer stack", () => {
    const project = tunnel(
      [{ name: "obf", type: "ObfuscatorClient", settings: { xor_key: "k" } }],
      [{ name: "obf", type: "ObfuscatorServer", settings: { xor_key: "k" } }],
    );
    expect(rules(project)).not.toContain("PAIR_OBFUSCATION_ASYMMETRIC");
  });

  /** When a layer is simply absent, the precise error stands in for this. */
  it("defers to PAIR_MISSING_COUNTERPART for an absent layer", () => {
    const project = tunnel(
      [{ name: "obf", type: "ObfuscatorClient", settings: { xor_key: "k" } }],
      [],
    );
    const ruleIds = validatePair(project).map((finding) => finding.ruleId);

    expect(ruleIds).toContain("PAIR_MISSING_COUNTERPART");
    expect(ruleIds).not.toContain("PAIR_OBFUSCATION_ASYMMETRIC");
  });
});

describe("directionality", () => {
  /** A symmetric mismatch is one finding, not one per direction. */
  it("reports a port mismatch once, marked as both directions", () => {
    const findings = validatePair(
      tunnel([], [], { iranOut: 8443, kharejIn: 443 }),
    ).filter((finding) => finding.ruleId === "PAIR_PORT_MISMATCH");

    expect(findings).toHaveLength(1);
  });

  it("reports a missing counterpart only in the failing direction", () => {
    const findings = validatePair(
      tunnel([{ name: "mux", type: "MuxClient", settings: {} }], []),
    ).filter((finding) => finding.ruleId === "PAIR_MISSING_COUNTERPART");

    expect(findings).toHaveLength(1);
    expect(findings[0].direction).toBe("iran->kharej");
  });
});

describe("projection onto the active canvas", () => {
  it("anchors on the active server and points peer at the other", () => {
    const findings = validatePair(
      tunnel([], [], { iranOut: 8443, kharejIn: 443 }),
    );

    const onIran = pairIssuesFor(findings, "iran")[0];
    const onKharej = pairIssuesFor(findings, "kharej")[0];

    expect(onIran.peer?.server).toBe("kharej");
    expect(onKharej.peer?.server).toBe("iran");
    expect(onIran.nodeId).toBe(onKharej.peer?.nodeId);
    expect(onKharej.nodeId).toBe(onIran.peer?.nodeId);
  });

  it("offers a server switch for a finding with no node here", () => {
    const findings = validatePair(
      pairProject(
        [
          {
            name: "out",
            type: "TcpConnector",
            settings: { address: "203.0.113.9", port: 443 },
          },
        ],
        [
          { name: "in", type: "TcpListener", settings: { port: 443 } },
          { name: "spare", type: "TcpListener", settings: { port: 9999 } },
        ],
      ),
    ).filter((finding) => finding.ruleId === "PAIR_UNUSED_ENDPOINT");

    const onIran = pairIssuesFor(findings, "iran")[0];
    expect(onIran.action?.type).toBe("switch-server");
    expect(onIran.peer?.server).toBe("kharej");
  });
});

describe("real topologies", () => {
  it("finds nothing wrong with the BITSWAP_MUX pair", () => {
    const project: StudioProject = {
      ...emptyProject(schema),
      servers: {
        iran: realGraph("BITSWAP_MUX_IRAN3__config_iran"),
        kharej: realGraph("BITSWAP_MUX_KHAREJ__config_kharej"),
      },
    };

    expect(validatePair(project).map((finding) => finding.technical)).toEqual(
      [],
    );
  });

  it("finds nothing wrong with the PROTOSWAP pair", () => {
    const project: StudioProject = {
      ...emptyProject(schema),
      servers: {
        iran: realGraph("PROTOSWAP_IRAN__config_iran"),
        kharej: realGraph("PROTOSWAP_KHAREJ__config_kharej"),
      },
    };

    expect(validatePair(project).map((finding) => finding.technical)).toEqual(
      [],
    );
  });

  it("passes every bundled scenario", () => {
    for (const scenario of SCENARIOS) {
      const project = projectFromScenario(scenario, emptyProject(schema));
      expect({
        id: scenario.id,
        findings: validatePair(project).map((finding) => finding.technical),
      }).toEqual({ id: scenario.id, findings: [] });
    }
  });

  /** And it does catch a real defect injected into a real config. */
  it("catches a key typo introduced into a real pair", () => {
    const kharej = realGraph("BITSWAP_MUX_KHAREJ__config_kharej");
    const broken = {
      ...kharej,
      nodes: kharej.nodes.map((node) =>
        node.data.type === "ObfuscatorServer"
          ? {
              ...node,
              data: {
                ...node.data,
                settings: { ...node.data.settings, key: 91 },
              },
            }
          : node,
      ),
    };
    const project: StudioProject = {
      ...emptyProject(schema),
      servers: { iran: realGraph("BITSWAP_MUX_IRAN3__config_iran"), kharej: broken },
    };

    expect(validatePair(project).map((finding) => finding.ruleId)).toContain(
      "PAIR_SECRET_MISMATCH",
    );
  });

  it("says nothing when one canvas is still empty", () => {
    const project: StudioProject = {
      ...emptyProject(schema),
      servers: {
        iran: realGraph("PROTOSWAP_IRAN__config_iran"),
        kharej: { nodes: [], edges: [], variables: {} },
      },
    };
    expect(validatePair(project)).toEqual([]);
  });
});
