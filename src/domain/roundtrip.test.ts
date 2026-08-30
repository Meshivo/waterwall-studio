import { describe, expect, it } from "vitest";
import { configFromGraph, graphFromConfig, parseWaterWall } from "./importer";

type RawNode = Record<string, unknown>;
const nodesOf = (config: Record<string, unknown>) =>
  config.nodes as RawNode[];
const byName = (config: Record<string, unknown>, name: string) =>
  nodesOf(config).find((node) => node.name === name)!;

/**
 * A config naming a node that has not been drawn yet is the normal state while a
 * user is importing someone else's topology piece by piece. Export must not
 * quietly resolve that by deleting the reference.
 */
describe("dangling reference round trip", () => {
  it("keeps a next reference whose target does not exist", () => {
    const source = parseWaterWall(
      JSON.stringify({
        name: "half-imported",
        nodes: [
          { name: "in", type: "TcpListener", settings: {}, next: "not-drawn" },
        ],
      }),
    );

    const exported = configFromGraph(graphFromConfig(source));

    expect(byName(exported, "in").next).toBe("not-drawn");
  });

  it("keeps dangling PacketSplitStream branches", () => {
    const source = parseWaterWall(
      JSON.stringify({
        name: "half-imported",
        nodes: [
          {
            name: "split",
            type: "PacketSplitStream",
            settings: { up: "missing-up", down: "missing-down" },
          },
        ],
      }),
    );

    const exported = configFromGraph(graphFromConfig(source));

    expect(byName(exported, "split").settings).toMatchObject({
      up: "missing-up",
      down: "missing-down",
    });
  });

  it("survives repeated import and export without losing the reference", () => {
    const source = parseWaterWall(
      JSON.stringify({
        name: "half-imported",
        nodes: [
          { name: "in", type: "TcpListener", settings: {}, next: "not-drawn" },
        ],
      }),
    );

    let config = source;
    for (let round = 0; round < 3; round += 1)
      config = configFromGraph(graphFromConfig(config));

    expect(byName(config, "in").next).toBe("not-drawn");
  });

  it("drops a reference whose target exists but is no longer connected", () => {
    const source = parseWaterWall(
      JSON.stringify({
        name: "linked",
        nodes: [
          { name: "in", type: "TcpListener", settings: {}, next: "out" },
          { name: "out", type: "TcpConnector", settings: {} },
        ],
      }),
    );
    const graph = graphFromConfig(source);
    expect(graph.edges).toHaveLength(1);

    // The user deleted the edge on the canvas — that is a deliberate act, not a
    // missing node, so the reference must go with it.
    const exported = configFromGraph({ ...graph, edges: [] });

    expect(byName(exported, "in").next).toBeUndefined();
  });

  it("rewrites a resolved reference from the edge, not from raw", () => {
    const source = parseWaterWall(
      JSON.stringify({
        name: "linked",
        nodes: [
          { name: "in", type: "TcpListener", settings: {}, next: "out" },
          { name: "out", type: "TcpConnector", settings: {} },
          { name: "other", type: "TcpConnector", settings: {} },
        ],
      }),
    );
    const graph = graphFromConfig(source);

    const rerouted = configFromGraph({
      ...graph,
      edges: [
        {
          id: "e",
          source: "in",
          target: "other",
          sourceHandle: "next",
          targetHandle: "previous",
          type: "waterwall",
        },
      ],
    });

    expect(byName(rerouted, "in").next).toBe("other");
  });
});
