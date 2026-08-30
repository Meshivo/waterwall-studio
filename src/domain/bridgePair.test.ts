import { describe, expect, it } from "vitest";
import { configFromGraph, graphFromConfig, parseWaterWall } from "./importer";
import { getDefinition } from "./schema";
import { validateGraph } from "./validator";

const config = (nodes: unknown[]) =>
  parseWaterWall(JSON.stringify({ name: "bridged", nodes }));

const bridged = () =>
  config([
    { name: "in", type: "TcpListener", settings: { port: 443 }, next: "b1" },
    { name: "b1", type: "Bridge", settings: { pair: "b2" } },
    { name: "in2", type: "TcpListener", settings: { port: 8443 }, next: "b2" },
    { name: "b2", type: "Bridge", settings: { pair: "b1" } },
  ]);

/**
 * Two Bridges cross-name each other through `pair` — that is how real WaterWall
 * joins two chains, expressed by name rather than by `next`, so nothing put it on
 * the canvas and the two halves looked unrelated.
 */
describe("Bridge pair link", () => {
  it("draws a symbolic edge between two bridges that cross-name each other", () => {
    const graph = graphFromConfig(bridged());
    const pairEdge = graph.edges.find((edge) => edge.sourceHandle === "pair");

    expect(pairEdge).toBeDefined();
    expect(pairEdge!.data?.symbolic).toBe(true);
    expect([pairEdge!.source, pairEdge!.target].sort()).toEqual(["b1", "b2"]);
  });

  it("gives Bridge an optional pair port on each side", () => {
    const bridge = getDefinition("Bridge");
    const input = bridge.inputs.find((port) => port.id === "pair")!;
    const output = bridge.outputs.find((port) => port.id === "pair")!;

    expect(input.required).toBe(false);
    expect(output.required).toBe(false);
    // A lone Bridge is legal while the user is still building.
    expect(input.minConnections).toBe(0);
  });

  it("leaves a single unpaired Bridge alone", () => {
    const graph = graphFromConfig(
      config([
        { name: "in", type: "TcpListener", settings: { port: 443 }, next: "b1" },
        { name: "b1", type: "Bridge", settings: { pair: "lonely" } },
      ]),
    );

    expect(graph.edges.some((edge) => edge.sourceHandle === "pair")).toBe(false);
    // The `next` port is still reported as unconnected — that is a real and
    // pre-existing warning. What must not appear is a complaint about `pair`.
    const aboutPair = validateGraph(graph.nodes, graph.edges).filter((issue) =>
      issue.technical.includes("pair"),
    );
    expect(aboutPair).toEqual([]);
  });

  /** The link lives in settings; export must not try to write it as `next`. */
  it("does not turn the pair edge into a next reference", () => {
    const exported = configFromGraph(graphFromConfig(bridged()));
    const nodes = exported.nodes as Record<string, unknown>[];
    const b1 = nodes.find((node) => node.name === "b1")!;

    expect(b1.next).toBeUndefined();
    expect(b1.settings).toMatchObject({ pair: "b2" });
  });

  it("survives a round trip", () => {
    let current = bridged();
    for (let round = 0; round < 3; round += 1)
      current = configFromGraph(graphFromConfig(current));

    expect(
      graphFromConfig(current).edges.filter(
        (edge) => edge.sourceHandle === "pair",
      ),
    ).toHaveLength(1);
  });

  it("does not report a validation error for the symbolic edge", () => {
    const graph = graphFromConfig(bridged());
    const errors = validateGraph(graph.nodes, graph.edges).filter(
      (issue) => issue.severity === "error",
    );
    expect(errors.map((issue) => issue.technical)).toEqual([]);
  });
});
