import { describe, expect, it } from "vitest";
import type { StudioNode } from "../types";
import {
  checkConnection,
  hasBlockingIssues,
  hasIncompleteIssues,
  validateGraph,
} from "./validator";
import type { ValidationIssue } from "../types";
import { getDefinition } from "./schema";
const node = (id: string, type: string): StudioNode => ({
  id,
  type: "waterwall",
  position: { x: 0, y: 0 },
  data: { type, name: id, settings: {}, definition: getDefinition(type) },
});
describe("connection validator", () => {
  it("rejects self loops with a user-facing reason", () => {
    const n = node("a", "IpOverrider");
    expect(
      checkConnection(
        {
          source: "a",
          target: "a",
          sourceHandle: "next",
          targetHandle: "previous",
        },
        [n],
        [],
      ).reason,
    ).toContain("خودش");
  });
  it("rejects packet to stream mismatches and recommends the adapter", () => {
    const a = node("a", "TunDevice"),
      b = node("b", "TcpConnector");
    const result = checkConnection(
      {
        source: "a",
        target: "b",
        sourceHandle: "next",
        targetHandle: "previous",
      },
      [a, b],
      [],
    );
    expect(result.technical).toContain("layer mismatch");
    expect(result.suggestedAdapter).toBe("PacketsToStream");
  });
  it("reports required settings", () => {
    const n = node("listener", "TcpListener");
    expect(
      validateGraph([n], []).some((issue) => issue.code === "required-setting"),
    ).toBe(true);
  });
  it("reports required ports", () => {
    const n = node("listener", "TcpListener");
    expect(
      validateGraph([n], []).some((issue) => issue.code === "required-output"),
    ).toBe(true);
  });
  it("requires explicit replacement when an output is occupied", () => {
    const a = node("a", "TcpListener"),
      b = node("b", "TlsServer"),
      c = node("c", "TcpConnector");
    const occupied = {
      id: "ab",
      source: "a",
      target: "b",
      sourceHandle: "next",
      targetHandle: "previous",
      type: "waterwall" as const,
    };
    expect(
      checkConnection(
        {
          source: "a",
          target: "c",
          sourceHandle: "next",
          targetHandle: "previous",
        },
        [a, b, c],
        [occupied],
      ).occupiedEdge?.id,
    ).toBe("ab");
  });
});

describe("simulation gating", () => {
  const issue = (severity: ValidationIssue["severity"]): ValidationIssue => ({
    id: `${severity}-1`,
    severity,
    code: "test",
    title: "t",
    message: "m",
    technical: "",
  });

  it("keeps the walkthrough available while the graph is only unfinished", () => {
    const issues = [issue("warning"), issue("info")];
    expect(hasBlockingIssues(issues)).toBe(false);
    expect(hasIncompleteIssues(issues)).toBe(true);
  });

  it("blocks the walkthrough once an edge is actually invalid", () => {
    expect(hasBlockingIssues([issue("error")])).toBe(true);
  });

  it("treats a clean graph as neither blocked nor unfinished", () => {
    expect(hasBlockingIssues([])).toBe(false);
    expect(hasIncompleteIssues([])).toBe(false);
  });
});

describe("node flags from the C source", () => {
  it("reports a second instance of a singleton node as an error", () => {
    const nodes = [node("a", "PacketSender"), node("b", "PacketSender")];
    const codes = validateGraph(nodes, []).filter(
      (i) => i.code === "singleton-node",
    );
    expect(codes).toHaveLength(2);
    expect(codes[0].severity).toBe("error");
  });

  it("allows a single instance of a singleton node", () => {
    const nodes = [node("a", "PacketSender"), node("b", "TcpListener")];
    expect(
      validateGraph(nodes, []).some((i) => i.code === "singleton-node"),
    ).toBe(false);
  });

  it("does not call a kNodeFlagNoChain node isolated", () => {
    const nodes = [node("a", "BlackHole"), node("b", "TcpListener")];
    expect(
      validateGraph(nodes, []).some(
        (i) => i.code === "isolated-node" && i.nodeId === "a",
      ),
    ).toBe(false);
  });
});
