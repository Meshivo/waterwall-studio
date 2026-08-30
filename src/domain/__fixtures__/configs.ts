import { graphFromConfig, parseWaterWall } from "../importer";
import type { GraphDocument } from "../../types";

/**
 * Representative WaterWall topology fixtures. They are loaded as raw text and
 * passed through the real import path, including JSONC and variable tokens.
 */
const raw = import.meta.glob("./configs/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const named = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [
    path.replace("./configs/", "").replace(".json", ""),
    text,
  ]),
);

export const REAL_CONFIG_NAMES = Object.keys(named).sort();

export function realConfig(name: string): Record<string, unknown> {
  const text = named[name];
  if (!text) throw new Error(`fixture "${name}" not found`);
  return parseWaterWall(text);
}

export function realGraph(name: string): GraphDocument {
  return graphFromConfig(realConfig(name));
}
