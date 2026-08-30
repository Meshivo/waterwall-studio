import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export type CanvasEdgeData = {
  label?: string;
  layer?: "packet" | "stream" | "any";
  highlighted?: boolean;
  isDotted?: boolean;
};

export function CanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = (data as CanvasEdgeData) || {};
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const layerLabel =
    edgeData.layer === "packet"
      ? "L3 Packet"
      : edgeData.layer === "stream"
        ? "L4 Stream"
        : edgeData.label ?? "";

  const isHighlighted = edgeData.highlighted ?? false;
  const isDotted = edgeData.isDotted ?? false;

  const combinedStyle: React.CSSProperties = {
    ...style,
    strokeWidth: isHighlighted ? 3 : 2,
    stroke: isHighlighted
      ? "var(--color-primary, #e69140)"
      : style.stroke || "var(--edge-connection, #7b6752)",
    strokeDasharray: isDotted ? "6 6" : style.strokeDasharray,
    transition: "stroke 0.2s ease, stroke-width 0.2s ease",
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={combinedStyle} markerEnd={markerEnd} />
      {layerLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className={`edge-label-pill ${edgeData.layer ? `layer-${edgeData.layer}` : ""} ${
              isHighlighted ? "is-highlighted" : ""
            }`}
          >
            <span>{layerLabel}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
