import { BookOpen, Plus, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { RankedSuggestion } from "../domain/recommender";
import { nodeExperience, SIMPLE_NODE_TYPES } from "../data/node-experience";

export function NodePicker({
  suggestions,
  advanced,
  onPick,
}: {
  suggestions: RankedSuggestion[];
  advanced: boolean;
  onPick: (type: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      suggestions.filter((item) => {
        const exp = nodeExperience(item.definition);
        return `${item.definition.type} ${item.definition.descriptionFa} ${exp.role} ${exp.purpose}`
          .toLowerCase()
          .includes(query.toLowerCase());
      }),
    [suggestions, query],
  );
  // Simple mode ranks rather than truncates: everything stays reachable, the
  // approachable options lead. Truncating at 12 hid the node the user needed
  // with no way to ask for it.
  const shown = advanced
    ? filtered
    : [...filtered].sort((a, b) => {
        const rank = (type: string) => (SIMPLE_NODE_TYPES.has(type) ? 0 : 1);
        return rank(a.definition.type) - rank(b.definition.type);
      });

  return (
    <div className="node-picker">
      <label className="search-field">
        <Search />
        <span className="sr-only">جستجوی نود</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="نام، نقش یا کاربرد نود (مثلاً: TLS، پکت، پروکسی)..."
        />
      </label>
      {!query && shown[0] && (
        <section>
          <h3>
            <Sparkles /> پیشنهاد برتر و هوشمند
          </h3>
          <Suggestion item={shown[0]} primary onPick={onPick} />
        </section>
      )}
      <section>
        <h3>{query ? "نتیجه جستجو" : "انتخاب‌های سازگار"}</h3>
        <div className="suggestion-list">
          {/* The first suggestion is shown above as the hero pick; without a
              query the rest of the list starts after it. */}
          {shown.slice(query ? 0 : 1).map((item) => (
            <Suggestion
              key={item.definition.type}
              item={item}
              onPick={onPick}
            />
          ))}
        </div>
      </section>
      {!advanced && filtered.length > 8 && (
        <p className="picker-note">
          در حالت ساده فقط گزینه‌های سازگار و پرامتیاز دیده می‌شوند. برای فهرست
          کامل حالت حرفه‌ای را روشن کنید.
        </p>
      )}
      {!shown.length && (
        <div className="inline-empty">
          <strong>نود سازگاری پیدا نشد</strong>
          <span>لایه و ظرفیت پورت فعلی اجازه این انتخاب را نمی‌دهد.</span>
        </div>
      )}
    </div>
  );
}

function Suggestion({
  item,
  primary = false,
  onPick,
}: {
  item: RankedSuggestion;
  primary?: boolean;
  onPick: (type: string) => void;
}) {
  const exp = nodeExperience(item.definition);
  return (
    <div className={`suggestion ${primary ? "primary" : ""}`}>
      <div
        className="suggestion-info"
        onClick={() => onPick(item.definition.type)}
        role="button"
        tabIndex={0}
      >
        <div className="suggestion-head">
          <strong>{item.definition.type}</strong>
          <span className="suggestion-role">{exp.role}</span>
        </div>
        <small className="suggestion-desc">
          {exp.purpose || item.definition.descriptionFa}
        </small>
        {item.reasons.length > 0 && (
          <div className="suggestion-reasons">
            {item.reasons.map((reason) => (
              <em key={reason} className="suggestion-reason">
                {reason}
              </em>
            ))}
          </div>
        )}
      </div>

      <div className="suggestion-actions-row">
        {item.definition.docsUrl && (
          <a
            className="docs-link-btn"
            href={item.definition.docsUrl}
            target="_blank"
            rel="noreferrer"
            title={`مستندات ${item.definition.type}`}
            onClick={(event) => event.stopPropagation()}
          >
            <BookOpen size={12} />
            <span>DOCS</span>
          </a>
        )}
        <button
          className="suggestion-add-btn"
          onClick={() => onPick(item.definition.type)}
        >
          <Plus size={12} />
          <span>افزودن</span>
        </button>
      </div>
    </div>
  );
}
