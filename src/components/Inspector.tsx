import {
  AlertTriangle,
  BookOpen,
  Braces,
  Info,
  KeyRound,
  Link2,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import type { StudioNode, ValidationIssue } from "../types";
import { getDefinition, portLabel } from "../domain/schema";
import {
  categoryLabel,
  fieldHelp,
  FIELD_OPTIONS,
  FIELD_PRESETS,
  NODE_TIPS,
  nodeExperience,
} from "../data/node-experience";

/**
 * Settings whose value is the *name of another node*, keyed by node type. These
 * fell through to a free-text input, which is how a dangling reference gets
 * typed in the first place. Offering a picker makes that class of bug
 * unconstructible, which beats detecting it after the fact.
 *
 * PacketSplitStream's up/down and Bridge's pair are the only such fields in the
 * schema; the importer already materialises up/down as edges (importer.ts:21).
 */
/** `$name$` refers to a graph variable; parseWaterWall keeps it as a string. */
const isVariableToken = (value: unknown) =>
  typeof value === "string" && /^\$[\w-]+\$$/.test(value);

const NODE_REFERENCE_FIELDS: Record<string, string[]> = {
  PacketSplitStream: ["up", "down"],
  Bridge: ["pair"],
};

export function Inspector({
  node,
  nodes,
  issues,
  advanced,
  onChange,
  onDelete,
  onAutoFixAdapter,
}: {
  node?: StudioNode;
  /** Every node on the active canvas, for reference-valued settings. */
  nodes: StudioNode[];
  issues: ValidationIssue[];
  advanced: boolean;
  onChange: (node: StudioNode) => void;
  onDelete: (id: string) => void;
  onAutoFixAdapter?: (nodeId: string) => void;
}) {
  if (!node)
    return (
      <div className="inspector-empty">
        <Info />
        <strong>یک نود را انتخاب کنید</strong>
        <p>تنظیمات و توضیح اتصال‌های آن اینجا نمایش داده می‌شود.</p>
      </div>
    );
  const def = getDefinition(node.data.type),
    ownIssues = issues.filter((item) => item.nodeId === node.id),
    experience = nodeExperience(def);
  /**
   * A flat list of eight settings gives no clue which one the node will not
   * start without. Required fields lead; everything else follows, and a field
   * the user has already filled in counts as required for ordering so their own
   * edits do not sink to the bottom.
   */
  const touched = (id: string) => {
    const value = node.data.settings[id];
    return value !== undefined && value !== null && value !== "";
  };
  const primary = def.settings.filter(
    (field) => field.required || touched(field.id),
  );
  const secondary = def.settings.filter(
    (field) => !field.required && !touched(field.id),
  );
  const settingGroups = [
    { label: "تنظیمات اصلی", fields: primary },
    { label: "تنظیمات اختیاری", fields: secondary },
  ].filter((group) => group.fields.length > 0);
  const update = (field: string, value: unknown) =>
    onChange({
      ...node,
      data: {
        ...node.data,
        settings: { ...node.data.settings, [field]: value },
      },
    });
  return (
    <div className="inspector-form">
      <div className="inspector-title">
        <div>
          <h2>{node.data.type}</h2>
          <code>{node.data.name}</code>
        </div>
        <div className="inspector-title-actions">
          {def.docsUrl && (
            <a
              className="docs-link"
              href={def.docsUrl}
              target="_blank"
              rel="noreferrer"
              title={`مستندات ${def.type}`}
            >
              <BookOpen /> مستندات
            </a>
          )}
          <button className="danger-icon" onClick={() => onDelete(node.id)}>
            <Trash2 /> حذف
          </button>
        </div>
      </div>
      <div className="inspector-purpose">
        <span><BookOpen /> کار این بخش از مسیر</span>
        <p>{experience.purpose}</p>
      </div>
      <details className="inspector-guidance">
        <summary>
          <Info /> راهنما و پورت‌ها
        </summary>
        <div className="node-role">
          <span>{categoryLabel(def.type)}</span>
          <strong>{experience.role}</strong>
          {experience.pair && (
            <small>
              <Link2 /> جفت متناظر: <b>{experience.pair}</b>
            </small>
          )}
          {experience.note && (
            <em>
              <Info /> {experience.note}
            </em>
          )}
        </div>
        {NODE_TIPS[def.type] && (
          <div className="mini-tutorial-tip">
            <Sparkles className="gold-icon" />
            <span>{NODE_TIPS[def.type]}</span>
          </div>
        )}
        <div className="port-summary">
          {[...def.inputs, ...def.outputs].map((port) => (
            <span
              key={`${port.direction}-${port.id}`}
              className={`layer-${port.layer}`}
            >
              <b>{port.labelFa}</b> · {portLabel(port.layer)}
            </span>
          ))}
        </div>
      </details>
      {ownIssues.map((item) => {
        const isLayerConflict =
          item.code === "invalid-edge" ||
          item.technical?.includes("kNodeLayerSolverErrConflict") ||
          item.technical?.includes("incompatible domains") ||
          item.technical?.includes("layer mismatch");

        if (isLayerConflict) {
          return (
            <div className="layer-conflict-alert" key={item.id}>
              <div className="alert-header">
                <AlertTriangle className="alert-icon-glow" />
                <span>⚠️ تعارض شديد لایه‌ها (عدم انطباق L3 پکت و L4 استریم)</span>
              </div>
              <p className="alert-description">
                نود «{node.data.name}» در مسیر انتقال بین پکت‌های خام لایه ۳ و کانکشن استریم لایه ۴ بدون نود مبدل قرار گرفته است.
              </p>
              {onAutoFixAdapter && (
                <button
                  className="autofix-btn"
                  type="button"
                  onClick={() => onAutoFixAdapter(node.id)}
                >
                  <WandSparkles size={14} />
                  <span>⚡ حل خودکار: درج مبدل PacketsToConnection</span>
                </button>
              )}
            </div>
          );
        }

        return (
          <div className={`issue-inline ${item.severity}`} key={item.id}>
            <AlertTriangle />
            <div className="issue-inline-body">
              <strong>{item.title}</strong>
              <p>{item.message}</p>
              {item.technical && <small className="issue-tech">{item.technical}</small>}
            </div>
          </div>
        );
      })}
      <label>
        <span>نام نود</span>
        <input
          value={node.data.name}
          onChange={(event) =>
            onChange({
              ...node,
              data: { ...node.data, name: event.target.value },
            })
          }
        />
      </label>
      {settingGroups.map((group) => (
        <details
          className="settings-disclosure"
          key={group.label}
          {...(group.label === "تنظیمات اصلی" ? { open: true } : {})}
        >
          <summary>
            {group.label} <span>{group.fields.length}</span>
          </summary>
          <fieldset className="setting-group">
            <legend className="sr-only">{group.label}</legend>
          {group.fields.map((field) => {
        const options = FIELD_OPTIONS[field.id],
          presets = FIELD_PRESETS[field.id],
          help = fieldHelp(field.id, field.descriptionFa),
          secret = /uuid|password|secret|(^|-)key/.test(field.id),
          isNodeReference = (
            NODE_REFERENCE_FIELDS[node.data.type] ?? []
          ).includes(field.id);
        return (
          <label key={field.id}>
            <span>
              {field.labelFa}
              {field.required && <b aria-label="ضروری"> *</b>}
            </span>
            {isNodeReference ? (
              <select
                value={String(node.data.settings[field.id] ?? "")}
                onChange={(event) =>
                  update(field.id, event.target.value || undefined)
                }
              >
                <option value="">— انتخاب نشده —</option>
                {nodes
                  .filter((candidate) => candidate.id !== node.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.data.name}>
                      {candidate.data.name} ({candidate.data.type})
                    </option>
                  ))}
                {/* An imported config may name a node that is not drawn yet.
                    Keep it selectable so opening the Inspector does not erase
                    it — validateGraph reports it as a dangling reference. */}
                {typeof node.data.settings[field.id] === "string" &&
                  !nodes.some(
                    (candidate) =>
                      candidate.data.name === node.data.settings[field.id],
                  ) && (
                    <option value={String(node.data.settings[field.id])}>
                      {String(node.data.settings[field.id])} (پیدا نشد)
                    </option>
                  )}
              </select>
            ) : options ? (
              <select
                value={String(node.data.settings[field.id] ?? options[0])}
                onChange={(event) => update(field.id, event.target.value)}
              >
                {options.map((option) => (
                  <option value={option} key={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <input
                type="checkbox"
                checked={Boolean(node.data.settings[field.id])}
                onChange={(event) => update(field.id, event.target.checked)}
              />
            ) : field.type === "json" ? (
              <textarea
                value={
                  typeof node.data.settings[field.id] === "object"
                    ? JSON.stringify(node.data.settings[field.id], null, 2)
                    : String(node.data.settings[field.id] ?? "")
                }
                onChange={(event) => {
                  try {
                    update(field.id, JSON.parse(event.target.value));
                  } catch {
                    update(field.id, event.target.value);
                  }
                }}
              />
            ) : (
              <div className="field-input">
                {/* A numeric field can legitimately hold a $variable$ token, and
                    <input type="number"> renders a non-numeric value as blank —
                    which made the value look empty and let a stray edit erase
                    it. Fall back to text whenever a token is in place. */}
                <input
                  type={
                    field.type === "number" &&
                    !isVariableToken(node.data.settings[field.id])
                      ? "number"
                      : "text"
                  }
                  value={String(node.data.settings[field.id] ?? "")}
                  onChange={(event) => {
                    const raw = event.target.value;
                    update(
                      field.id,
                      field.type === "number" && !isVariableToken(raw) && raw !== ""
                        ? Number(raw)
                        : raw,
                    );
                  }}
                />
                {secret && (
                  <button
                    type="button"
                    title="تولید مقدار امن"
                    onClick={() =>
                      update(
                        field.id,
                        field.id.includes("uuid")
                          ? crypto.randomUUID()
                          : crypto.randomUUID().replaceAll("-", ""),
                      )
                    }
                  >
                    <KeyRound />
                    <span>تولید</span>
                  </button>
                )}
              </div>
            )}
            {/* Quick Presets Chips */}
            {presets && (
              <div className="preset-chips">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="preset-chip"
                    onClick={() => update(field.id, preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
            {help && <small className="field-guidance">{help}</small>}
          </label>
        );
          })}
          </fieldset>
        </details>
      ))}
      {!def.settings.length && (
        <div className="inline-empty">
          <strong>تنظیم ضروری ندارد</strong>
          <span>این نود با تنظیمات پیش‌فرض قابل استفاده است.</span>
        </div>
      )}
      {advanced && (
        <details>
          <summary>
            <Braces /> داده خام و منبع schema
          </summary>
          <pre>
            {JSON.stringify(
              node.data.raw ?? {
                type: node.data.type,
                settings: node.data.settings,
              },
              null,
              2,
            )}
          </pre>
          <small>{def.sourcePath}</small>
        </details>
      )}
    </div>
  );
}
