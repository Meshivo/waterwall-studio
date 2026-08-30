import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Braces,
  Check,
  CheckCircle2,
  Copy,
  Download,
  RotateCcw,
} from "lucide-react";
import type { GraphDocument } from "../types";
import {
  configFromGraph,
  graphFromConfig,
  parseWaterWall,
} from "../domain/importer";
import { autoLayout } from "../data/scenarios";

/** Download JSON without leaving the page; no zip, one plain file per server. */
function saveJson(graph: GraphDocument, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(configFromGraph(graph), null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function LiveJson({
  graph,
  servers,
  activeServer,
  onApply,
}: {
  graph: GraphDocument;
  servers: { iran: GraphDocument; kharej: GraphDocument };
  activeServer: "iran" | "kharej";
  onApply: (graph: GraphDocument) => void;
}) {
  const serialized = JSON.stringify(configFromGraph(graph), null, 2);
  // The view always shows the active server; download lets the user pick, since
  // a real deployment configures both sides.
  const [target, setTarget] = useState<"iran" | "kharej" | "both">(
    activeServer,
  );
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => setError("کپی در کلیپ‌بورد ممکن نشد."),
    );
  };
  const download = () => {
    if (target === "both") {
      saveJson(servers.iran, "config_iran.json");
      saveJson(servers.kharej, "config_kharej.json");
    } else saveJson(servers[target], `config_${target}.json`);
  };
  const [value, setValue] = useState(serialized);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  // What the canvas looked like when editing started. If the canvas has moved
  // on since, the textarea is showing a stale base and applying it would undo
  // whatever happened in between — the user has to be told, and given a way
  // back, rather than the edits being silently dropped.
  const base = useRef(serialized);

  useEffect(() => {
    if (!dirty) {
      setValue(serialized);
      base.current = serialized;
    }
  }, [serialized, dirty]);

  const stale = dirty && base.current !== serialized;

  const discard = () => {
    setValue(serialized);
    base.current = serialized;
    setDirty(false);
    setError(undefined);
  };

  const apply = () => {
    try {
      const parsed = graphFromConfig(parseWaterWall(value));
      // Keep the positions the user arranged; only lay out what is new.
      const placed = new Map(
        graph.nodes.map((node) => [node.id, node.position]),
      );
      const next = placed.size
        ? {
            ...autoLayout(parsed),
            nodes: autoLayout(parsed).nodes.map((node) => ({
              ...node,
              position: placed.get(node.id) ?? node.position,
            })),
          }
        : autoLayout(parsed);
      onApply(next);
      base.current = JSON.stringify(configFromGraph(next), null, 2);
      setDirty(false);
      setError(undefined);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "JSON قابل خواندن نیست.",
      );
    }
  };

  return (
    <div className="live-json">
      <div className="json-notice">
        <Braces />
        <span>
          <strong>JSON زنده · سرور {activeServer === "iran" ? "ایران" : "خارج"}</strong>
          <small>ویرایش این بخش فقط با دکمه «اعمال روی بوم» ثبت می‌شود.</small>
        </span>
      </div>
      <div className="json-export">
        <button className="secondary-button" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "کپی شد" : "کپی JSON"}
        </button>
        <div className="json-download">
          <select
            value={target}
            onChange={(event) =>
              setTarget(event.target.value as "iran" | "kharej" | "both")
            }
            aria-label="سرور برای دانلود"
          >
            <option value="iran">ایران</option>
            <option value="kharej">خارج</option>
            <option value="both">هر دو سرور</option>
          </select>
          <button className="secondary-button" onClick={download}>
            <Download /> دانلود
          </button>
        </div>
      </div>
      {stale && (
        <div className="json-error json-stale" role="alert">
          <AlertTriangle />
          <span>
            بوم از زمان شروع ویرایش شما تغییر کرده است. اعمال این متن، آن
            تغییرها را برمی‌گرداند.
          </span>
        </div>
      )}
      <textarea
        dir="ltr"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setDirty(true);
        }}
      />
      {error && (
        <div className="json-error" role="alert">
          <AlertTriangle />
          {error}
        </div>
      )}
      <div className="json-actions">
        <span>
          {dirty ? (
            "تغییر اعمال‌نشده دارید"
          ) : (
            <>
              <CheckCircle2 /> با بوم همگام است
            </>
          )}
        </span>
        {dirty && (
          <button className="secondary-button" onClick={discard}>
            <RotateCcw /> بازگشت به وضعیت بوم
          </button>
        )}
        <button className="primary-button" disabled={!dirty} onClick={apply}>
          اعمال روی بوم
        </button>
      </div>
    </div>
  );
}
