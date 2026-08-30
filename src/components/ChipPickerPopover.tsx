import { useState, useMemo } from "react";
import { Search, Plus } from "lucide-react";
import { getDefinition } from "../domain/schema";

export type ChipCandidate = {
  type: string;
  category: "inbound" | "transform" | "outbound";
  nameFa: string;
  descriptionFa: string;
};

type ChipPickerPopoverProps = {
  x: number;
  y: number;
  candidates: ChipCandidate[];
  onSelect: (type: string) => void;
  onClose: () => void;
};

export function ChipPickerPopover({
  x,
  y,
  candidates,
  onSelect,
  onClose,
}: ChipPickerPopoverProps) {
  const [filter, setFilter] = useState("");

  const filteredCandidates = useMemo(() => {
    if (!filter.trim()) return candidates;
    const q = filter.toLowerCase();
    return candidates.filter(
      (c) =>
        c.type.toLowerCase().includes(q) ||
        c.nameFa.toLowerCase().includes(q) ||
        c.descriptionFa.toLowerCase().includes(q)
    );
  }, [candidates, filter]);

  return (
    <div
      className="chip-picker-popover nodrag"
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 1050,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="chip-picker-header">
        <div className="chip-picker-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </div>
        <button className="chip-picker-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="chip-picker-list">
        {filteredCandidates.length === 0 ? (
          <div className="chip-picker-empty">هیچ نود سازگاری یافت نشد</div>
        ) : (
          filteredCandidates.map((c) => {
            const def = getDefinition(c.type);
            const icon = def.category === "inbound" ? "↗" : def.category === "outbound" ? "↘" : "⚙";
            return (
              <button
                key={c.type}
                className="chip-picker-item"
                onClick={() => {
                  onSelect(c.type);
                  onClose();
                }}
              >
                <span className={`chip-picker-item__icon category-${def.category}`}>
                  {icon}
                </span>
                <div className="chip-picker-item__info">
                  <span className="chip-picker-item__title">{c.type}</span>
                  <span className="chip-picker-item__desc">{c.nameFa}</span>
                </div>
                <span className="chip-picker-item__add">
                  <Plus size={12} />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
