import type {
  NodeDefinition,
  StudioEdge,
  StudioNode,
  ValidationIssue,
} from "../types";
import type { Chain, ChainDecomposition, ChainLink } from "./chains";
import { decomposeChains } from "./chains";
import { LG, layerGroupToString } from "./layerGroups";
import { getDefinition } from "./schema";

/**
 * A faithful port of WaterWall-main/ww/net/node_layer_solver.c.
 *
 * The point of this module is that it says exactly what the core says. A neater
 * algorithm — union-find with parity would decide the same 2-colouring — would
 * be a behavioural fork, and a validator that disagrees with the runtime is
 * worse than none. Every phase below cites the C line it mirrors.
 *
 * One deliberate omission: registered runtime relations (c:675-789). Tunnels
 * register those from onChain hooks at startup; a config on a canvas has no
 * runtime, so there is nothing to register. Their message variants (the
 * `secondary_tunnel != NULL` branches) are therefore unreachable here and the
 * single-node wording is used throughout.
 */

// --- The domain lattice (node_layer_solver.h:12-19) -------------------------

export const Empty = 0,
  L3 = 1,
  L4 = 2,
  Any = 3;
export type LayerDomain = 0 | 1 | 2 | 3;

/**
 * nodeLayerDomainFlip (node_layer_solver.h:24). Deliberately NOT `~d & 3`:
 * flip(Any) === Any and flip(Empty) === Empty. Because of this, an Opposite
 * relation between two unconstrained edges narrows nothing — it records the
 * relationship without ever forcing an orientation.
 */
export const flipDomain = (domain: LayerDomain): LayerDomain =>
  domain === L3 ? L4 : domain === L4 ? L3 : domain;

/** nodeLayerGroupToDomain (node_layer_solver.h:43) — only the L3/L4 bits. */
export const groupToDomain = (mask: number): LayerDomain =>
  (((mask & LG.L3) !== 0 ? L3 : 0) |
    ((mask & LG.L4) !== 0 ? L4 : 0)) as LayerDomain;

/** nodeLayerDomainToString (node_layer_solver.h:60). */
export const domainToString = (domain: LayerDomain) =>
  domain === Empty
    ? "{}"
    : domain === L3
      ? "L3"
      : domain === L4
        ? "L4"
        : "{L3, L4}";

// --- Status and results -----------------------------------------------------

export type SolverCode =
  | "Ok"
  | "MetadataShape"
  | "Structural"
  | "RelativeMissingSide"
  | "Conflict"
  | "Convergence";

export interface SolverStatus {
  code: SolverCode;
  /** The C wording verbatim, untruncated — there is no message[512] here. */
  message: string;
  primaryNodeId?: string;
  secondaryNodeId?: string;
  edgeId?: string;
}

const OK: SolverStatus = { code: "Ok", message: "" };

export interface SolvedChain {
  chainId: string;
  ok: boolean;
  status: SolverStatus;
  /** nodeId -> domain of the edge entering it. Empty = no solved domain. */
  resolvedPrevLayer: Map<string, LayerDomain>;
  resolvedNextLayer: Map<string, LayerDomain>;
  containsPacketNode: boolean;
}

export interface LayerSolution {
  decomposition: ChainDecomposition;
  chains: SolvedChain[];
  /** Merged per-node view for the UI. */
  resolvedByNode: Map<string, { prev: LayerDomain; next: LayerDomain }>;
  containsPacketNode: boolean;
  issues: ValidationIssue[];
}

// --- Internal solver model --------------------------------------------------

/**
 * The solved variable is the *edge*, not the node — a node has no layer, each
 * adjacency does. `fromParticipates`/`toParticipates` record which endpoint
 * actually declared the link, and they gate both relation building and result
 * caching.
 */
interface SolverEdge {
  /** Replaces C pointer identity (c:58 findEdge matches both endpoints). */
  key: string;
  fromId: string;
  toId: string;
  fromParticipates: boolean;
  toParticipates: boolean;
  domain: LayerDomain;
  graphEdgeId?: string;
}

type RelationKind = "SameAs" | "Opposite";

interface SolverRelation {
  kind: RelationKind;
  left: SolverEdge;
  right: SolverEdge;
  nodeId: string;
}

// --- Pass 1: per-node metadata (c:117-279) ----------------------------------

/**
 * Pure shape check over one node definition, with no chain context.
 *
 * The side asymmetry is the whole point: layer_group_next_node may only
 * reference *prev* (SameAsPrev / OppositePrev) and layer_group_prev_node only
 * *next*. Legality is exact equality against a whitelist of eight forms, never
 * a bit test.
 */
export function validateNodeMetadata(
  definition: NodeDefinition,
  nodeLabel: string,
): SolverStatus {
  const shape = (message: string): SolverStatus => ({
    code: "MetadataShape",
    message,
  });
  const { own, prev, next } = definition.layerGroups;
  const relativeFlags =
    LG.SameAsNext | LG.SameAsPrev | LG.OppositeNext | LG.OppositePrev;

  // 1. layer_group must be exactly one of None, 3, 4, Anything.
  if (own !== LG.None && own !== LG.L3 && own !== LG.L4 && own !== LG.Anything)
    return shape(
      (own & relativeFlags) !== 0
        ? `node ("${nodeLabel}") specifies layer_group with forbidden relative layer flags (SameAs/Opposite)`
        : `node ("${nodeLabel}") specifies invalid layer_group (0x${own.toString(16)})`,
    );

  // 2. layer_group_next_node — eight exact legal forms.
  const nextLegal =
    next === LG.None ||
    next === LG.L3 ||
    next === LG.L4 ||
    next === LG.Anything ||
    next === LG.SameAsPrev ||
    next === (LG.L3 | LG.OppositePrev) ||
    next === (LG.L4 | LG.OppositePrev) ||
    next === (LG.Anything | LG.OppositePrev);
  if (!nextLegal)
    return shape(
      (next & (LG.SameAsNext | LG.OppositeNext)) !== 0
        ? `node ("${nodeLabel}") specifies layer_group_next_node with forbidden forward-referencing relative flag`
        : (next & LG.OppositePrev) !== 0 && (next & LG.Anything) === 0
          ? `node ("${nodeLabel}") specifies layer_group_next_node with Opposite flag without base layer group`
          : `node ("${nodeLabel}") specifies invalid layer_group_next_node mask (0x${next.toString(16)})`,
    );

  // 3. layer_group_prev_node — the mirror whitelist.
  const prevLegal =
    prev === LG.None ||
    prev === LG.L3 ||
    prev === LG.L4 ||
    prev === LG.Anything ||
    prev === LG.SameAsNext ||
    prev === (LG.L3 | LG.OppositeNext) ||
    prev === (LG.L4 | LG.OppositeNext) ||
    prev === (LG.Anything | LG.OppositeNext);
  if (!prevLegal)
    return shape(
      (prev & (LG.SameAsPrev | LG.OppositePrev)) !== 0
        ? `node ("${nodeLabel}") specifies layer_group_prev_node with forbidden backward-referencing relative flag`
        : (prev & LG.OppositeNext) !== 0 && (prev & LG.Anything) === 0
          ? `node ("${nodeLabel}") specifies layer_group_prev_node with Opposite flag without base layer group`
          : `node ("${nodeLabel}") specifies invalid layer_group_prev_node mask (0x${prev.toString(16)})`,
    );

  // 4. Capability / mask consistency.
  if (!definition.capabilities.next && next !== LG.None)
    return shape(
      `node ("${nodeLabel}") specifies can_have_next = false but specifies layer_group_next_node != kNodeLayerNone`,
    );
  if (!definition.capabilities.prev && prev !== LG.None)
    return shape(
      `node ("${nodeLabel}") specifies can_have_prev = false but specifies layer_group_prev_node != kNodeLayerNone`,
    );

  return OK;
}

// --- Pass 2: per chain (c:281-981) ------------------------------------------

/**
 * Port of nodeLayerSolveChain. Fails fast within a chain exactly as C does:
 * every later phase reads state an earlier failed phase would have written.
 */
export function solveChain(
  chain: Chain,
  nodesById: Map<string, StudioNode>,
  /**
   * Testing seam. Production always resolves through the shipped schema, but
   * some C rules are unreachable with the current node set — RelativeMissingSide
   * needs a node that declares Opposite *and* carries ChainHead/ChainEnd, and
   * WireGuardDevice (the only Opposite user) carries neither, so the structural
   * boundary rule always fires first. Injecting a definition is the only way to
   * cover the rule without forking the algorithm.
   */
  resolve: (type: string) => NodeDefinition = getDefinition,
): SolvedChain {
  const empty = (status: SolverStatus): SolvedChain => ({
    chainId: chain.id,
    ok: status.code === "Ok",
    status,
    resolvedPrevLayer: new Map(),
    resolvedNextLayer: new Map(),
    containsPacketNode: false,
  });

  const label = (nodeId?: string) => {
    const node = nodeId ? nodesById.get(nodeId) : undefined;
    return node?.data.name || node?.data.type || "unnamed";
  };
  const define = (nodeId: string) =>
    resolve(nodesById.get(nodeId)!.data.type);

  // 2a. Structure (c:307-530), in C order, first failure wins.
  for (const [index, link] of chain.links.entries()) {
    const node = nodesById.get(link.nodeId);
    if (!node)
      return empty({
        code: "Structural",
        message: `chain contains NULL tunnel or node at index ${index}`,
        primaryNodeId: link.nodeId,
      });

    const definition = resolve(node.data.type);
    const name = label(link.nodeId);
    const structural = (
      message: string,
      secondaryNodeId?: string,
      edgeId?: string,
    ): SolvedChain =>
      empty({
        code: "Structural",
        message,
        primaryNodeId: link.nodeId,
        secondaryNodeId,
        edgeId,
      });

    // The C rule `t->next == NULL && t->prev == NULL` (c:327, "is not chained")
    // is unreachable here: decomposeChains only emits nodes with an incident
    // edge, and a node with none lands in `unchained`, which validator.ts
    // already reports as info/isolated-node. Turning a freshly dropped node red
    // would make the normal build flow permanently broken.

    if (
      !definition.flags.chainHead &&
      !definition.flags.chainEnd &&
      definition.flags.noChain &&
      (link.nextNodeId || link.prevNodeId)
    )
      return structural(
        `node ("${name}") has flag kNodeFlagNoChain but is chained`,
      );

    if (link.nextNodeId && !definition.capabilities.next)
      return structural(
        `node ("${name}") has next node ("${label(link.nextNodeId)}") but specifies can_have_next = false`,
        link.nextNodeId,
        link.nextEdgeId,
      );

    if (link.prevNodeId && !definition.capabilities.prev)
      return structural(
        `node ("${name}") has previous node ("${label(link.prevNodeId)}") but specifies can_have_prev = false`,
        link.prevNodeId,
        link.prevEdgeId,
      );

    if (!link.nextNodeId && !definition.flags.chainEnd && !definition.flags.noChain)
      return structural(
        `node ("${name}") at the end of the chain but does not have flag kNodeFlagChainEnd`,
      );

    if (!link.prevNodeId && !definition.flags.chainHead && !definition.flags.noChain)
      return structural(
        `node ("${name}") at the start of the chain but does not have flag kNodeFlagChainHead`,
      );

    // The cross-chain checks (c:404, c:418) are structurally satisfied — chains
    // are built by walking — but kept as cheap invariant guards.
    const inChain = new Set(chain.links.map((item) => item.nodeId));
    if (link.nextNodeId && !inChain.has(link.nextNodeId))
      return structural(
        `node ("${name}") next node ("${label(link.nextNodeId)}") is not in the same assembled chain`,
        link.nextNodeId,
      );
    if (link.prevNodeId && !inChain.has(link.prevNodeId))
      return structural(
        `node ("${name}") previous node ("${label(link.prevNodeId)}") is not in the same assembled chain`,
        link.prevNodeId,
      );

    if (link.nextNodeId && definition.layerGroups.next === LG.None)
      return structural(
        `node ("${name}") is linked to next node ("${label(link.nextNodeId)}") but specifies layer_group_next_node = kNodeLayerNone`,
        link.nextNodeId,
        link.nextEdgeId,
      );
    if (link.prevNodeId && definition.layerGroups.prev === LG.None)
      return structural(
        `node ("${name}") is linked to previous node ("${label(link.prevNodeId)}") but specifies layer_group_prev_node = kNodeLayerNone`,
        link.prevNodeId,
        link.prevEdgeId,
      );

    // SameAs is conditional — a missing side simply adds no constraint, which is
    // what lets ObfuscatorClient sit at either end of a chain. Opposite is
    // strict and demands both sides (c:469-529).
    const missingSide = (
      field: "next" | "prev",
      side: "next" | "previous",
    ): SolvedChain =>
      empty({
        code: "RelativeMissingSide",
        message: `node ("${name}") specifies layer_group_${field}_node as ${layerGroupToString(definition.layerGroups[field])} but has no ${side} node`,
        primaryNodeId: link.nodeId,
      });

    if ((definition.layerGroups.next & LG.OppositePrev) !== 0) {
      if (!link.nextNodeId) return missingSide("next", "next");
      if (!link.prevNodeId) return missingSide("next", "previous");
    }
    if ((definition.layerGroups.prev & LG.OppositeNext) !== 0) {
      if (!link.prevNodeId) return missingSide("prev", "previous");
      if (!link.nextNodeId) return missingSide("prev", "next");
    }
  }

  // 2b. Build EVERY edge before ANY relation (c:532-549). Insertion order is
  // preserved so messages are reproducible.
  const edgesByKey = new Map<string, SolverEdge>();
  const edgeList: SolverEdge[] = [];
  const findOrAdd = (fromId: string, toId: string, graphEdgeId?: string) => {
    const key = `${fromId}->${toId}`;
    const existing = edgesByKey.get(key);
    if (existing) {
      existing.graphEdgeId ??= graphEdgeId;
      return existing;
    }
    const created: SolverEdge = {
      key,
      fromId,
      toId,
      fromParticipates: false,
      toParticipates: false,
      domain: Any,
      graphEdgeId,
    };
    edgesByKey.set(key, created);
    edgeList.push(created);
    return created;
  };
  for (const link of chain.links) {
    if (link.nextNodeId)
      findOrAdd(link.nodeId, link.nextNodeId, link.nextEdgeId).fromParticipates =
        true;
    if (link.prevNodeId)
      findOrAdd(link.prevNodeId, link.nodeId, link.prevEdgeId).toParticipates =
        true;
  }

  // 2c. Seed domains (c:551-639).
  for (const edge of edgeList) {
    if (edge.fromParticipates) {
      const from = define(edge.fromId);
      edge.domain = (edge.domain & groupToDomain(from.layerGroups.own)) as LayerDomain;
      if ((from.layerGroups.next & LG.Anything) !== 0)
        edge.domain = (edge.domain &
          groupToDomain(from.layerGroups.next & LG.Anything)) as LayerDomain;
      if (edge.domain === Empty)
        return empty({
          code: "Conflict",
          message: `node ("${label(edge.fromId)}") (layer ${layerGroupToString(from.layerGroups.own)}) requires next node layer ${layerGroupToString(from.layerGroups.next)}, but edge domain resolved to empty`,
          primaryNodeId: edge.fromId,
          secondaryNodeId: edge.toId,
          edgeId: edge.graphEdgeId,
        });
    }

    if (edge.toParticipates) {
      const to = define(edge.toId);
      const from = define(edge.fromId);
      const toDomain = groupToDomain(to.layerGroups.own);
      // Checked before assignment so the pre-narrowing domain can be printed.
      if ((edge.domain & toDomain) === Empty)
        return empty({
          code: "Conflict",
          message: edge.fromParticipates
            ? `node ("${label(edge.fromId)}") (layer ${layerGroupToString(from.layerGroups.own)}) is adjacent to next node ("${label(edge.toId)}") with incompatible layer ${layerGroupToString(to.layerGroups.own)}`
            : `node ("${label(edge.toId)}") (layer ${layerGroupToString(to.layerGroups.own)}) requires previous node layer ${layerGroupToString(to.layerGroups.prev)}, but previous node ("${label(edge.fromId)}") has incompatible layer ${layerGroupToString(from.layerGroups.own)}`,
          primaryNodeId: edge.fromParticipates ? edge.fromId : edge.toId,
          secondaryNodeId: edge.fromParticipates ? edge.toId : edge.fromId,
          edgeId: edge.graphEdgeId,
        });
      edge.domain = (edge.domain & toDomain) as LayerDomain;

      if ((to.layerGroups.prev & LG.Anything) !== 0) {
        const required = groupToDomain(to.layerGroups.prev & LG.Anything);
        if ((edge.domain & required) === Empty)
          return empty({
            code: "Conflict",
            message: `node ("${label(edge.toId)}") (layer ${layerGroupToString(to.layerGroups.own)}) requires previous node layer ${layerGroupToString(to.layerGroups.prev)}, but previous node ("${label(edge.fromId)}") has incompatible layer ${layerGroupToString(from.layerGroups.own)}`,
            primaryNodeId: edge.toId,
            secondaryNodeId: edge.fromId,
            edgeId: edge.graphEdgeId,
          });
        edge.domain = (edge.domain & required) as LayerDomain;
      }
    }
  }

  // 2d. Derive relations from node metadata (c:641-673). Only for links with
  // both sides, and only when both edges actually participate.
  const relations: SolverRelation[] = [];
  const addRelation = (
    kind: RelationKind,
    left: SolverEdge,
    right: SolverEdge,
    nodeId: string,
  ) => {
    // Dedupe by edge identity in either order — this is what collapses
    // WireGuardDevice's two Opposite declarations into one relation.
    const duplicate = relations.some(
      (relation) =>
        relation.kind === kind &&
        ((relation.left === left && relation.right === right) ||
          (relation.left === right && relation.right === left)),
    );
    if (!duplicate) relations.push({ kind, left, right, nodeId });
  };
  for (const link of chain.links) {
    if (!link.prevNodeId || !link.nextNodeId) continue;
    const ePrev = edgesByKey.get(`${link.prevNodeId}->${link.nodeId}`);
    const eNext = edgesByKey.get(`${link.nodeId}->${link.nextNodeId}`);
    if (!ePrev || !eNext || !ePrev.toParticipates || !eNext.fromParticipates)
      continue;
    const { prev, next } = define(link.nodeId).layerGroups;
    // SameAs matches exactly (it is a standalone legal form); Opposite is a bit
    // test (it is always ORed with a base group).
    if (next === LG.SameAsPrev) addRelation("SameAs", ePrev, eNext, link.nodeId);
    if ((next & LG.OppositePrev) !== 0)
      addRelation("Opposite", ePrev, eNext, link.nodeId);
    if (prev === LG.SameAsNext) addRelation("SameAs", ePrev, eNext, link.nodeId);
    if ((prev & LG.OppositeNext) !== 0)
      addRelation("Opposite", ePrev, eNext, link.nodeId);
  }

  // 2e. Monotone fixpoint (c:791-908).
  const maxIterations = 2 * edgeList.length + 2;
  let changed = true;
  let iterations = 0;
  while (changed) {
    changed = false;
    iterations += 1;
    if (iterations > maxIterations)
      return empty({
        code: "Convergence",
        message: `layer solver did not converge within ${maxIterations} iterations`,
      });

    for (const relation of relations) {
      const { left, right } = relation;
      const owner = define(relation.nodeId);
      const conflict = (requirement: string): SolvedChain =>
        empty({
          code: "Conflict",
          message: `node ("${label(relation.nodeId)}") (layer ${layerGroupToString(owner.layerGroups.own)}) requires ${requirement}, but sides resolved to incompatible domains (${domainToString(left.domain)} and ${domainToString(right.domain)})`,
          primaryNodeId: relation.nodeId,
        });

      if (relation.kind === "SameAs") {
        const intersection = (left.domain & right.domain) as LayerDomain;
        if (intersection === Empty) return conflict("same layer on both sides");
        if (left.domain !== intersection) {
          left.domain = intersection;
          changed = true;
        }
        if (right.domain !== intersection) {
          right.domain = intersection;
          changed = true;
        }
      } else {
        const newLeft = (left.domain & flipDomain(right.domain)) as LayerDomain;
        const newRight = (right.domain & flipDomain(left.domain)) as LayerDomain;
        if (newLeft === Empty || newRight === Empty)
          return conflict("opposite layers on both sides");
        if (left.domain !== newLeft) {
          left.domain = newLeft;
          changed = true;
        }
        if (right.domain !== newRight) {
          right.domain = newRight;
          changed = true;
        }
      }
    }
  }

  // 2f. Cache (c:910-933). Empty here means "this side has no solved domain",
  // which is not the same as a conflict.
  const resolvedPrevLayer = new Map<string, LayerDomain>();
  const resolvedNextLayer = new Map<string, LayerDomain>();
  for (const link of chain.links) {
    const prevEdge = link.prevNodeId
      ? edgesByKey.get(`${link.prevNodeId}->${link.nodeId}`)
      : undefined;
    const nextEdge = link.nextNodeId
      ? edgesByKey.get(`${link.nodeId}->${link.nextNodeId}`)
      : undefined;
    resolvedPrevLayer.set(
      link.nodeId,
      prevEdge?.toParticipates ? prevEdge.domain : Empty,
    );
    resolvedNextLayer.set(
      link.nodeId,
      nextEdge?.fromParticipates ? nextEdge.domain : Empty,
    );
  }

  // 2g. containsPacketNode (c:935-977) — three short-circuited conditions.
  const containsPacketNode =
    edgeList.some((edge) => edge.domain === L3) ||
    chain.links.some((link) => {
      const { own, prev, next } = define(link.nodeId).layerGroups;
      return (
        own === LG.L3 ||
        (Boolean(link.nextNodeId) &&
          (next & LG.L3) === LG.L3 &&
          (next & LG.L4) === 0) ||
        (Boolean(link.prevNodeId) &&
          (prev & LG.L3) === LG.L3 &&
          (prev & LG.L4) === 0)
      );
    }) ||
    // An Opposite relation guarantees one of its sides is L3 even when the
    // orientation stays unresolved.
    relations.some((relation) => relation.kind === "Opposite");

  return {
    chainId: chain.id,
    ok: true,
    status: OK,
    resolvedPrevLayer,
    resolvedNextLayer,
    containsPacketNode,
  };
}

// --- Pass 3: whole graph ----------------------------------------------------

export function solveGraph(
  nodes: StudioNode[],
  edges: StudioEdge[],
): LayerSolution {
  const decomposition = decomposeChains(nodes, edges);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const issues: ValidationIssue[] = [...decomposition.issues];

  /**
   * Metadata is a property of the *definition*, so it is checked once per type
   * and every failure is reported. C fuses this into the structural loop and
   * returns on the first one; here a shape failure means generate-schema.mjs
   * regressed, which the user should see in full rather than one at a time.
   */
  const checkedTypes = new Map<string, SolverStatus>();
  for (const node of nodes) {
    const type = node.data.type;
    if (checkedTypes.has(type)) continue;
    const status = validateNodeMetadata(
      getDefinition(type),
      node.data.name || type,
    );
    checkedTypes.set(type, status);
    if (status.code !== "Ok")
      issues.push(solverIssue(status, node.id, "خطای schema نود"));
  }

  const solved: SolvedChain[] = [];
  for (const chain of decomposition.chains) {
    if (chain.truncated) continue;
    // Chains fail independently: a user with two topologies must see both.
    const result = solveChain(chain, nodesById);
    solved.push(result);
    if (!result.ok) issues.push(solverIssue(result.status));
  }

  const resolvedByNode = new Map<
    string,
    { prev: LayerDomain; next: LayerDomain }
  >();
  for (const chain of solved)
    for (const [nodeId, domain] of chain.resolvedPrevLayer) {
      const current = resolvedByNode.get(nodeId);
      const next = chain.resolvedNextLayer.get(nodeId) ?? Empty;
      // A prefix node appears in several chains. Intersect: when the two
      // disagree the result is Empty, which honestly reads as "unknown" and
      // draws no badge, rather than a confident wrong one.
      resolvedByNode.set(nodeId, {
        prev: current ? ((current.prev & domain) as LayerDomain) : domain,
        next: current ? ((current.next & next) as LayerDomain) : next,
      });
    }

  const seen = new Set<string>();
  const deduped = issues.filter((item) =>
    seen.has(item.id) ? false : (seen.add(item.id), true),
  );

  return {
    decomposition,
    chains: solved,
    resolvedByNode,
    containsPacketNode: solved.some((chain) => chain.containsPacketNode),
    issues: deduped,
  };
}

const CODE_TO_ISSUE: Record<
  Exclude<SolverCode, "Ok">,
  { code: string; title: string; message: string }
> = {
  MetadataShape: {
    code: "layer-metadata-shape",
    title: "متادیتای لایه نامعتبر است",
    message: "تعریف این نوع نود در schema با قواعد هسته نمی‌خواند.",
  },
  Structural: {
    code: "layer-structural",
    title: "ساختار زنجیره نامعتبر است",
    message: "چیدمان این نود در زنجیره با قواعد ساختاری هسته نمی‌خواند.",
  },
  RelativeMissingSide: {
    code: "layer-relative-missing-side",
    title: "یک سمت زنجیره غایب است",
    message:
      "این نود لایه‌ی خود را نسبت به هر دو همسایه تعریف می‌کند، پس هر دو باید وجود داشته باشند.",
  },
  Conflict: {
    code: "layer-conflict",
    title: "تعارض لایه",
    message: "لایه‌های دو سر این اتصال با هم جمع نمی‌شوند.",
  },
  Convergence: {
    code: "layer-convergence",
    title: "حل‌کننده به نتیجه نرسید",
    message: "قیدهای لایه در تعداد تکرار مجاز پایدار نشدند.",
  },
};

function solverIssue(
  status: SolverStatus,
  fallbackNodeId?: string,
  titleOverride?: string,
): ValidationIssue {
  const mapped = CODE_TO_ISSUE[status.code as Exclude<SolverCode, "Ok">];
  const nodeId = status.primaryNodeId ?? fallbackNodeId;
  const actionType = status.edgeId ? "remove-edge" : "select-node";
  return {
    id: `${mapped.code}-${nodeId ?? status.edgeId ?? status.message}`,
    severity: "error",
    code: mapped.code,
    title: titleOverride ?? mapped.title,
    message: mapped.message,
    // The C wording, untruncated, so a report traces back to the source.
    technical: `kNodeLayerSolverErr${status.code}: ${status.message}`,
    nodeId,
    edgeId: status.edgeId,
    action: {
      label: status.edgeId ? "حذف اتصال" : "نمایش روی بوم",
      type: actionType,
    },
  };
}

export type { Chain, ChainLink };
