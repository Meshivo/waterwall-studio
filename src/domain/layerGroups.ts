import type { Layer, LayerGroupConstants, LayerGroupMask } from "../types";
import { schema } from "./schema";

/**
 * `enum node_layer_group` from WaterWall-main/ww/objects/node.h:112, read out of
 * the header by scripts/generate-schema.mjs so the numbers are never typed twice.
 *
 * Note bit 1 (0x02) is unused upstream: None=0x01, L3=0x04, L4=0x08.
 */
export const LG: LayerGroupConstants = schema.layerGroupConstants;

export const hasBit = (mask: LayerGroupMask, bit: number) =>
  (mask & bit) !== 0;

/** Just the L3/L4 bits — every relative flag stripped. */
export const baseBits = (mask: LayerGroupMask) => mask & LG.Anything;

/** True when the mask defers to a neighbour instead of naming a layer itself. */
export const isRelative = (mask: LayerGroupMask) =>
  hasBit(
    mask,
    LG.SameAsNext | LG.SameAsPrev | LG.OppositeNext | LG.OppositePrev,
  );

/**
 * `nodeLayerGroupToString` (node.h:124), ported exactly — a 14-case switch over
 * whole masks, then a fallback that names a single bit. Solver error messages
 * are compared against these strings, so the wording has to match the core.
 */
export function layerGroupToString(mask: LayerGroupMask): string {
  const exact: [number, string][] = [
    [LG.None, "kNodeLayerNone"],
    [LG.L3, "kNodeLayer3"],
    [LG.L4, "kNodeLayer4"],
    [LG.Anything, "kNodeLayerAnything"],
    [LG.SameAsNext, "kNodeLayerSameAsNext"],
    [LG.SameAsPrev, "kNodeLayerSameAsPrev"],
    [LG.L3 | LG.OppositePrev, "kNodeLayer3|kNodeLayerOppositePrev"],
    [LG.L4 | LG.OppositePrev, "kNodeLayer4|kNodeLayerOppositePrev"],
    [LG.Anything | LG.OppositePrev, "kNodeLayerAnything|kNodeLayerOppositePrev"],
    [LG.L3 | LG.OppositeNext, "kNodeLayer3|kNodeLayerOppositeNext"],
    [LG.L4 | LG.OppositeNext, "kNodeLayer4|kNodeLayerOppositeNext"],
    [LG.Anything | LG.OppositeNext, "kNodeLayerAnything|kNodeLayerOppositeNext"],
    [LG.OppositeNext, "kNodeLayerOppositeNext"],
    [LG.OppositePrev, "kNodeLayerOppositePrev"],
  ];
  const matched = exact.find(([value]) => value === mask);
  if (matched) return matched[1];

  if (baseBits(mask) === LG.Anything) return "kNodeLayerAnything";
  const fallback: [number, string][] = [
    [LG.L3, "kNodeLayer3"],
    [LG.L4, "kNodeLayer4"],
    [LG.OppositeNext, "kNodeLayerOppositeNext"],
    [LG.OppositePrev, "kNodeLayerOppositePrev"],
    [LG.SameAsNext, "kNodeLayerSameAsNext"],
    [LG.SameAsPrev, "kNodeLayerSameAsPrev"],
  ];
  return fallback.find(([bit]) => hasBit(mask, bit))?.[1] ?? "unknown";
}

/**
 * The legacy five-value UI string. Ports are coloured by `layer-${port.layer}`
 * in styles.css, so this vocabulary stays even though the solver works on the
 * masks. Kept in sync with the copy inside scripts/generate-schema.mjs — the
 * generator cannot import TypeScript, and layerGroups.test.ts pins the two
 * together across every node in the schema.
 */
export function legacyLayerString(mask: LayerGroupMask): Layer {
  const base = baseBits(mask);
  if (base === LG.Anything) return "any";
  if (base === LG.L3) return "packet";
  if (base === LG.L4) return "stream";
  if (hasBit(mask, LG.SameAsNext | LG.SameAsPrev)) return "same";
  return "none";
}
