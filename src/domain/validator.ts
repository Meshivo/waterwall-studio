import type { Connection } from "@xyflow/react";
import type {
  FieldDefinition,
  StudioEdge,
  StudioNode,
  ValidationIssue,
} from "../types";
import { getDefinition, layersCompatible, portLabel } from "./schema";
import { solveGraph, type LayerSolution } from "./layerSolver";

export interface ConnectionCheck {
  valid: boolean;
  reason: string;
  technical: string;
  occupiedEdge?: StudioEdge;
  suggestedAdapter?: string;
  relatedEdge?: StudioEdge;
  actionLabel?: string;
}

export function checkConnection(
  connection: Connection,
  nodes: StudioNode[],
  edges: StudioEdge[],
  ignoreEdgeId?: string,
): ConnectionCheck {
  if (!connection.source || !connection.target)
    return reject("مبدأ یا مقصد اتصال مشخص نیست.", "source/target is null");
  if (connection.source === connection.target)
    return reject("یک نود نمی‌تواند به خودش متصل شود.", "self-loop");
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target)
    return reject("یکی از نودهای اتصال پیدا نشد.", "dangling node reference");
  const sourcePort = getDefinition(source.data.type).outputs.find(
    (port) => port.id === (connection.sourceHandle ?? "next"),
  );
  const targetPort = getDefinition(target.data.type).inputs.find(
    (port) => port.id === (connection.targetHandle ?? "previous"),
  );
  if (!sourcePort)
    return reject(
      `نود ${source.data.type} این خروجی را ندارد.`,
      `unknown source handle ${connection.sourceHandle}`,
    );
  if (!targetPort)
    return reject(
      `نود ${target.data.type} ورودی سازگار ندارد.`,
      `unknown target handle ${connection.targetHandle}`,
    );
  if (!layersCompatible(sourcePort.layer, targetPort.layer)) {
    const suggestedAdapter =
      sourcePort.layer === "packet" && targetPort.layer === "stream"
        ? "PacketsToStream"
        : sourcePort.layer === "stream" && targetPort.layer === "packet"
          ? "StreamToPackets"
          : undefined;
    return {
      ...reject(
        `خروجی ${portLabel(sourcePort.layer)} مستقیماً به ورودی ${portLabel(targetPort.layer)} وصل نمی‌شود.`,
        `layer mismatch: ${sourcePort.layer} -> ${targetPort.layer}`,
      ),
      suggestedAdapter,
    };
  }
  const duplicate = edges.find(
    (edge) =>
      edge.id !== ignoreEdgeId &&
      edge.source === source.id &&
      edge.target === target.id &&
      edge.sourceHandle === sourcePort.id,
  );
  if (duplicate)
    return {
      ...reject(
        "این اتصال قبلاً ساخته شده است.",
        `duplicate edge ${duplicate.id}`,
      ),
      relatedEdge: duplicate,
      actionLabel: "نمایش اتصال موجود",
    };
  const occupied = edges.filter(
    (edge) =>
      edge.id !== ignoreEdgeId &&
      edge.source === source.id &&
      (edge.sourceHandle ?? "next") === sourcePort.id,
  );
  if (occupied.length >= sourcePort.maxConnections)
    return {
      valid: false,
      reason: "این خروجی پُر است؛ برای جایگزینی اتصال قبلی باید تأیید کنید.",
      technical: `maxConnections=${sourcePort.maxConnections}`,
      occupiedEdge: occupied[0],
    };
  const targetConnections = edges.filter(
    (edge) =>
      edge.id !== ignoreEdgeId &&
      edge.target === target.id &&
      (edge.targetHandle ?? "previous") === targetPort.id,
  );
  if (targetConnections.length >= targetPort.maxConnections)
    return {
      ...reject(
        "ورودی مقصد پُر است؛ ابتدا اتصال قبلی آن را بررسی کنید.",
        `target maxConnections=${targetPort.maxConnections}`,
      ),
      relatedEdge: targetConnections[0],
      actionLabel: "بررسی اتصال فعلی",
    };
  if (createsCycle(source.id, target.id, edges, ignoreEdgeId))
    return {
      ...reject(
        "این اتصال یک چرخه می‌سازد و قابل اجرا نیست.",
        "cycle detected",
      ),
      actionLabel: "نمایش مبدأ چرخه",
    };
  return {
    valid: true,
    reason: "اتصال معتبر است.",
    technical: `${sourcePort.layer} -> ${targetPort.layer}`,
  };
}

const reject = (reason: string, technical: string): ConnectionCheck => ({
  valid: false,
  reason,
  technical,
});

function createsCycle(
  source: string,
  target: string,
  edges: StudioEdge[],
  ignoreEdgeId?: string,
): boolean {
  const stack = [target],
    seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges)
      if (edge.id !== ignoreEdgeId && edge.source === current)
        stack.push(edge.target);
  }
  return false;
}

/**
 * The whole-graph verdict. The layer solution is the authority on layers; pass
 * it in when the caller already has one (App memoizes it for the port badges),
 * otherwise it is computed here. Callers that predate the solver keep working.
 */
export function validateGraph(
  nodes: StudioNode[],
  edges: StudioEdge[],
  solution: LayerSolution = solveGraph(nodes, edges),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const names = new Set(nodes.map((node) => node.data.name));
  for (const node of nodes) {
    const definition = getDefinition(node.data.type);
    if (definition.unknown)
      issues.push(
        issue(
          "error",
          "unknown-node",
          "نوع نود شناخته نشد",
          `${node.data.type} در schema قفل‌شده وجود ندارد؛ داده خام حفظ شده است.`,
          node.id,
          undefined,
          definition.type,
        ),
      );
    const rawNext =
      typeof node.data.raw?.next === "string" ? node.data.raw.next : undefined;
    if (rawNext && !names.has(rawNext))
      issues.push(
        issue(
          "error",
          "dangling-reference",
          "مرجع مقصد پیدا نشد",
          `${node.data.name} به «${rawNext}» اشاره می‌کند، اما چنین نودی در کانفیگ نیست.`,
          node.id,
          undefined,
          `next=${rawNext}`,
          "configure",
        ),
      );
    if (node.data.type === "PacketSplitStream")
      for (const branch of ["up", "down"]) {
        const ref =
          typeof node.data.settings[branch] === "string"
            ? String(node.data.settings[branch])
            : undefined;
        if (ref && !names.has(ref))
          issues.push(
            issue(
              "error",
              "dangling-reference",
              "شاخه مقصد پیدا نشد",
              `شاخه ${branch} به «${ref}» اشاره می‌کند، اما چنین نودی وجود ندارد.`,
              node.id,
              undefined,
              `${branch}=${ref}`,
              "configure",
            ),
          );
      }
    for (const field of definition.settings.filter((field) => field.required)) {
      const value = node.data.settings[field.id];
      if (value === undefined || value === null || value === "")
        issues.push(
          issue(
            "warning",
            "required-setting",
            "تنظیم ضروری خالی است",
            `${field.labelFa} را برای ${node.data.name} وارد کنید.`,
            node.id,
            undefined,
            field.id,
            "configure",
          ),
        );
    }
    for (const field of definition.settings) {
      const problem = checkFieldValue(field, node.data.settings[field.id]);
      if (problem)
        issues.push(
          issue(
            "error",
            "invalid-setting",
            "مقدار تنظیم نامعتبر است",
            `${field.labelFa} در ${node.data.name}: ${problem.fa}`,
            node.id,
            undefined,
            `${field.id}: ${problem.technical}`,
            "configure",
          ),
        );
    }
    if (
      /\b(?:IRAN|KHAREJ)_SERVER_IP\b/.test(JSON.stringify(node.data.settings))
    )
      issues.push(
        issue(
          "warning",
          "scenario-placeholder",
          "آدرس نمونه باید جایگزین شود",
          `IP واقعی سرور را در تنظیمات ${node.data.name} وارد کنید؛ مقدار فعلی فقط راهنمای سناریو است.`,
          node.id,
          undefined,
          "scenario IP placeholder",
          "configure",
        ),
      );
    for (const port of definition.outputs.filter((port) => port.required))
      if (
        !edges.some(
          (edge) =>
            edge.source === node.id &&
            (edge.sourceHandle ?? "next") === port.id,
        )
      )
        issues.push(
          issue(
            "warning",
            "required-output",
            "خروجی اجباری متصل نیست",
            `خروجی «${port.labelFa}» در نود «${node.data.name}» باید به نود بعدی متصل شود.`,
            node.id,
            undefined,
            port.id,
            "select-node",
          ),
        );
    for (const port of definition.inputs.filter((port) => port.required))
      if (
        !edges.some(
          (edge) =>
            edge.target === node.id &&
            (edge.targetHandle ?? "previous") === port.id,
        )
      )
        issues.push(
          issue(
            "warning",
            "required-input",
            "ورودی اجباری متصل نیست",
            `ورودی «${port.labelFa}» در نود «${node.data.name}» هنوز به نود قبلی متصل نشده است.`,
            node.id,
            undefined,
            port.id,
            "select-node",
          ),
        );
  }
  for (const edge of edges) {
    const checked = checkConnection(
      {
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      },
      nodes,
      edges,
      edge.id,
    );
    if (!checked.valid)
      issues.push(
        issue(
          "error",
          "invalid-edge",
          "اتصال نامعتبر",
          checked.reason,
          undefined,
          edge.id,
          checked.technical,
          "remove-edge",
        ),
      );
  }
  for (const [type, sameType] of groupByType(nodes))
    if (sameType.length > 1 && getDefinition(type).flags.singleton)
      for (const node of sameType)
        issues.push(
          issue(
            "error",
            "singleton-node",
            "این نود فقط یک‌بار مجاز است",
            `${type} باید در کل زنجیره تنها یک نمونه داشته باشد، اما ${sameType.length} نمونه وجود دارد.`,
            node.id,
            undefined,
            "kNodeFlagSingleton",
            "select-node",
          ),
        );
  const linked = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  if (nodes.length > 1)
    for (const node of nodes.filter(
      (node) =>
        !linked.has(node.id) && !getDefinition(node.data.type).flags.noChain,
    ))
      issues.push(
        issue(
          "info",
          "isolated-node",
          "نود جدا از مسیر است",
          `نود «${node.data.name}» هنوز به مسیر متصل نشده است.`,
          node.id,
          undefined,
          "isolated",
          "select-node",
        ),
      );
  issues.push(...portCollisions(nodes));
  issues.push(...solution.issues);
  // The solver de-duplicates its own issues, but a shared prefix can also make
  // the decomposition and the solver name the same node.
  const seen = new Set<string>();
  return issues.filter((item) =>
    seen.has(item.id) ? false : (seen.add(item.id), true),
  );
}

function groupByType(nodes: StudioNode[]): Map<string, StudioNode[]> {
  const groups = new Map<string, StudioNode[]>();
  for (const node of nodes)
    groups.set(node.data.type, [
      ...(groups.get(node.data.type) ?? []),
      node,
    ]);
  return groups;
}

/**
 * A `$name$` token is a WaterWall variable, not a value — parseWaterWall turns it
 * into the literal string "$name$". Every value-level rule has to skip those or
 * every real-world config lights up red.
 */
const isVariable = (value: unknown) =>
  typeof value === "string" && /^\$[\w-]+\$$/.test(value);

const IPV4_SHAPE = /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/;

/**
 * Value-level checks. Deliberately narrow: a rule only fires when the value is
 * unambiguously wrong. `address` accepts domain names, so an IP is only checked
 * once the value already looks like dotted quads — a typo, not a hostname.
 */
function checkFieldValue(
  field: FieldDefinition,
  value: unknown,
): { fa: string; technical: string } | undefined {
  if (value === undefined || value === null || value === "" || isVariable(value))
    return undefined;

  if (field.id === "port" || field.id.endsWith("-port")) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return {
        fa: `پورت باید عددی صحیح بین ۱ تا ۶۵۵۳۵ باشد، نه «${String(value)}».`,
        technical: `port out of range: ${String(value)}`,
      };
  }

  if (typeof value === "string" && IPV4_SHAPE.test(value)) {
    const [address, prefix] = value.split("/");
    if (address.split(".").some((part) => Number(part) > 255))
      return {
        fa: `هر بخش آدرس IPv4 باید بین ۰ تا ۲۵۵ باشد، نه «${value}».`,
        technical: `invalid IPv4 octet: ${value}`,
      };
    if (prefix !== undefined && Number(prefix) > 32)
      return {
        fa: `طول پیشوند IPv4 حداکثر ۳۲ است، نه «/${prefix}».`,
        technical: `invalid IPv4 prefix: ${value}`,
      };
  }

  if (/(?:timeout|interval|tolerance)(?:-ms)?$/.test(field.id)) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0)
      return {
        fa: `این مقدار بر حسب میلی‌ثانیه است و نمی‌تواند منفی باشد، نه «${String(value)}».`,
        technical: `negative duration: ${String(value)}`,
      };
  }

  return undefined;
}

/** Which protocols a chain-head node actually binds. */
const boundTransports = (type: string): string[] =>
  type.startsWith("TcpUdp")
    ? ["tcp", "udp"]
    : type.startsWith("Tcp")
      ? ["tcp"]
      : type.startsWith("Udp")
        ? ["udp"]
        : [];

/**
 * Two listeners on one port cannot both bind. Only chain-head nodes with no input
 * port actually listen — a TcpConnector's `port` is a destination, not a binding.
 */
function portCollisions(nodes: StudioNode[]): ValidationIssue[] {
  const claims = new Map<string, StudioNode[]>();
  for (const node of nodes) {
    const definition = getDefinition(node.data.type);
    if (!definition.flags.chainHead || definition.inputs.length > 0) continue;
    const port = node.data.settings.port;
    if (isVariable(port) || !Number.isInteger(Number(port))) continue;
    const address = String(node.data.settings.address ?? "0.0.0.0");
    for (const transport of boundTransports(node.data.type)) {
      const key = `${transport}://${address}:${Number(port)}`;
      claims.set(key, [...(claims.get(key) ?? []), node]);
    }
  }
  const issues: ValidationIssue[] = [];
  const reported = new Set<string>();
  for (const [key, claimants] of claims) {
    if (claimants.length < 2) continue;
    for (const node of claimants) {
      if (reported.has(node.id)) continue;
      reported.add(node.id);
      const others = claimants
        .filter((other) => other.id !== node.id)
        .map((other) => other.data.name)
        .join("، ");
      issues.push(
        issue(
          "error",
          "port-conflict",
          "دو نود روی یک پورت شنود می‌کنند",
          `${node.data.name} و ${others} هر دو ${key} را می‌گیرند؛ فقط یکی موفق می‌شود.`,
          node.id,
          undefined,
          `duplicate bind: ${key}`,
          "configure",
        ),
      );
    }
  }
  return issues;
}

function issue(
  severity: ValidationIssue["severity"],
  code: string,
  title: string,
  message: string,
  nodeId?: string,
  edgeId?: string,
  technical = "",
  actionType?: NonNullable<ValidationIssue["action"]>["type"],
): ValidationIssue {
  return {
    id: `${code}-${nodeId ?? edgeId ?? technical}`,
    severity,
    code,
    title,
    message,
    technical,
    nodeId,
    edgeId,
    action: actionType
      ? {
          label:
            actionType === "configure"
              ? "تکمیل تنظیمات"
              : actionType === "remove-edge"
                ? "حذف اتصال"
                : "نمایش روی بوم",
          type: actionType,
        }
      : undefined,
  };
}

/**
 * Only errors stop the simulation. Warnings (empty required setting, scenario
 * placeholder, unconnected required port) describe an unfinished graph, not an
 * unrunnable one — the walkthrough is educational and stays available while the
 * user is still building.
 */
export const hasBlockingIssues = (issues: ValidationIssue[]) =>
  issues.some((item) => item.severity === "error");

/** Graph runs, but is not finished yet — the simulator shows this as a banner. */
export const hasIncompleteIssues = (issues: ValidationIssue[]) =>
  issues.some((item) => item.severity === "warning");
