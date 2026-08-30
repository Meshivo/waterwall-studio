import type { StudioEdge, StudioNode, ValidationIssue } from "../types";
import { getDefinition } from "./schema";

/** `kMaxChainLen` in WaterWall-main/ww/net/chain.h:16. */
export const MAX_CHAIN_LEN = 64;

/** One position in a linear chain. prev/next are resolved *within this chain*. */
export interface ChainLink {
  nodeId: string;
  prevNodeId?: string;
  nextNodeId?: string;
  /** Edge realising prevNodeId -> nodeId. */
  prevEdgeId?: string;
  /** Edge realising nodeId -> nextNodeId. */
  nextEdgeId?: string;
  /** sourceHandle of nextEdgeId: "next", "up" or "down". */
  nextHandle?: string;
}

export interface Chain {
  /** `${headNodeId}` plus the handle taken at each split, e.g. "my tun|up". */
  id: string;
  links: ChainLink[];
  headNodeId: string;
  tailNodeId: string;
  /** Set when this chain followed a PacketSplitStream branch. */
  branch?: { splitNodeId: string; handle: string };
  /** Hit MAX_CHAIN_LEN — the chain is reported, not solvable. */
  truncated: boolean;
}

export interface ChainDecomposition {
  chains: Chain[];
  /** nodeId -> every chain containing it; a shared prefix appears in several. */
  chainsByNode: Map<string, Chain[]>;
  /** Nodes with no incident edge. Not part of any chain. */
  unchained: string[];
  /** chain-too-long and chain-cycle only; layer rules belong to the solver. */
  issues: ValidationIssue[];
}

/** Deterministic branch order so chain ids and messages are reproducible. */
const HANDLE_ORDER = ["next", "up", "down"];
const handleRank = (handle?: string) => {
  const index = HANDLE_ORDER.indexOf(handle ?? "next");
  return index === -1 ? HANDLE_ORDER.length : index;
};

/**
 * Split the editor's DAG into the linear chains the core solver works on.
 *
 * The only branch source is PacketSplitStream — the schema gives no other type
 * more than one output, and every port is maxConnections: 1, so fan-in through
 * one handle is impossible too.
 *
 * Each branch carries a full copy of the shared prefix rather than starting at
 * the split node. PacketSplitStream declares only kNodeFlagChainEnd, so a chain
 * beginning there would trip the core's "start of chain without kNodeFlagChainHead"
 * rule (node_layer_solver.c:390) — as would a branch starting at the
 * IpOverrider after it. Duplicating the prefix keeps the real ChainHead at the
 * head. The cost is solving the prefix twice, which is what the core does for
 * separate chains anyway.
 */
export function decomposeChains(
  nodes: StudioNode[],
  edges: StudioEdge[],
): ChainDecomposition {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, StudioEdge[]>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.add(edge.target);
  }
  for (const list of outgoing.values())
    list.sort(
      (a, b) =>
        handleRank(a.sourceHandle ?? undefined) -
          handleRank(b.sourceHandle ?? undefined) || a.id.localeCompare(b.id),
    );

  const touched = new Set<string>([...incoming, ...outgoing.keys()]);
  const unchained = nodes
    .filter((node) => !touched.has(node.id))
    .map((node) => node.id);

  const chains: Chain[] = [];
  const issues: ValidationIssue[] = [];
  const visited = new Set<string>();

  const emit = (links: ChainLink[], branchPath: string[], truncated: boolean) => {
    if (!links.length) return;
    // Back-fill the reverse direction in one pass: the core's model is
    // bidirectional, findPaths' forward-only walk is not enough for the solver.
    for (let index = 1; index < links.length; index += 1) {
      links[index].prevNodeId = links[index - 1].nodeId;
      links[index].prevEdgeId = links[index - 1].nextEdgeId;
    }
    const head = links[0].nodeId;
    const splitIndex = branchPath.length
      ? links.findIndex((link) => link.nextHandle === branchPath[0])
      : -1;
    chains.push({
      id: [head, ...branchPath].join("|"),
      links,
      headNodeId: head,
      tailNodeId: links[links.length - 1].nodeId,
      branch: branchPath.length
        ? {
            splitNodeId: links[splitIndex >= 0 ? splitIndex : 0].nodeId,
            handle: branchPath[branchPath.length - 1],
          }
        : undefined,
      truncated,
    });
  };

  const walk = (
    nodeId: string,
    prefix: ChainLink[],
    path: Set<string>,
    branchPath: string[],
  ) => {
    visited.add(nodeId);
    if (path.has(nodeId)) {
      issues.push(
        chainIssue(
          "chain-cycle",
          "زنجیره چرخه دارد",
          `مسیر از «${nodeId}» به خودش برمی‌گردد؛ زنجیره‌ی چرخه‌ای سر مشخص ندارد و اجرا نمی‌شود.`,
          nodeId,
          `cycle at ${nodeId}`,
        ),
      );
      return;
    }
    if (prefix.length >= MAX_CHAIN_LEN) {
      issues.push(
        chainIssue(
          "chain-too-long",
          "زنجیره از حد مجاز بلندتر است",
          `هسته حداکثر ${MAX_CHAIN_LEN} نود در یک زنجیره می‌پذیرد؛ «${nodeId}» از این حد عبور می‌کند.`,
          nodeId,
          `kMaxChainLen=${MAX_CHAIN_LEN} exceeded`,
        ),
      );
      emit([...prefix], branchPath, true);
      return;
    }
    const out = outgoing.get(nodeId) ?? [];
    if (!out.length) {
      emit([...prefix, { nodeId }], branchPath, false);
      return;
    }
    const nextPath = new Set(path).add(nodeId);
    for (const edge of out)
      walk(
        edge.target,
        [
          ...prefix,
          {
            nodeId,
            nextNodeId: edge.target,
            nextEdgeId: edge.id,
            nextHandle: edge.sourceHandle ?? "next",
          },
        ],
        nextPath,
        out.length > 1 ? [...branchPath, edge.sourceHandle ?? "next"] : branchPath,
      );
  };

  for (const node of nodes)
    if (touched.has(node.id) && !incoming.has(node.id))
      walk(node.id, [], new Set(), []);

  // A component that is entirely a cycle has no root, so nothing above reached
  // it. Enter at its lowest id purely to report the cycle.
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id)))
    if (touched.has(node.id) && !visited.has(node.id))
      walk(node.id, [], new Set(), []);

  const chainsByNode = new Map<string, Chain[]>();
  for (const chain of chains)
    for (const link of chain.links)
      chainsByNode.set(link.nodeId, [
        ...(chainsByNode.get(link.nodeId) ?? []),
        chain,
      ]);

  return { chains, chainsByNode, unchained, issues };
}

/**
 * Which node the canvas should focus. Replaces `nodes[0]?.id`, which was array
 * order, not topology. "Entry" means the kNodeFlagChainHead flag rather than
 * "has no inputs" — TunDevice, RawSocket and Bridge all accept input yet start
 * every IP-spoof topology. recommender.ts already uses the flag this way.
 */
export function chainEntryNodeId(
  decomposition: ChainDecomposition,
  nodes: StudioNode[],
): string | undefined {
  const byLength = [...decomposition.chains].sort(
    (a, b) => b.links.length - a.links.length,
  );
  const isChainHead = (nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    return node ? getDefinition(node.data.type).flags.chainHead : false;
  };
  return (
    byLength.find((chain) => isChainHead(chain.headNodeId))?.headNodeId ??
    byLength[0]?.headNodeId ??
    decomposition.unchained[0]
  );
}

function chainIssue(
  code: string,
  title: string,
  message: string,
  nodeId: string,
  technical: string,
): ValidationIssue {
  return {
    id: `${code}-${nodeId}`,
    severity: "error",
    code,
    title,
    message,
    technical,
    nodeId,
    action: { label: "نمایش روی بوم", type: "select-node" },
  };
}
