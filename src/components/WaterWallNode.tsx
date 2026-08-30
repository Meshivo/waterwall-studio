import { memo, useContext, useEffect, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CopyPlus,
  Settings2,
  Trash2,
} from "lucide-react";
import type { StudioNode } from "../types";
import { getDefinition, portLabel } from "../domain/schema";
import { nodeExperience } from "../data/node-experience";
import { GraphActions } from "./GraphActions";

function WaterWallNodeView({ id, data, selected }: NodeProps<StudioNode>) {
  const def = data.definition ?? getDefinition(data.type),
    actions = useContext(GraphActions);
  const status = data.status ?? "valid";
  const experience = nodeExperience(def);
  // Hovering a free output opens the quick picker; the timer keeps a stray
  // pointer crossing the badge from firing it.
  const hoverTimer = useRef<number | undefined>(undefined);
  const cancelHover = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  };
  useEffect(() => cancelHover, []);

  const summarySetting = nodeSummaryText(data.settings) || experience.purpose;

  return (
    <div className={`ww-node-shell ${selected ? "is-selected" : ""}`}>
      <article
        className={`ww-node status-${status} ${selected ? "is-selected" : ""}`}
        onDoubleClick={() => actions.inspect(id)}
        data-testid="node-titlebar"
      >
        <div className="ww-port-stack ww-port-stack--left">
          {def.inputs.map((port) => (
            <div
              key={port.id}
              className={`ww-port-badge layer-${port.layer}`}
              title={`ورودی ${port.labelFa} (${portLabel(port.layer)})`}
            >
              <Handle
                id={port.id}
                type="target"
                position={Position.Left}
                className={`ww-handle layer-${port.layer}`}
                aria-label={`ورودی ${port.labelFa}، ${portLabel(port.layer)}`}
              />
              <span className="ww-port-cue">{port.labelFa}</span>
            </div>
          ))}
        </div>

        <div className="ww-port-stack ww-port-stack--right">
          {def.outputs.map((port) => {
            const isOccupied = data.occupiedHandles?.includes(port.id);
            return (
              <div
                key={port.id}
                className={`ww-port-badge layer-${port.layer} ${isOccupied ? "is-connected" : ""}`}
                title={`خروجی ${port.labelFa} (${portLabel(port.layer)})`}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelHover();
                  if (!isOccupied)
                    actions.addAfter(id, port.id, {
                      x: e.clientX,
                      y: e.clientY,
                    });
                }}
                onMouseEnter={(e) => {
                  // Touch devices have no hover and still rely on the tap
                  // above; a held button means a connection drag is starting.
                  if (isOccupied || e.buttons !== 0) return;
                  if (!window.matchMedia("(hover: hover)").matches) return;
                  const point = { x: e.clientX, y: e.clientY };
                  cancelHover();
                  hoverTimer.current = window.setTimeout(
                    () => actions.addAfter(id, port.id, point),
                    180,
                  );
                }}
                onMouseLeave={cancelHover}
              >
                <Handle
                  id={port.id}
                  type="source"
                  position={Position.Right}
                  className={`ww-handle layer-${port.layer}`}
                  aria-label={`خروجی ${port.labelFa}، ${portLabel(port.layer)}`}
                />
                <span className="ww-port-cue">{isOccupied ? port.labelFa : "+"}</span>
              </div>
            );
          })}
        </div>

        <div className="ww-node-body">
          <header className="node-heading">
            <span
              className={`status-mark ${status}`}
              title={
                status === "error"
                  ? "خطای غیرمجاز یا قطع بودن اتصال"
                  : status === "warning"
                    ? "هشدار: تنظیم ضروری خالی است یا ورودی/خروجی متصل نشده است"
                    : "نود سالم و متصل"
              }
            >
              {status === "error" || status === "warning" ? (
                <AlertTriangle size={14} />
              ) : (
                <Check size={14} />
              )}
            </span>
            <code className="node-type">{data.type}</code>
          </header>
          <strong className="node-name">{data.name}</strong>
          <p className="node-desc">{summarySetting}</p>
          {selected && (
            <div className="node-context-actions nodrag">
              <button onClick={() => actions.inspect(id)} aria-label={`تنظیمات ${data.name}`}>
                <Settings2 /> تنظیمات
              </button>
              <button onClick={() => actions.duplicate(id)} aria-label={`تکثیر ${data.name}`} title="تکثیر">
                <CopyPlus />
              </button>
              {def.docsUrl && (
                <a href={def.docsUrl} target="_blank" rel="noreferrer" aria-label={`مستندات ${def.type}`} title="مستندات">
                  <BookOpen />
                </a>
              )}
              <button onClick={() => actions.remove(id)} aria-label={`حذف ${data.name}`} title="حذف" className="danger">
                <Trash2 />
              </button>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

function nodeSummaryText(settings: Record<string, unknown> = {}): string {
  if (settings.address) return String(settings.address);
  if (settings.listen) return String(settings.listen);
  if (settings.server) return String(settings.server);
  if (settings.port) return `Port: ${settings.port}`;
  return "";
}

export const WaterWallNode = memo(WaterWallNodeView);
