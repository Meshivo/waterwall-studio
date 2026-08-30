import { describe, expect, it } from "vitest";
import type { StudioEdge, StudioNode } from "../types";
import { REAL_CONFIG_NAMES, realGraph } from "./__fixtures__/configs";
import { MAX_CHAIN_LEN, chainEntryNodeId, decomposeChains } from "./chains";
import { getDefinition } from "./schema";
import { findPaths } from "./simulator";

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

const line = (...types: [string, string][]) => {
  const nodes = types.map(([id, type]) => node(id, type));
  const edges = nodes
    .slice(1)
    .map((target, index) => edge(nodes[index].id, target.id));
  return { nodes, edges };
};

describe("chain decomposition", () => {
  it("turns a linear graph into one chain", () => {
    const { nodes, edges } = line(
      ["in", "TcpListener"],
      ["tls", "TlsClient"],
      ["out", "TcpConnector"],
    );

    const { chains, unchained, issues } = decomposeChains(nodes, edges);

    expect(chains).toHaveLength(1);
    expect(chains[0].links.map((link) => link.nodeId)).toEqual([
      "in",
      "tls",
      "out",
    ]);
    expect(chains[0].headNodeId).toBe("in");
    expect(chains[0].tailNodeId).toBe("out");
    expect(unchained).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("gives every link the correct prev and next inside its own chain", () => {
    const { nodes, edges } = line(
      ["a", "TcpListener"],
      ["b", "TlsClient"],
      ["c", "MuxClient"],
      ["d", "TcpConnector"],
    );

    const [chain] = decomposeChains(nodes, edges).chains;

    expect(chain.links[0].prevNodeId).toBeUndefined();
    expect(chain.links[3].nextNodeId).toBeUndefined();
    for (let index = 0; index < chain.links.length - 1; index += 1) {
      expect(chain.links[index].nextNodeId).toBe(chain.links[index + 1].nodeId);
      expect(chain.links[index + 1].prevNodeId).toBe(chain.links[index].nodeId);
      expect(chain.links[index + 1].prevEdgeId).toBe(
        chain.links[index].nextEdgeId,
      );
    }
  });

  /**
   * BITSWAP_MUX_IRAN3 is the canonical two-chain config: a user path
   * (TcpListener -> MuxClient -> TcpConnector) and an independent spoof path
   * (TunDevice -> IpOverrider -> PacketSplitStream -> two branches).
   */
  it("separates the two independent chains of BITSWAP_MUX_IRAN3", () => {
    const graph = realGraph("BITSWAP_MUX_IRAN3__config_iran");
    const { chains } = decomposeChains(graph.nodes, graph.edges);

    const heads = [...new Set(chains.map((chain) => chain.headNodeId))].sort();
    expect(heads).toEqual(["my tun", "users_inbound"]);

    const userChain = chains.find((chain) => chain.headNodeId === "users_inbound")!;
    const spoofChains = chains.filter((chain) => chain.headNodeId === "my tun");
    const userNodes = new Set(userChain.links.map((link) => link.nodeId));
    for (const chain of spoofChains)
      for (const link of chain.links) expect(userNodes.has(link.nodeId)).toBe(false);
  });

  /**
   * PacketSplitStream declares only kNodeFlagChainEnd, so a chain starting at
   * the split node (or at the branch target) would trip the core's
   * "start of chain without kNodeFlagChainHead" rule. Each branch therefore
   * carries the shared prefix and keeps the real ChainHead at its head.
   */
  it("duplicates the shared prefix for each PacketSplitStream branch", () => {
    const graph = realGraph("BITSWAP_MUX_IRAN3__config_iran");
    const branches = decomposeChains(graph.nodes, graph.edges).chains.filter(
      (chain) => chain.branch,
    );

    expect(branches).toHaveLength(2);
    expect(branches.map((chain) => chain.branch!.handle).sort()).toEqual([
      "down",
      "up",
    ]);
    for (const chain of branches) {
      expect(chain.headNodeId).toBe("my tun");
      expect(chain.links.map((link) => link.nodeId)).toContain("splitter");
      expect(chain.branch!.splitNodeId).toBe("splitter");
    }
    expect(branches[0].id).not.toBe(branches[1].id);
  });

  /**
   * The core's "node is not chained" rule assumes a finished config. In an
   * editor, a node dropped a second ago has no edges — validator.ts already
   * reports that as info/isolated-node, so it is not a chain and not an error.
   */
  it("keeps a node with no edges out of every chain without reporting it", () => {
    const nodes = [node("lonely", "TcpListener")];

    const { chains, unchained, issues } = decomposeChains(nodes, []);

    expect(chains).toEqual([]);
    expect(unchained).toEqual(["lonely"]);
    expect(issues).toEqual([]);
  });

  it("reports chain-too-long past kMaxChainLen", () => {
    const types: [string, string][] = Array.from(
      { length: MAX_CHAIN_LEN + 6 },
      (_, index) => [`n${index}`, "ObfuscatorClient"],
    );
    const { nodes, edges } = line(...types);

    const { chains, issues } = decomposeChains(nodes, edges);

    expect(issues.map((item) => item.code)).toContain("chain-too-long");
    expect(chains.some((chain) => chain.truncated)).toBe(true);
    expect(chains[0].links.length).toBeLessThanOrEqual(MAX_CHAIN_LEN);
  });

  it("reports chain-cycle instead of looping forever", () => {
    const nodes = [node("a", "TcpListener"), node("b", "TcpConnector")];
    const edges = [edge("a", "b"), edge("b", "a")];

    const { issues } = decomposeChains(nodes, edges);

    expect(issues.map((item) => item.code)).toContain("chain-cycle");
    expect(issues[0].severity).toBe("error");
  });

  it("decomposes every real topology without a structural issue", () => {
    for (const name of REAL_CONFIG_NAMES) {
      const graph = realGraph(name);
      const { chains, issues } = decomposeChains(graph.nodes, graph.edges);
      expect({ name, issues: issues.map((item) => item.code) }).toEqual({
        name,
        issues: [],
      });
      expect(chains.length).toBeGreaterThan(0);
    }
  });

  it("indexes every chain a node belongs to", () => {
    const graph = realGraph("BITSWAP_MUX_IRAN3__config_iran");
    const { chainsByNode } = decomposeChains(graph.nodes, graph.edges);

    // The prefix before the split is shared by both branch chains.
    expect(chainsByNode.get("my tun")).toHaveLength(2);
    expect(chainsByNode.get("users_inbound")).toHaveLength(1);
  });
});

describe("chainEntryNodeId", () => {
  it("prefers a chain head over graph array order", () => {
    const { nodes, edges } = line(
      ["tun", "TunDevice"],
      ["over", "IpOverrider"],
      ["raw", "RawSocket"],
    );
    // nodes[0] is deliberately the mid-chain node, which is what the old
    // `nodes[0]?.id` would have picked.
    const shuffled = [nodes[1], nodes[2], nodes[0]];

    expect(
      chainEntryNodeId(decomposeChains(shuffled, edges), shuffled),
    ).toBe("tun");
  });

  it("falls back to an unchained node when there is no chain", () => {
    const nodes = [node("lonely", "TlsClient")];
    expect(chainEntryNodeId(decomposeChains(nodes, []), nodes)).toBe("lonely");
  });

  it("is undefined on an empty graph", () => {
    expect(chainEntryNodeId(decomposeChains([], []), [])).toBeUndefined();
  });
});

describe("findPaths on top of the decomposition", () => {
  it("still returns the longest path first", () => {
    const { nodes, edges } = line(
      ["a", "TcpListener"],
      ["b", "TlsClient"],
      ["c", "TcpConnector"],
    );
    const withExtra = [...nodes, node("lonely", "BlackHole")];

    const paths = findPaths(withExtra, edges);

    expect(paths[0]).toEqual(["a", "b", "c"]);
    expect(paths.at(-1)).toEqual(["lonely"]);
  });
});
