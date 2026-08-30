import {
  counterpartType,
  protocolRole,
} from "../data/node-experience";
import type {
  GraphDocument,
  StudioNode,
  StudioProject,
  ValidationIssue,
} from "../types";
import { decomposeChains } from "./chains";
import { Empty, solveGraph, type LayerDomain, type LayerSolution } from "./layerSolver";

/**
 * Cross-server validation for a two-sided tunnel.
 *
 * The two configs are not versions of one artefact — they are duals, so
 * diffing them says nothing. Each side is compiled to a canonical model and
 * then questioned (Batfish), and compatibility is a *direction* rather than a
 * boolean (Confluent): iran->kharej and kharej->iran fail independently.
 */

export type ServerId = "iran" | "kharej";
export type Transport = "tcp" | "udp" | "tcp+udp" | "raw" | "tun" | "other";

export interface Endpoint {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  role: "listen" | "connect";
  transport: Transport;
  host?: string;
  port?: number;
  rawHost?: unknown;
  rawPort?: unknown;
  path: string;
}

export type SecretKind =
  | "password"
  | "uuid"
  | "xor-key"
  | "private-key"
  | "public-key"
  | "short-id"
  | "reverse-secret"
  | "pair-name"
  | "sni"
  | "cert-path";

export interface Secret {
  nodeId: string;
  nodeType: string;
  kind: SecretKind;
  value: string;
  raw: unknown;
  path: string;
}

export interface RolePair {
  clientNodeId: string;
  clientType: string;
  expectedServerType: string;
  /** Hops from the transport boundary of its chain. */
  depth: number;
}

export interface CanonicalSide {
  server: ServerId;
  endpoints: Endpoint[];
  secrets: Secret[];
  roles: RolePair[];
  solution: LayerSolution;
  nodesById: Map<string, StudioNode>;
  /** Kept so counterpart matching can measure distance from the boundary. */
  chains: ReturnType<typeof decomposeChains>["chains"];
}

export type PairRuleId =
  | "PAIR_PORT_MISMATCH"
  | "PAIR_SECRET_MISMATCH"
  | "PAIR_MISSING_COUNTERPART"
  | "PAIR_PROTOCOL_MISMATCH"
  | "PAIR_LAYER_MISMATCH_ACROSS_LINK"
  | "PAIR_OBFUSCATION_ASYMMETRIC"
  | "PAIR_TIMEOUT_SKEW"
  | "PAIR_UNUSED_ENDPOINT";

export interface PairSideRef {
  server: ServerId;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  path: string;
  value: unknown;
  resolved?: unknown;
}

export interface PairFinding {
  ruleId: PairRuleId;
  severity: "error" | "warning" | "info";
  direction: "iran->kharej" | "kharej->iran" | "both";
  sideA: PairSideRef;
  sideB?: PairSideRef;
  titleFa: string;
  messageFa: string;
  technical: string;
  fix: string;
}

/**
 * Secrets are found by field id over a recursive settings walk — no per-type
 * table to keep in sync. Not every kind has to match, though.
 */
const SECRET_FIELDS: Record<string, SecretKind> = {
  password: "password",
  uuid: "uuid",
  xor_key: "xor-key",
  "xor-key": "xor-key",
  key: "xor-key",
  "private-key": "private-key",
  "public-key": "public-key",
  "short-id": "short-id",
  "reverse-secret": "reverse-secret",
  pair: "pair-name",
  sni: "sni",
  "cert-file": "cert-path",
  "key-file": "cert-path",
};

const MUST_MATCH: SecretKind[] = [
  "password",
  "uuid",
  "xor-key",
  "reverse-secret",
  "pair-name",
  "short-id",
];
/** Two servers sharing one private key is a real security defect, not drift. */
const MUST_DIFFER: SecretKind[] = ["private-key"];
/**
 * Recognised but never compared. These are asymmetric *by role*, not by
 * accident: a client carries `sni`, its server carries the certificate; each
 * WireGuard peer holds the other's public key. Reporting a one-sided presence
 * here would flag every correct config.
 */
const NOT_COMPARABLE: SecretKind[] = ["public-key", "cert-path", "sni"];

const TIMING_FIELD = /(?:timeout|interval|tolerance|keepalive|idle)/;

const transportOf = (type: string): Transport =>
  type.startsWith("TcpUdp")
    ? "tcp+udp"
    : type.startsWith("Tcp")
      ? "tcp"
      : type.startsWith("Udp")
        ? "udp"
        : type === "RawSocket"
          ? "raw"
          : type === "TunDevice"
            ? "tun"
            : "other";

const isLoopback = (host?: string) =>
  Boolean(host) && (/^127\./.test(host!) || host === "::1" || host === "localhost");

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * parseWaterWall keeps `$name$` as a literal string, so comparing a raw value
 * against a resolved one is a guaranteed false mismatch. Resolve first, and
 * report both.
 */
export function resolveValue(
  value: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value !== "string") return value;
  const token = value.match(/^\$([\w-]+)\$$/);
  if (!token) return value;
  const resolved = variables[token[1]];
  return resolved === undefined ? value : resolved;
}

export function compileSide(
  server: ServerId,
  graph: GraphDocument,
): CanonicalSide {
  const variables = graph.variables ?? {};
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const solution = solveGraph(graph.nodes, graph.edges);
  const { chains } = decomposeChains(graph.nodes, graph.edges);

  const endpoints: Endpoint[] = [];
  const secrets: Secret[] = [];
  for (const node of graph.nodes) {
    const type = node.data.type;
    const transport = transportOf(type);

    if (
      (type.endsWith("Listener") || type.endsWith("Connector")) &&
      transport !== "other"
    ) {
      const rawPort = node.data.settings.port;
      const rawHost = node.data.settings.address;
      const port = Number(resolveValue(rawPort, variables));
      const host = resolveValue(rawHost, variables);
      endpoints.push({
        nodeId: node.id,
        nodeName: node.data.name,
        nodeType: type,
        role: type.endsWith("Listener") ? "listen" : "connect",
        transport,
        host: typeof host === "string" ? host : undefined,
        port: Number.isInteger(port) ? port : undefined,
        rawHost,
        rawPort,
        path: "settings.port",
      });
    }

    walkSettings(node.data.settings, "settings", (path, key, value) => {
      const kind = SECRET_FIELDS[key];
      if (!kind) return;
      const resolved = resolveValue(value, variables);
      if (typeof resolved !== "string" && typeof resolved !== "number") return;
      secrets.push({
        nodeId: node.id,
        nodeType: type,
        kind,
        value: String(resolved),
        raw: value,
        path,
      });
    });
  }

  // Depth from the transport boundary is what pairs stacked protocols
  // correctly: a MuxClient two hops in from the connector belongs with the
  // MuxServer two hops in from the peer listener.
  // Which end of each chain faces the peer server, and therefore which role
  // makes a cross-server claim. A chain that dials out ends at the peer, so its
  // client-role nodes pair across and its server-role nodes (an inbound
  // Socks5Server, say) serve local users. A chain the peer dials into is the
  // mirror. Without this, Iran's user-facing Socks5Server would demand a
  // Socks5Client on Kharej that has no business existing.
  const peerRoleByNode = new Map<string, "client" | "server" | "any">();
  // Distance has to be measured from the end that faces the peer, not from the
  // nearer end: on a chain that dials out the outermost layer is the last one,
  // on a chain that is dialled into it is the first. Measuring symmetrically
  // would make a correctly mirrored pair look reordered.
  const depthByNode = new Map<string, number>();
  for (const chain of chains) {
    const tail = nodesById.get(chain.tailNodeId);
    const head = nodesById.get(chain.headNodeId);
    const tailEndpoint = endpoints.find(
      (endpoint) => endpoint.nodeId === tail?.id && endpoint.role === "connect",
    );
    const dialsOut = Boolean(tailEndpoint) && !isLoopback(tailEndpoint!.host);
    const listensIn = Boolean(head?.data.type.endsWith("Listener"));
    // A chain with neither a listening head nor a dialling tail is a raw/TUN
    // spoof path — it exists only to reach the other server, so every layer on
    // it pairs across regardless of role. That is where BITSWAP and PROTOSWAP
    // put their obfuscators.
    const peerRole = dialsOut
      ? ("client" as const)
      : listensIn
        ? ("server" as const)
        : tailEndpoint || head?.data.type.endsWith("Connector")
          ? undefined
          : ("any" as const);
    if (!peerRole) continue;
    const fromTail = peerRole === "client";
    chain.links.forEach((link, index) => {
      peerRoleByNode.set(link.nodeId, peerRole);
      const depth =
        peerRole === "any"
          ? Math.min(index, chain.links.length - 1 - index)
          : fromTail
            ? chain.links.length - 1 - index
            : index;
      const current = depthByNode.get(link.nodeId);
      depthByNode.set(
        link.nodeId,
        current === undefined ? depth : Math.min(current, depth),
      );
    });
  }

  const roles: RolePair[] = [];
  for (const node of graph.nodes) {
    const expected = counterpartType(node.data.type);
    if (!expected || expected === "self") continue;
    const role = protocolRole(node.data.type);
    if (role === "symmetric") continue;
    // Transport nodes make no cross-server claim: a TcpListener's peer may be
    // an end user's client, and the real PROTOSWAP Kharej config has no
    // listener at all because everything rides a raw socket. Endpoint linking
    // covers that boundary; RolePair is about the protocol stack above it.
    if (transportOf(node.data.type) !== "other") continue;
    const peerRole = peerRoleByNode.get(node.id);
    if (peerRole !== "any" && peerRole !== role) continue;
    roles.push({
      clientNodeId: node.id,
      clientType: node.data.type,
      expectedServerType: expected,
      depth: depthByNode.get(node.id) ?? boundaryDepth(node.id, chains),
    });
  }

  return {
    server,
    endpoints,
    secrets,
    roles,
    solution,
    nodesById,
    chains,
  };
}

/** Distance from whichever end of the chain carries the transport node. */
function boundaryDepth(
  nodeId: string,
  chains: ReturnType<typeof decomposeChains>["chains"],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const chain of chains) {
    const index = chain.links.findIndex((link) => link.nodeId === nodeId);
    if (index === -1) continue;
    best = Math.min(best, index, chain.links.length - 1 - index);
  }
  return Number.isFinite(best) ? best : 0;
}

function walkSettings(
  value: unknown,
  path: string,
  visit: (path: string, key: string, value: unknown) => void,
): void {
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isObject(item)) walkSettings(item, childPath, visit);
    else visit(childPath, key, item);
  }
}

export function validatePair(project: StudioProject): PairFinding[] {
  const iran = compileSide("iran", project.servers.iran);
  const kharej = compileSide("kharej", project.servers.kharej);
  if (!iran.nodesById.size || !kharej.nodesById.size) return [];

  const findings = [
    ...evaluateDirection(iran, kharej),
    ...evaluateDirection(kharej, iran),
  ];

  // A symmetric rule fires from both sides; collapse those into one finding
  // rather than reporting the same mismatch twice.
  const merged = new Map<string, PairFinding>();
  for (const finding of findings) {
    const key = [
      finding.ruleId,
      ...[finding.sideA.nodeId, finding.sideB?.nodeId ?? ""].sort(),
      finding.sideA.path,
    ].join("|");
    const existing = merged.get(key);
    if (!existing) merged.set(key, finding);
    else if (existing.direction !== finding.direction)
      merged.set(key, { ...existing, direction: "both" });
  }
  return [...merged.values()].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
}

const severityRank = (severity: PairFinding["severity"]) =>
  severity === "error" ? 0 : severity === "warning" ? 1 : 2;

function evaluateDirection(
  from: CanonicalSide,
  to: CanonicalSide,
): PairFinding[] {
  const direction =
    from.server === "iran"
      ? ("iran->kharej" as const)
      : ("kharej->iran" as const);
  const findings: PairFinding[] = [];
  const ref = (side: CanonicalSide, nodeId: string, path: string, value: unknown, resolved?: unknown): PairSideRef => {
    const node = side.nodesById.get(nodeId);
    return {
      server: side.server,
      nodeId,
      nodeName: node?.data.name ?? nodeId,
      nodeType: node?.data.type ?? "?",
      path,
      value,
      resolved,
    };
  };

  // --- counterparts ---------------------------------------------------------
  const matches = new Map<string, string>();
  for (const role of from.roles) {
    const candidates = [...to.nodesById.values()].filter(
      (node) => node.data.type === role.expectedServerType,
    );
    if (!candidates.length) {
      findings.push({
        ruleId: "PAIR_MISSING_COUNTERPART",
        severity: "error",
        direction,
        sideA: ref(from, role.clientNodeId, "type", role.clientType),
        titleFa: "نود متناظر در سرور مقابل نیست",
        messageFa: `${role.clientType} به ${role.expectedServerType} نیاز دارد، ولی چنین نودی در سرور مقابل وجود ندارد.`,
        technical: `${role.clientType} expects ${role.expectedServerType} on ${to.server}`,
        fix: `یک ${role.expectedServerType} به سرور ${to.server === "iran" ? "ایران" : "خارج"} اضافه کنید.`,
      });
      continue;
    }
    // Unique candidate wins; otherwise the one at the same distance from the
    // transport boundary; otherwise a shared secret; otherwise the first, with
    // the ambiguity recorded.
    const byDepth = candidates.filter(
      (node) =>
        boundaryDepthOf(node.id, to) === role.depth,
    );
    const bySecret = candidates.filter((node) =>
      shareASecret(from, role.clientNodeId, to, node.id),
    );
    const chosen =
      candidates.length === 1
        ? candidates[0]
        : (byDepth.length === 1 ? byDepth[0] : undefined) ??
          (bySecret.length === 1 ? bySecret[0] : undefined) ??
          candidates[0];
    matches.set(role.clientNodeId, chosen.id);
  }

  // A node whose counterpart is "self" pairs with the same type on the other
  // server — Bridge by its `pair` name, WireGuardDevice as the peer device.
  // These carry secrets that must agree (or, for a private key, must not), so
  // they are matched by type before the secret rules run.
  for (const node of from.nodesById.values()) {
    if (counterpartType(node.data.type) !== "self") continue;
    const peers = [...to.nodesById.values()].filter(
      (candidate) => candidate.data.type === node.data.type,
    );
    const peer =
      peers.length === 1
        ? peers[0]
        : peers.find((candidate) =>
            shareASecret(from, node.id, to, candidate.id),
          );
    if (peer) matches.set(node.id, peer.id);
  }

  // --- secrets --------------------------------------------------------------
  for (const [fromId, toId] of matches) {
    const ours = from.secrets.filter((secret) => secret.nodeId === fromId);
    const theirs = to.secrets.filter((secret) => secret.nodeId === toId);
    for (const secret of ours) {
      const peer = theirs.find((candidate) => candidate.kind === secret.kind);

      if (MUST_MATCH.includes(secret.kind)) {
        if (!peer || peer.value === secret.value) continue;
        findings.push({
          ruleId: "PAIR_SECRET_MISMATCH",
          severity: "error",
          direction,
          sideA: ref(from, fromId, secret.path, secret.raw, secret.value),
          sideB: ref(to, toId, peer.path, peer.raw, peer.value),
          titleFa: "مقدار محرمانه در دو طرف یکی نیست",
          messageFa: `مقدار ${secret.kind} در دو سرور باید بایت‌به‌بایت یکسان باشد.`,
          technical: `${secret.kind}: "${secret.value}" != "${peer.value}"`,
          fix: "یکی از دو مقدار را روی دیگری کپی کنید.",
        });
      } else if (MUST_DIFFER.includes(secret.kind)) {
        if (!peer || peer.value !== secret.value) continue;
        findings.push({
          ruleId: "PAIR_SECRET_MISMATCH",
          severity: "error",
          direction,
          sideA: ref(from, fromId, secret.path, secret.raw, secret.value),
          sideB: ref(to, toId, peer.path, peer.raw, peer.value),
          titleFa: "کلید خصوصی بین دو سرور مشترک است",
          messageFa: `${secret.kind} باید در هر سرور یکتا باشد؛ مقدار مشترک یعنی هرکس یک طرف را بخواند، طرف دیگر را هم دارد.`,
          technical: `${secret.kind} identical on both servers`,
          fix: "برای هر سرور یک کلید خصوصی جداگانه بسازید.",
        });
      } else if (!NOT_COMPARABLE.includes(secret.kind)) {
        // A kind reaches here only if it was added to SECRET_FIELDS without a
        // decision about how the two sides relate. Fail loudly in development
        // rather than silently ignoring it.
        throw new Error(
          `pairValidator: no comparison rule for secret kind "${secret.kind}"`,
        );
      }
    }

    // --- protocol -----------------------------------------------------------
    const ourType = from.nodesById.get(fromId)!.data.type;
    const theirType = to.nodesById.get(toId)!.data.type;
    const expected = counterpartType(ourType);
    if (expected && expected !== "self" && expected !== theirType)
      findings.push({
        ruleId: "PAIR_PROTOCOL_MISMATCH",
        severity: "error",
        direction,
        sideA: ref(from, fromId, "type", ourType),
        sideB: ref(to, toId, "type", theirType),
        titleFa: "پروتکل دو طرف نمی‌خواند",
        messageFa: `${ourType} با ${expected} کار می‌کند، نه با ${theirType}.`,
        technical: `${ourType} expects ${expected}, found ${theirType}`,
        fix: `نوع نود سمت مقابل را به ${expected} تغییر دهید.`,
      });

    // --- timing skew --------------------------------------------------------
    for (const secret of timingValues(from, fromId)) {
      const peer = timingValues(to, toId).find(
        (candidate) => candidate.key === secret.key,
      );
      if (!peer) continue;
      const ratio =
        Math.max(secret.value, peer.value) /
        Math.max(1, Math.min(secret.value, peer.value));
      if (ratio <= 2) continue;
      findings.push({
        ruleId: "PAIR_TIMEOUT_SKEW",
        severity: "warning",
        direction,
        sideA: ref(from, fromId, `settings.${secret.key}`, secret.value),
        sideB: ref(to, toId, `settings.${peer.key}`, peer.value),
        titleFa: "اختلاف زیاد در زمان‌بندی دو طرف",
        messageFa: `${secret.key} در دو سرور بیش از دو برابر تفاوت دارد؛ طرف کندتر زودتر قطع می‌کند.`,
        technical: `${secret.key}: ${secret.value} vs ${peer.value}`,
        fix: "هر دو را به یک مقدار نزدیک تنظیم کنید.",
      });
    }
  }

  // --- endpoints ------------------------------------------------------------
  const connectors = from.endpoints.filter(
    (endpoint) => endpoint.role === "connect",
  );
  const listeners = to.endpoints.filter(
    (endpoint) => endpoint.role === "listen",
  );
  const linked = linkEndpoints(connectors, listeners);

  for (const [connector, listener] of linked) {
    if (
      connector.port !== undefined &&
      listener.port !== undefined &&
      connector.port !== listener.port
    )
      findings.push({
        ruleId: "PAIR_PORT_MISMATCH",
        severity: "error",
        direction,
        sideA: ref(from, connector.nodeId, connector.path, connector.rawPort, connector.port),
        sideB: ref(to, listener.nodeId, listener.path, listener.rawPort, listener.port),
        titleFa: "پورت مقصد با پورت شنود نمی‌خواند",
        messageFa: `این سرور به پورت ${connector.port} وصل می‌شود ولی سرور مقابل روی ${listener.port} گوش می‌دهد.`,
        technical: `connect ${connector.port} != listen ${listener.port}`,
        fix: "یکی از دو پورت را روی دیگری تنظیم کنید.",
      });

    if (!transportsOverlap(connector.transport, listener.transport))
      findings.push({
        ruleId: "PAIR_PROTOCOL_MISMATCH",
        severity: "error",
        direction,
        sideA: ref(from, connector.nodeId, "type", connector.nodeType),
        sideB: ref(to, listener.nodeId, "type", listener.nodeType),
        titleFa: "پروتکل انتقال دو طرف یکی نیست",
        messageFa: `این سرور ${connector.transport} می‌فرستد ولی سرور مقابل ${listener.transport} می‌شنود.`,
        technical: `${connector.transport} -> ${listener.transport}`,
        fix: "هر دو طرف را روی یک پروتکل انتقال بگذارید.",
      });

    // The solver knows what layer each side of the link actually resolved to.
    const ours = from.solution.resolvedByNode.get(connector.nodeId)?.prev;
    const theirs = to.solution.resolvedByNode.get(listener.nodeId)?.next;
    if (
      ours !== undefined &&
      theirs !== undefined &&
      ours !== Empty &&
      theirs !== Empty &&
      ours !== theirs
    )
      findings.push({
        ruleId: "PAIR_LAYER_MISMATCH_ACROSS_LINK",
        severity: "error",
        direction,
        sideA: ref(from, connector.nodeId, "layer", describeDomain(ours)),
        sideB: ref(to, listener.nodeId, "layer", describeDomain(theirs)),
        titleFa: "لایه دو سر لینک یکی نیست",
        messageFa: `یک طرف ${describeDomain(ours)} تحویل می‌دهد و طرف دیگر ${describeDomain(theirs)} انتظار دارد.`,
        technical: `link layer ${describeDomain(ours)} vs ${describeDomain(theirs)}`,
        fix: "یک مبدل لایه اضافه کنید یا زنجیره یک طرف را اصلاح کنید.",
      });
  }

  // With no cross-server connector in this direction, the direction makes no
  // claim about the peer's listeners at all.
  const dialsAcross = connectors.some(
    (connector) => !isLoopback(connector.host),
  );
  const targeted = new Set(linked.map(([, listener]) => listener.nodeId));
  if (dialsAcross)
  for (const listener of listeners)
    if (!targeted.has(listener.nodeId))
      findings.push({
        ruleId: "PAIR_UNUSED_ENDPOINT",
        severity: "info",
        direction,
        sideA: ref(to, listener.nodeId, listener.path, listener.rawPort, listener.port),
        titleFa: "شنونده‌ای که کسی به آن وصل نمی‌شود",
        messageFa: `هیچ نودی در سرور مقابل به ${listener.nodeName} وصل نمی‌شود.`,
        technical: `no connector targets ${listener.nodeType}:${listener.port}`,
        fix: "اگر عمدی نیست، یک connector اضافه کنید یا این شنونده را حذف کنید.",
      });

  // --- layer ordering -------------------------------------------------------
  // Presence is PAIR_MISSING_COUNTERPART's job. What is left, and what the name
  // actually means, is *order*: both sides can hold the same layers and stack
  // them the wrong way round — Vless inside Tls on one side, Tls inside Vless
  // on the other — which no other rule sees.
  const ourStack = orderedStack(from);
  const theirStack = orderedStack(to);
  const expectedStack = ourStack
    .map((type) => counterpartType(type))
    .filter((type): type is string => typeof type === "string");
  const comparable = expectedStack.filter((type) => theirStack.includes(type));
  const theirComparable = theirStack.filter((type) =>
    expectedStack.includes(type),
  );
  // A Bridge splices two independent paths into one chain, so layers on
  // opposite sides of it are not stacked on each other and their relative order
  // carries no meaning. reverse_grpc is built exactly that way.
  const spliced = (side: CanonicalSide) =>
    [...side.nodesById.values()].some((node) => node.data.type === "Bridge");
  if (
    comparable.length > 1 &&
    !spliced(from) &&
    !spliced(to) &&
    comparable.join(">") !== theirComparable.join(">")
  )
    findings.push({
      ruleId: "PAIR_OBFUSCATION_ASYMMETRIC",
      severity: "warning",
      direction,
      sideA: ref(
        from,
        from.roles[0]?.clientNodeId ?? from.nodesById.keys().next().value!,
        "chain",
        ourStack.join(" → "),
      ),
      titleFa: "ترتیب لایه‌ها در دو سرور یکی نیست",
      messageFa: `این سرور ${comparable.join(" → ")} انتظار دارد ولی سرور مقابل ${theirComparable.join(" → ")} چیده است؛ لایه‌ها باید آینه‌ی هم باز شوند.`,
      technical: `stack ${comparable.join(">")} vs ${theirComparable.join(">")}`,
      fix: "ترتیب نودهای پروتکل را در یک سمت وارونه کنید تا با سمت دیگر بخواند.",
    });

  return findings;
}

const describeDomain = (domain: LayerDomain) =>
  domain === 1 ? "L3" : domain === 2 ? "L4" : domain === 3 ? "L3/L4" : "?";

const boundaryDepthOf = (nodeId: string, side: CanonicalSide) =>
  boundaryDepth(nodeId, side.chains);

function shareASecret(
  from: CanonicalSide,
  fromId: string,
  to: CanonicalSide,
  toId: string,
): boolean {
  const ours = from.secrets.filter(
    (secret) => secret.nodeId === fromId && MUST_MATCH.includes(secret.kind),
  );
  return ours.some((secret) =>
    to.secrets.some(
      (candidate) =>
        candidate.nodeId === toId &&
        candidate.kind === secret.kind &&
        candidate.value === secret.value,
    ),
  );
}

const timingValues = (side: CanonicalSide, nodeId: string) => {
  const node = side.nodesById.get(nodeId);
  if (!node) return [];
  return Object.entries(node.data.settings)
    .filter(
      ([key, value]) => TIMING_FIELD.test(key) && typeof value === "number",
    )
    .map(([key, value]) => ({ key, value: value as number }));
};

/**
 * The peer-facing protocol layers in chain order, outermost first. Built from
 * `roles`, which already excludes user-facing nodes and the transport boundary,
 * and sorted by distance from that boundary so the two sides are comparable.
 */
const orderedStack = (side: CanonicalSide) =>
  [...side.roles]
    .sort((a, b) => a.depth - b.depth)
    .map((role) => role.clientType);

const transportsOverlap = (a: Transport, b: Transport) =>
  a === b ||
  (a === "tcp+udp" && (b === "tcp" || b === "udp")) ||
  (b === "tcp+udp" && (a === "tcp" || a === "udp"));

/**
 * Linking by host is fragile — real configs dial a TUN-side address, not a
 * public IP. When host resolution is inconclusive but there is exactly one
 * connector and one listener, that is the link; otherwise report nothing rather
 * than guess, and let PAIR_UNUSED_ENDPOINT say what is unaccounted for.
 */
function linkEndpoints(
  allConnectors: Endpoint[],
  listeners: Endpoint[],
): [Endpoint, Endpoint][] {
  // A connector dialling 127.0.0.1 hands off to a local service on the same
  // box — it never reaches the other server, so pairing it with a remote
  // listener invents a mismatch that is not there. Every real Kharej config in
  // the dataset ends this way.
  const connectors = allConnectors.filter(
    (connector) => !isLoopback(connector.host),
  );
  const links: [Endpoint, Endpoint][] = [];
  const used = new Set<string>();

  for (const connector of connectors) {
    const byPort = listeners.filter(
      (listener) =>
        !used.has(listener.nodeId) &&
        listener.port !== undefined &&
        listener.port === connector.port &&
        transportsOverlap(connector.transport, listener.transport),
    );
    if (byPort.length === 1) {
      used.add(byPort[0].nodeId);
      links.push([connector, byPort[0]]);
    }
  }

  const remainingConnectors = connectors.filter(
    (connector) => !links.some(([linked]) => linked.nodeId === connector.nodeId),
  );
  const remainingListeners = listeners.filter(
    (listener) => !used.has(listener.nodeId),
  );
  if (remainingConnectors.length === 1 && remainingListeners.length === 1)
    links.push([remainingConnectors[0], remainingListeners[0]]);

  return links;
}

/**
 * Project a finding onto the canvas the user is looking at: `nodeId` is always
 * on the active server and `peer` on the other, so switching servers re-renders
 * the same finding from the mirror perspective without re-running anything.
 */
export function pairIssuesFor(
  findings: PairFinding[],
  active: ServerId,
): ValidationIssue[] {
  return findings.map((finding) => {
    const here =
      finding.sideA.server === active
        ? finding.sideA
        : finding.sideB?.server === active
          ? finding.sideB
          : undefined;
    const there =
      here === finding.sideA ? finding.sideB : finding.sideA;
    const anchor = here ?? finding.sideA;
    return {
      id: `${finding.ruleId}-${finding.sideA.nodeId}-${finding.sideB?.nodeId ?? ""}`,
      severity: finding.severity,
      code: finding.ruleId,
      title: finding.titleFa,
      message: `${finding.messageFa} ${finding.fix}`,
      technical: `${finding.ruleId} [${finding.direction}] ${finding.technical}`,
      nodeId: here ? anchor.nodeId : undefined,
      peer: there
        ? { server: there.server, nodeId: there.nodeId }
        : undefined,
      action: here
        ? { label: "نمایش روی بوم", type: "select-node" as const }
        : there
          ? { label: "نمایش در سرور دیگر", type: "switch-server" as const }
          : undefined,
    };
  });
}
