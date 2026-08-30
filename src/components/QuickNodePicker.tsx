import { useEffect, useRef, type CSSProperties } from "react";
import { List, Plus, X } from "lucide-react";
import type { RankedSuggestion } from "../domain/recommender";
import { nodeExperience } from "../data/node-experience";

export function QuickNodePicker({
  suggestions,
  anchor,
  onPick,
  onShowAll,
  onClose,
}: {
  suggestions: RankedSuggestion[];
  anchor: { x: number; y: number };
  onPick: (type: string) => void;
  onShowAll: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  // Opened by hover, so it should dismiss the same way: once the pointer
  // drifts clear of the panel it closes on its own.
  const panel = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const keepOpen = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };
  const closeSoon = () => {
    if (closeTimer.current === undefined)
      closeTimer.current = window.setTimeout(onClose, 220);
  };
  useEffect(() => keepOpen, []);

  const width = Math.min(304, window.innerWidth - 24);
  const left = Math.max(12, Math.min(anchor.x + 10, window.innerWidth - width - 12));
  const bottomReserve = window.matchMedia("(max-width: 760px)").matches ? 84 : 20;
  const top = Math.max(
    72,
    Math.min(anchor.y - 24, window.innerHeight - bottomReserve - 320),
  );
  const style = { left, top, width } satisfies CSSProperties;
  const quick = suggestions.slice(0, 3);

  return (
    <div
      className="quick-picker-scrim"
      onPointerDown={onClose}
      onMouseMove={(event) => {
        const rect = panel.current?.getBoundingClientRect();
        if (!rect) return;
        const margin = 28,
          within =
            event.clientX >= rect.left - margin &&
            event.clientX <= rect.right + margin &&
            event.clientY >= rect.top - margin &&
            event.clientY <= rect.bottom + margin;
        if (within) keepOpen();
        else closeSoon();
      }}
      onMouseLeave={closeSoon}
    >
      <section
        ref={panel}
        className="quick-node-picker"
        style={style}
        role="dialog"
        aria-label="سه پیشنهاد بعدی مسیر"
        dir="rtl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>نود بعدی</strong>
            <small>سه انتخاب سازگار با این خروجی</small>
          </div>
          <button type="button" onClick={onClose} aria-label="بستن پیشنهادها">
            <X />
          </button>
        </header>

        {quick.length ? (
          <div className="quick-node-list">
            {quick.map((item, index) => {
              const experience = nodeExperience(item.definition);
              return (
                <button
                  type="button"
                  key={item.definition.type}
                  className={index === 0 ? "is-first" : ""}
                  onClick={() => onPick(item.definition.type)}
                  autoFocus={index === 0}
                >
                  <span>
                    <code>{item.definition.type}</code>
                    <small>{experience.purpose}</small>
                  </span>
                  <Plus aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="quick-node-empty">برای این خروجی گزینهٔ سازگاری پیدا نشد.</p>
        )}

        {suggestions.length > 3 && (
          <button type="button" className="quick-node-all" onClick={onShowAll}>
            <List aria-hidden="true" />
            نمایش {suggestions.length - 3} گزینهٔ دیگر
          </button>
        )}
      </section>
    </div>
  );
}
