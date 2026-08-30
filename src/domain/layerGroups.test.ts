import { describe, expect, it } from "vitest";
import portLayerSnapshot from "./__fixtures__/port-layers.json";
import {
  LG,
  baseBits,
  isRelative,
  layerGroupToString,
  legacyLayerString,
} from "./layerGroups";
import { schema } from "./schema";

const definition = (type: string) =>
  schema.nodes.find((node) => node.type === type)!;

describe("layer group constants", () => {
  /**
   * These come out of node.h at generate time. A silent renumbering upstream is
   * a real semantic change and should fail loudly rather than shift every mask.
   */
  it("pins the node.h enum bit positions", () => {
    expect(LG).toEqual({
      None: 1,
      L3: 4,
      L4: 8,
      Anything: 12,
      SameAsNext: 16,
      SameAsPrev: 32,
      OppositeNext: 64,
      OppositePrev: 128,
    });
  });

  it("leaves bit 1 unused, as upstream does", () => {
    expect(Object.values(LG).some((value) => value === 2)).toBe(false);
  });
});

describe("faithful mask extraction", () => {
  /**
   * The old `(\w+)` capture stopped at the first non-word character, so
   * everything after `|` was dropped. WireGuardDevice is the only node in the
   * tree that uses Opposite*, which is why the bug went unnoticed.
   */
  it("keeps the full ORed mask on WireGuardDevice", () => {
    const wireGuard = definition("WireGuardDevice");
    expect(wireGuard.layerGroups.next).toBe(LG.Anything | LG.OppositePrev);
    expect(wireGuard.layerGroups.prev).toBe(LG.Anything | LG.OppositeNext);
  });

  /** Both collapsed to the string "same" before, which is not decidable. */
  it("distinguishes SameAsNext from SameAsPrev on ObfuscatorClient", () => {
    const obfuscator = definition("ObfuscatorClient");
    expect(obfuscator.layerGroups.prev).toBe(LG.SameAsNext);
    expect(obfuscator.layerGroups.next).toBe(LG.SameAsPrev);
    expect(obfuscator.layerGroups.prev).not.toBe(obfuscator.layerGroups.next);
  });

  it.each([
    "PacketsToStream",
    "StreamToPackets",
    "PacketsToConnection",
    "ConnectionToPackets",
  ])("reads `kNodeLayer3 | kNodeLayer4` on %s as Anything", (type) => {
    expect(definition(type).layerGroups.own).toBe(LG.Anything);
  });

  it("emits a non-zero mask for all three fields on every node", () => {
    const incomplete = schema.nodes.filter(
      (node) =>
        !node.layerGroups.own || !node.layerGroups.prev || !node.layerGroups.next,
    );
    expect(incomplete.map((node) => node.type)).toEqual([]);
  });

  it("matches the field census across all 73 nodes", () => {
    const census = (pick: (node: (typeof schema.nodes)[number]) => number) => {
      const counts = new Map<number, number>();
      for (const node of schema.nodes)
        counts.set(pick(node), (counts.get(pick(node)) ?? 0) + 1);
      return counts;
    };

    expect(schema.nodes).toHaveLength(73);

    const own = census((node) => node.layerGroups.own);
    expect(own.get(LG.L4)).toBe(45);
    expect(own.get(LG.Anything)).toBe(19); // 15 declared + 4 written as L3|L4
    expect(own.get(LG.L3)).toBe(9);

    const next = census((node) => node.layerGroups.next);
    expect(next.get(LG.L4)).toBe(43);
    expect(next.get(LG.L3)).toBe(9);
    expect(next.get(LG.SameAsPrev)).toBe(7);
    expect(next.get(LG.Anything)).toBe(7);
    expect(next.get(LG.None)).toBe(6);
    expect(next.get(LG.Anything | LG.OppositePrev)).toBe(1);

    const prev = census((node) => node.layerGroups.prev);
    expect(prev.get(LG.L4)).toBe(43);
    expect(prev.get(LG.L3)).toBe(8);
    expect(prev.get(LG.SameAsNext)).toBe(7);
    expect(prev.get(LG.None)).toBe(7);
    expect(prev.get(LG.Anything)).toBe(7);
    expect(prev.get(LG.Anything | LG.OppositeNext)).toBe(1);
  });
});

describe("capabilities", () => {
  /**
   * Port presence is a lossy proxy: PacketSplitStream has two outputs and
   * BlackHole none, so the solver needs the declared flag itself.
   */
  it("records can_have_prev and can_have_next separately from ports", () => {
    expect(
      schema.nodes.filter((node) => !node.capabilities.next),
    ).toHaveLength(6);
    expect(
      schema.nodes.filter((node) => !node.capabilities.prev),
    ).toHaveLength(7);
  });

  it("keeps the output port on PacketSplitStream despite two handles", () => {
    const split = definition("PacketSplitStream");
    expect(split.capabilities.next).toBe(true);
    expect(split.outputs.map((portDefinition) => portDefinition.id)).toEqual([
      "up",
      "down",
    ]);
  });
});

describe("legacyLayerString", () => {
  /**
   * The generator holds its own copy of this function (it cannot import TS).
   * This is what keeps the two from drifting: the snapshot was taken before the
   * extraction was rewritten, so equality proves P3 changed no rendered port.
   *
   * Updated once since, deliberately: P11 gave Bridge an optional `pair` port
   * on each side so the canvas can draw the link between two Bridges sharing a
   * name. No other node moved.
   */
  it("reproduces every port layer string recorded before the rewrite", () => {
    const current = Object.fromEntries(
      schema.nodes.map((node) => [
        node.type,
        {
          inputs: node.inputs.map((portDefinition) => portDefinition.layer),
          outputs: node.outputs.map((portDefinition) => [
            portDefinition.id,
            portDefinition.layer,
          ]),
        },
      ]),
    );
    expect(current).toEqual(portLayerSnapshot);
  });

  it("maps the five vocabulary values", () => {
    expect(legacyLayerString(LG.Anything)).toBe("any");
    expect(legacyLayerString(LG.L3)).toBe("packet");
    expect(legacyLayerString(LG.L4)).toBe("stream");
    expect(legacyLayerString(LG.SameAsPrev)).toBe("same");
    expect(legacyLayerString(LG.None)).toBe("none");
  });

  it("reports a base layer even when a relative flag rides along", () => {
    expect(legacyLayerString(LG.Anything | LG.OppositePrev)).toBe("any");
  });
});

describe("layerGroupToString", () => {
  /** Solver messages quote these, so they must read exactly as the core does. */
  it("names the whole mask for each of the fourteen exact forms", () => {
    expect(layerGroupToString(LG.None)).toBe("kNodeLayerNone");
    expect(layerGroupToString(LG.Anything)).toBe("kNodeLayerAnything");
    expect(layerGroupToString(LG.SameAsPrev)).toBe("kNodeLayerSameAsPrev");
    expect(layerGroupToString(LG.Anything | LG.OppositePrev)).toBe(
      "kNodeLayerAnything|kNodeLayerOppositePrev",
    );
    expect(layerGroupToString(LG.L3 | LG.OppositeNext)).toBe(
      "kNodeLayer3|kNodeLayerOppositeNext",
    );
  });

  it("falls back to a single bit name for an unlisted mask", () => {
    expect(layerGroupToString(LG.L4 | LG.SameAsNext)).toBe("kNodeLayer4");
    expect(layerGroupToString(0)).toBe("unknown");
  });
});

describe("mask helpers", () => {
  it("strips relative flags with baseBits", () => {
    expect(baseBits(LG.Anything | LG.OppositePrev)).toBe(LG.Anything);
    expect(baseBits(LG.SameAsNext)).toBe(0);
  });

  it("detects relative masks", () => {
    expect(isRelative(LG.SameAsNext)).toBe(true);
    expect(isRelative(LG.Anything | LG.OppositePrev)).toBe(true);
    expect(isRelative(LG.L4)).toBe(false);
  });
});
