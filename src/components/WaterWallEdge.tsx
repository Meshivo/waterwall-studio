import { memo, useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import type { StudioEdge } from "../types";
import { GraphActions } from "./GraphActions";

function WaterWallEdgeView(props: EdgeProps<StudioEdge>) {
  const actions = useContext(GraphActions);
  const [path, labelX, labelY] = getBezierPath(props);
  const symbolic = Boolean(props.data?.symbolic);
  const label = props.data?.label;

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={symbolic ? undefined : props.markerEnd}
        style={props.style}
        className={`ww-edge-path ${symbolic ? "is-symbolic" : ""}`}
      />
      <EdgeLabelRenderer>
        {symbolic ? (
          <span
            className="edge-label-pill edge-pair-label nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
          >
            جفت: {label}
          </span>
        ) : (
          <button
            className="edge-insert edge-label-pill nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            onClick={(event) => {
              event.stopPropagation();
              actions.insertEdge(props.id);
            }}
            aria-label={`درج نود در این اتصال · ${label ?? ""}`}
          >
            <Plus size={12} />
            <span>{label ? label : "درج نود"}</span>
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
export const WaterWallEdge = memo(WaterWallEdgeView);
