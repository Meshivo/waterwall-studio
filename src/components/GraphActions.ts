import { createContext } from "react";

/** Canvas actions a node card can trigger without threading props through. */
export const GraphActions = createContext<{
  addAfter: (
    nodeId: string,
    handleId: string,
    anchor?: { x: number; y: number },
  ) => void;
  inspect: (nodeId: string) => void;
  insertEdge: (edgeId: string) => void;
  remove: (nodeId: string) => void;
  duplicate: (nodeId: string) => void;
}>({
  addAfter: () => undefined,
  inspect: () => undefined,
  insertEdge: () => undefined,
  remove: () => undefined,
  duplicate: () => undefined,
});
