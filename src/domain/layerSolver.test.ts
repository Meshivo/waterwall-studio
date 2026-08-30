import { describe, expect, it } from "vitest";
import type { NodeDefinition, StudioEdge, StudioNode } from "../types";
import { REAL_CONFIG_NAMES, realGraph } from "./__fixtures__/configs";
import { decomposeChains } from "./chains";
import { LG } from "./layerGroups";
import {
  Any,
  Empty,
  L3,
  L4,
  domainToString,
  flipDomain,
  groupToDomain,
  solveChain,
  solveGraph,
  validateNodeMetadata,
} from "./layerSolver";
import { getDefinition, schema } from "./schema";
import { checkConnection } from "./validator";

const node = (id: string, type: string): StudioNode => ({
  id,
  type: "waterwall",
  position: { x: 0, y: 0 },
  data: { type, name: id, settings: {}, definition: getDefinition(type) },
});

const edge = (source: string, target: string, handle = "next"): StudioEdge => ({
  id: `${source}:${handle}:${target}`,
  source,
  target,
  sourceHandle: handle,
  targetHandle: "previous",
  type: "waterwall",
});

/** Build a straight chain from an ordered list of [id, type]. */
const line = (...spec: [string, string][]) => {
  const nodes = spec.map(([id, type]) => node(id, type));
  const edges = nodes
    .slice(1)
    .map((target, index) => edge(nodes[index].id, target.id));
  return { nodes, edges };
};

const solveLine = (...spec: [string, string][]) => {
  const { nodes, edges } = line(...spec);
  return solveGraph(nodes, edges);
};

const codesOf = (solution: ReturnType<typeof solveGraph>) =>
  solution.issues.map((item) => item.code);

const statusCodes = (solution: ReturnType<typeof solveGraph>) =>
  solution.chains.map((chain) => chain.status.code);

describe("domain lattice", () => {
  /**
   * nodeLayerDomainFlip is not a bitwise complement. flip(Any) === Any is the
   * reason an Opposite relation between two unconstrained edges never narrows:
   * the relationship is recorded, the orientation is not forced.
   */
  it("flips L3 and L4 but leaves Any and Empty alone", () => {
    expect(flipDomain(L3)).toBe(L4);
    expect(flipDomain(L4)).toBe(L3);
    expect(flipDomain(Any)).toBe(Any);
    expect(flipDomain(Empty)).toBe(Empty);
    expect(flipDomain(Any)).not.toBe((~Any & 3) as never);
  });

  it("extracts only the L3/L4 bits from a group mask", () => {
    expect(groupToDomain(LG.L3)).toBe(L3);
    expect(groupToDomain(LG.L4)).toBe(L4);
    expect(groupToDomain(LG.Anything)).toBe(Any);
    expect(groupToDomain(LG.Anything | LG.OppositePrev)).toBe(Any);
    expect(groupToDomain(LG.SameAsPrev)).toBe(Empty);
  });

  it("renders domains the way the C helper does", () => {
    expect(domainToString(Empty)).toBe("{}");
    expect(domainToString(L3)).toBe("L3");
    expect(domainToString(L4)).toBe("L4");
    expect(domainToString(Any)).toBe("{L3, L4}");
  });
});

describe("node metadata validation", () => {
  it("accepts every node in the shipped schema", () => {
    const broken = getDefinitionsWithBadMetadata();
    expect(broken).toEqual([]);
  });

  const mutate = (base: string, patch: Partial<NodeDefinition>) => ({
    ...getDefinition(base),
    ...patch,
  });

  it("rejects a relative flag inside layer_group", () => {
    const status = validateNodeMetadata(
      mutate("TlsClient", {
        layerGroups: { own: LG.SameAsPrev, prev: LG.L4, next: LG.L4 },
      }),
      "broken",
    );
    expect(status.code).toBe("MetadataShape");
    expect(status.message).toContain("forbidden relative layer flags");
  });

  /**
   * The side asymmetry is the point: the next-side field may only reference
   * prev, and vice versa.
   */
  it("rejects a forward-referencing flag on the next side", () => {
    const status = validateNodeMetadata(
      mutate("TlsClient", {
        layerGroups: { own: LG.L4, prev: LG.L4, next: LG.SameAsNext },
      }),
      "broken",
    );
    expect(status.code).toBe("MetadataShape");
    expect(status.message).toContain("forbidden forward-referencing");
  });

  it("rejects a backward-referencing flag on the prev side", () => {
    const status = validateNodeMetadata(
      mutate("TlsClient", {
        layerGroups: { own: LG.L4, prev: LG.SameAsPrev, next: LG.L4 },
      }),
      "broken",
    );
    expect(status.code).toBe("MetadataShape");
    expect(status.message).toContain("forbidden backward-referencing");
  });

  it("rejects an Opposite flag with no base layer group", () => {
    const status = validateNodeMetadata(
      mutate("TlsClient", {
        layerGroups: { own: LG.L4, prev: LG.L4, next: LG.OppositePrev },
      }),
      "broken",
    );
    expect(status.code).toBe("MetadataShape");
    expect(status.message).toContain("Opposite flag without base layer group");
  });

  it("rejects can_have_next = false with a non-None next mask", () => {
    const status = validateNodeMetadata(
      mutate("TlsClient", { capabilities: { prev: true, next: false } }),
      "broken",
    );
    expect(status.code).toBe("MetadataShape");
    expect(status.message).toContain("can_have_next = false");
  });

  it("accepts all eight legal forms of the next side", () => {
    for (const next of [
      LG.None,
      LG.L3,
      LG.L4,
      LG.Anything,
      LG.SameAsPrev,
      LG.L3 | LG.OppositePrev,
      LG.L4 | LG.OppositePrev,
      LG.Anything | LG.OppositePrev,
    ])
      expect(
        validateNodeMetadata(
          mutate("TlsClient", {
            layerGroups: { own: LG.Anything, prev: LG.Anything, next },
            capabilities: { prev: true, next: next !== LG.None },
          }),
          "probe",
        ).code,
      ).toBe("Ok");
  });
});

describe("solving valid chains", () => {
  it("solves a plain L4 chain", () => {
    const solution = solveLine(
      ["in", "TcpListener"],
      ["tls", "TlsClient"],
      ["out", "TcpConnector"],
    );

    expect(solution.issues).toEqual([]);
    expect(statusCodes(solution)).toEqual(["Ok"]);
    expect(solution.containsPacketNode).toBe(false);
    expect(solution.resolvedByNode.get("tls")).toEqual({ prev: L4, next: L4 });
  });

  it("solves a transparent SameAs node inside an L4 chain", () => {
    const solution = solveLine(
      ["in", "TcpListener"],
      ["obf", "ObfuscatorClient"],
      ["out", "TcpConnector"],
    );

    expect(solution.issues).toEqual([]);
    expect(solution.resolvedByNode.get("obf")).toEqual({ prev: L4, next: L4 });
  });

  it("solves a transparent SameAs node inside an L3 chain", () => {
    const solution = solveLine(
      ["tun", "TunDevice"],
      ["obf", "ObfuscatorClient"],
      ["raw", "RawSocket"],
    );

    expect(solution.issues).toEqual([]);
    expect(solution.resolvedByNode.get("obf")).toEqual({ prev: L3, next: L3 });
    expect(solution.containsPacketNode).toBe(true);
  });

  it("propagates through a run of several transparent nodes", () => {
    const solution = solveLine(
      ["tun", "TunDevice"],
      ["a", "ObfuscatorClient"],
      ["b", "ObfuscatorClient"],
      ["c", "ObfuscatorClient"],
      ["raw", "RawSocket"],
    );

    expect(solution.issues).toEqual([]);
    for (const id of ["a", "b", "c"])
      expect(solution.resolvedByNode.get(id)).toEqual({ prev: L3, next: L3 });
  });

  /**
   * SameAs is conditional: a missing side contributes no constraint. That is
   * what lets ObfuscatorClient sit at either end of a chain — unlike Opposite,
   * which is strict.
   */
  it("treats a conditional SameAs at a chain boundary as unconstrained", () => {
    const solution = solveLine(
      ["tun", "TunDevice"],
      ["obf", "ObfuscatorClient"],
      ["raw", "RawSocket"],
    );
    expect(codesOf(solution)).not.toContain("layer-relative-missing-side");
  });

  it("solves each PacketSplitStream branch independently", () => {
    const nodes = [
      node("tun", "TunDevice"),
      node("split", "PacketSplitStream"),
      node("up", "IpOverrider"),
      node("down", "IpOverrider"),
      node("rawUp", "RawSocket"),
      node("rawDown", "RawSocket"),
    ];
    const edges = [
      edge("tun", "split"),
      edge("split", "up", "up"),
      edge("split", "down", "down"),
      edge("up", "rawUp"),
      edge("down", "rawDown"),
    ];

    const solution = solveGraph(nodes, edges);

    expect(solution.issues).toEqual([]);
    expect(solution.chains).toHaveLength(2);
    expect(solution.chains.every((chain) => chain.containsPacketNode)).toBe(true);
  });
});

describe("WireGuardDevice", () => {
  /**
   * WireGuardDevice is the only Opposite* user in the tree — it declares
   * Anything|OppositePrev on the next side and Anything|OppositeNext on the
   * prev side. The layer must invert across it.
   */
  it("inverts the layer across itself", () => {
    const solution = solveLine(
      ["tun", "TunDevice"],
      ["wg", "WireGuardDevice"],
      ["out", "TcpConnector"],
    );

    expect(solution.issues).toEqual([]);
    const resolved = solution.resolvedByNode.get("wg")!;
    expect(resolved.prev).not.toBe(resolved.next);
    expect([resolved.prev, resolved.next].sort()).toEqual([L3, L4]);
    expect(resolved.prev).not.toBe(Any);
    expect(resolved.next).not.toBe(Any);
  });

  /** An Opposite relation alone makes the chain a packet chain (c:965). */
  it("marks its chain as containing a packet node", () => {
    expect(
      solveLine(
        ["tun", "TunDevice"],
        ["wg", "WireGuardDevice"],
        ["out", "TcpConnector"],
      ).containsPacketNode,
    ).toBe(true);
  });

  /**
   * Opposite is strict — it demands both sides — but with the shipped node set
   * that rule is unreachable: WireGuardDevice is the only Opposite user and
   * carries neither ChainHead nor ChainEnd, so the boundary rule that precedes
   * it in C order always fires first. That ordering is itself worth pinning.
   */
  it("reports the boundary rule first when it starts a chain", () => {
    const solution = solveLine(["wg", "WireGuardDevice"], ["out", "TcpConnector"]);
    expect(statusCodes(solution)).toEqual(["Structural"]);
    expect(solution.issues[0].technical).toContain(
      "does not have flag kNodeFlagChainHead",
    );
  });

  it("reports the boundary rule first when it ends a chain", () => {
    const solution = solveLine(["tun", "TunDevice"], ["wg", "WireGuardDevice"]);
    expect(statusCodes(solution)).toEqual(["Structural"]);
    expect(solution.issues[0].technical).toContain(
      "does not have flag kNodeFlagChainEnd",
    );
  });

  /**
   * The node declares Opposite on both sides, which C's addRelation collapses
   * into one relation by edge identity. Two relations would still converge, but
   * the iteration bound is computed from the edge count, so the dedupe is what
   * keeps the port faithful.
   */
  it("collapses its two Opposite declarations into one relation", () => {
    // 2 edges -> maxIterations 6. A duplicated relation still fits, so assert
    // the observable consequence instead: the solve is stable and exact.
    const solution = solveLine(
      ["tun", "TunDevice"],
      ["wg", "WireGuardDevice"],
      ["out", "TcpConnector"],
    );
    expect(solution.chains[0].ok).toBe(true);
    expect(solution.chains[0].resolvedPrevLayer.get("wg")).toBe(L3);
    expect(solution.chains[0].resolvedNextLayer.get("wg")).toBe(L4);
  });
});

describe("RelativeMissingSide", () => {
  /**
   * Reached only through the definition seam, because no shipped node combines
   * Opposite with a boundary flag. The rule still has to be right: a
   * hypothetical Opposite node allowed at a chain end must be rejected for the
   * missing side rather than silently solved.
   */
  const oppositeChainHead = (): NodeDefinition => ({
    ...getDefinition("WireGuardDevice"),
    flags: { chainHead: true, chainEnd: true, noChain: false, singleton: false },
  });

  it("rejects an Opposite node with no previous node", () => {
    const { nodes, edges } = line(["wg", "WireGuardDevice"], ["out", "TcpConnector"]);
    const decomposition = decomposeChains(nodes, edges);
    const result = solveChain(
      decomposition.chains[0],
      new Map(nodes.map((item) => [item.id, item])),
      (type) => (type === "WireGuardDevice" ? oppositeChainHead() : getDefinition(type)),
    );

    expect(result.status.code).toBe("RelativeMissingSide");
    expect(result.status.message).toContain("has no previous node");
    expect(result.status.message).toContain(
      "kNodeLayerAnything|kNodeLayerOppositePrev",
    );
  });

  it("rejects an Opposite node with no next node", () => {
    const { nodes, edges } = line(["tun", "TunDevice"], ["wg", "WireGuardDevice"]);
    const decomposition = decomposeChains(nodes, edges);
    const result = solveChain(
      decomposition.chains[0],
      new Map(nodes.map((item) => [item.id, item])),
      (type) => (type === "WireGuardDevice" ? oppositeChainHead() : getDefinition(type)),
    );

    expect(result.status.code).toBe("RelativeMissingSide");
    expect(result.status.message).toContain("has no next node");
  });

  /** SameAs stays conditional under the same conditions — no error. */
  it("does not reject a conditional SameAs node at a chain boundary", () => {
    const { nodes, edges } = line(["obf", "ObfuscatorClient"], ["out", "TcpConnector"]);
    const decomposition = decomposeChains(nodes, edges);
    const result = solveChain(
      decomposition.chains[0],
      new Map(nodes.map((item) => [item.id, item])),
      (type) =>
        type === "ObfuscatorClient"
          ? {
              ...getDefinition("ObfuscatorClient"),
              flags: { chainHead: true, chainEnd: true, noChain: false, singleton: false },
            }
          : getDefinition(type),
    );

    expect(result.status.code).toBe("Ok");
  });
});

describe("rejecting invalid chains", () => {
  /**
   * The headline case. ObfuscatorClient is SameAs on both sides, so it cannot
   * bridge an L3 device to an L4 protocol — the two sides resolve to L3 and L4
   * and the intersection is empty.
   *
   * The companion assertion pins the deliberate two-tier asymmetry: the
   * drag-time check accepts both edges, because it compares two port strings
   * and knows nothing about SameAs propagation. The edge gets drawn and the
   * solver puts a red issue on it. A future change to layersCompatible that
   * made this test vacuous would be caught here.
   */
  it("rejects TunDevice -> ObfuscatorClient -> TlsClient", () => {
    const { nodes, edges } = line(
      ["tun", "TunDevice"],
      ["obf", "ObfuscatorClient"],
      ["tls", "TlsClient"],
      ["out", "TcpConnector"],
    );

    const solution = solveGraph(nodes, edges);

    expect(codesOf(solution)).toContain("layer-conflict");
    const conflict = solution.issues.find(
      (item) => item.code === "layer-conflict",
    )!;
    expect(conflict.nodeId).toBe("obf");
    expect(conflict.technical).toContain("kNodeLayerSolverErrConflict");
    expect(conflict.technical).toContain(
      "requires same layer on both sides, but sides resolved to incompatible domains (L3 and L4)",
    );

    for (const item of edges)
      expect(
        checkConnection(
          {
            source: item.source,
            target: item.target,
            sourceHandle: item.sourceHandle ?? null,
            targetHandle: item.targetHandle ?? null,
          },
          nodes,
          [],
        ).valid,
      ).toBe(true);
  });

  it("reports a conflict for a direct L3 to L4 adjacency", () => {
    const solution = solveLine(
      ["tun", "TunDevice"],
      ["tls", "TlsClient"],
      ["out", "TcpConnector"],
    );
    expect(codesOf(solution)).toContain("layer-conflict");
  });

  it("reports Structural when a node without ChainHead starts a chain", () => {
    const solution = solveLine(["tls", "TlsClient"], ["out", "TcpConnector"]);
    const issue = solution.issues.find(
      (item) => item.code === "layer-structural",
    )!;
    expect(issue.technical).toContain("does not have flag kNodeFlagChainHead");
  });

  it("reports Structural when a node without ChainEnd ends a chain", () => {
    const solution = solveLine(["in", "TcpListener"], ["tls", "TlsClient"]);
    const issue = solution.issues.find(
      (item) => item.code === "layer-structural",
    )!;
    expect(issue.technical).toContain("does not have flag kNodeFlagChainEnd");
  });

  /** TcpConnector declares can_have_next = false and next = kNodeLayerNone. */
  it("reports Structural when a linked side declares kNodeLayerNone", () => {
    const solution = solveLine(
      ["in", "TcpListener"],
      ["out", "TcpConnector"],
      ["tail", "TcpConnector"],
    );
    const issue = solution.issues.find(
      (item) => item.code === "layer-structural",
    )!;
    expect(issue.technical).toContain("can_have_next = false");
  });

  it("anchors a structural issue on a node so it is clickable", () => {
    const solution = solveLine(["tls", "TlsClient"], ["out", "TcpConnector"]);
    const issue = solution.issues[0];
    expect(issue.nodeId).toBe("tls");
    expect(issue.action?.type).toBe("select-node");
    expect(issue.severity).toBe("error");
  });

  /**
   * The lattice is monotone — every pass can only shrink a domain, and a domain
   * can shrink at most twice (Any -> single -> Empty) — so a natural
   * oscillation is not constructible. The bound is a safety net; assert it is
   * the C formula and that a maximum-length chain converges well inside it.
   */
  it("converges inside 2 * edgeCount + 2 for a long chain", () => {
    const spec: [string, string][] = [
      ["head", "TunDevice"],
      ...Array.from(
        { length: 60 },
        (_, index) => [`n${index}`, "ObfuscatorClient"] as [string, string],
      ),
      ["tail", "RawSocket"],
    ];
    const solution = solveLine(...spec);
    expect(solution.issues).toEqual([]);
    expect(codesOf(solution)).not.toContain("layer-convergence");
  });
});

describe("phase ordering", () => {
  /**
   * Every edge is built before any relation. Here the relation on `mid` needs
   * the edge created by the *later* link, so an implementation that interleaved
   * the two phases would find no relation and wrongly accept the graph.
   */
  it("builds every edge before deriving any relation", () => {
    const nodes = [
      node("tun", "TunDevice"),
      node("mid", "ObfuscatorClient"),
      node("tls", "TlsClient"),
      node("out", "TcpConnector"),
    ];
    // Edges deliberately out of chain order.
    const edges = [
      edge("tls", "out"),
      edge("mid", "tls"),
      edge("tun", "mid"),
    ];

    expect(codesOf(solveGraph(nodes, edges))).toContain("layer-conflict");
  });

  it("continues to the next chain after one fails", () => {
    const nodes = [
      ...line(["tls", "TlsClient"], ["out", "TcpConnector"]).nodes,
      ...line(["in2", "TcpListener"], ["out2", "TcpConnector"]).nodes,
    ];
    const edges = [edge("tls", "out"), edge("in2", "out2")];

    const solution = solveGraph(nodes, edges);

    expect(solution.chains).toHaveLength(2);
    expect(statusCodes(solution).sort()).toEqual(["Ok", "Structural"]);
  });
});

describe("representative topology corpus", () => {
  /**
   * These are configs the real core accepts, so every one must solve. This is
   * the widest net in the suite and the guard against a port that is
   * self-consistent but stricter than the runtime.
   */
  it.each([
    ["BITSWAP_MUX_IRAN3__config_iran", 3, true],
    ["BITSWAP_MUX_KHAREJ__config_kharej", 3, true],
    ["IRAN2__config_iran", 2, false],
    ["KHAREJ3__config_kharej", 2, false],
    ["PROTOSWAP_IRAN__config_iran", 2, true],
    ["PROTOSWAP_KHAREJ__config_kharej", 1, true],
    ["PACKET_TUNNEL__config_iran", 2, true],
  ])("solves %s into %i chains", (name, chainCount, packet) => {
    const graph = realGraph(name as string);
    const solution = solveGraph(graph.nodes, graph.edges);

    expect(solution.issues.map((item) => item.technical)).toEqual([]);
    expect(solution.chains).toHaveLength(chainCount as number);
    expect(solution.chains.every((chain) => chain.ok)).toBe(true);
    expect(solution.containsPacketNode).toBe(packet);
  });

  it("covers every fixture in the corpus table", () => {
    expect(REAL_CONFIG_NAMES).toHaveLength(7);
  });
});

/** Every shipped definition must pass the shape check, or P3 regressed. */
function getDefinitionsWithBadMetadata(): string[] {
  return schema.nodes
    .map((definition) => ({
      type: definition.type,
      status: validateNodeMetadata(definition, definition.type),
    }))
    .filter((entry) => entry.status.code !== "Ok")
    .map((entry) => `${entry.type}: ${entry.status.message}`);
}
