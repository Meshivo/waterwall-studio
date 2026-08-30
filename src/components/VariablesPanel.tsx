import { useMemo, useState } from "react";
import { Plus, Trash2, Variable } from "lucide-react";
import type { GraphDocument } from "../types";

/**
 * Real configs write `$name$` wherever a value repeats — a port used by both a
 * listener and its connector, an IP named in four nodes. The importer keeps
 * them and the exporter writes them back, but there was no way to see or edit
 * one, so a value that appears five times had to be changed in five nodes.
 */
export function VariablesPanel({
  graph,
  onChange,
}: {
  graph: GraphDocument;
  onChange: (variables: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState("");
  const entries = Object.entries(graph.variables ?? {});

  /** Where each variable is actually referenced, so deleting one is informed. */
  const usage = useMemo(() => {
    const counts = new Map<string, string[]>();
    for (const node of graph.nodes) {
      const text = JSON.stringify(node.data.settings ?? {});
      for (const [key] of entries)
        if (text.includes(`$${key}$`))
          counts.set(key, [...(counts.get(key) ?? []), node.data.name]);
    }
    return counts;
  }, [graph.nodes, entries]);

  const setValue = (key: string, raw: string) => {
    // Numbers matter: `"port": $p$` has to yield a number, not a string.
    const parsed = raw.trim() === "" ? "" : Number(raw);
    onChange({
      ...graph.variables,
      [key]: raw.trim() !== "" && Number.isFinite(parsed) ? parsed : raw,
    });
  };

  const remove = (key: string) => {
    const next = { ...graph.variables };
    delete next[key];
    onChange(next);
  };

  const add = () => {
    const key = name.trim().replace(/^\$|\$$/g, "");
    if (!key || key in (graph.variables ?? {})) return;
    onChange({ ...graph.variables, [key]: "" });
    setName("");
  };

  return (
    <div className="variables-panel">
      <div className="json-notice">
        <Variable />
        <span>
          <strong>متغیرهای سرور فعال</strong>
          <small>
            هرجا در تنظیمات <code dir="ltr">$نام$</code> بنویسید، مقدار اینجا
            جایگزین می‌شود.
          </small>
        </span>
      </div>

      {entries.length === 0 && (
        <div className="inline-empty">
          <strong>هنوز متغیری تعریف نشده</strong>
          <span>
            برای مقداری که در چند نود تکرار می‌شود یک متغیر بسازید تا یک‌جا عوض
            شود.
          </span>
        </div>
      )}

      {entries.map(([key, value]) => {
        const used = usage.get(key) ?? [];
        return (
          <label className="variable-row" key={key}>
            <span>
              <code dir="ltr">${key}$</code>
              <small>
                {used.length
                  ? `در ${used.length} نود: ${used.join("، ")}`
                  : "هیچ نودی از آن استفاده نمی‌کند"}
              </small>
            </span>
            <input
              dir="ltr"
              value={String(value ?? "")}
              onChange={(event) => setValue(key, event.target.value)}
            />
            <button
              className="icon-button danger"
              onClick={() => remove(key)}
              aria-label={`حذف متغیر ${key}`}
            >
              <Trash2 />
            </button>
          </label>
        );
      })}

      <div className="variable-add">
        <input
          dir="ltr"
          value={name}
          placeholder="نام متغیر جدید"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
        <button className="secondary-button" onClick={add} disabled={!name.trim()}>
          <Plus /> افزودن
        </button>
      </div>
    </div>
  );
}
