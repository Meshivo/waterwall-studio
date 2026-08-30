import { AlertTriangle, ArrowLeft, Layers3 } from "lucide-react";
import { SCENARIOS, type Scenario } from "../data/scenarios";

export function ScenarioLibrary({
  onLoad,
}: {
  onLoad: (scenario: Scenario) => void;
}) {
  return (
    <div className="scenario-library">
      <div className="scenario-intro">
        <Layers3 />
        <div>
          <strong>سناریو هر دو سرور را می‌سازد</strong>
          <p>
            پس از بارگذاری، بین ایران و خارج جابه‌جا شوید و هشدارهای هر سمت را
            کامل کنید.
          </p>
        </div>
      </div>
      <div className="scenario-grid">
        {SCENARIOS.map((scenario) => (
          <article className="scenario-card" key={scenario.id}>
            <header>
              <span
                className={`difficulty difficulty-${scenario.difficulty === "حرفه‌ای" ? "hard" : scenario.difficulty === "متوسط" ? "medium" : "easy"}`}
              >
                {scenario.difficulty}
              </span>
              <h3>{scenario.title}</h3>
            </header>
            <p>{scenario.summary}</p>
            <div className="scenario-tags">
              {scenario.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <div className="scenario-caution">
              <AlertTriangle /> <span>{scenario.cautions[0]}</span>
            </div>
            <button className="primary-button" onClick={() => onLoad(scenario)}>
              بارگذاری دوطرفه <ArrowLeft />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
