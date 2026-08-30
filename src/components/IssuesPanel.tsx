import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ValidationIssue } from "../types";

const icons = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  valid: CheckCircle2,
};

function IssueCard({
  issue,
  onAction,
}: {
  issue: ValidationIssue;
  onAction: (issue: ValidationIssue) => void;
}) {
  const Icon = icons[issue.severity];
  return (
    <article className={`issue-card ${issue.severity}`}>
      <Icon />
      <div>
        <strong>{issue.title}</strong>
        <p>{issue.message}</p>
        <details>
          <summary>جزئیات فنی</summary>
          <code>{issue.technical}</code>
        </details>
        {issue.action && (
          <button className="text-action" onClick={() => onAction(issue)}>
            {issue.action.label}
          </button>
        )}
      </div>
    </article>
  );
}

export function IssuesPanel({
  issues,
  pairIssues = [],
  onAction,
}: {
  issues: ValidationIssue[];
  /** Cross-server findings, kept separate so they never gate the simulator. */
  pairIssues?: ValidationIssue[];
  onAction: (issue: ValidationIssue) => void;
}) {
  if (!issues.length && !pairIssues.length)
    return (
      <div className="validation-success">
        <CheckCircle2 />
        <strong>گراف معتبر است</strong>
        <span>می‌توانید شبیه‌سازی یا export را اجرا کنید.</span>
      </div>
    );
  return (
    <>
      {issues.length > 0 && (
        <div className="issues-list">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onAction={onAction} />
          ))}
        </div>
      )}
      {pairIssues.length > 0 && (
        <section className="pair-issues">
          <h3>
            هماهنگی دو سرور <span>{pairIssues.length}</span>
          </h3>
          <p className="pair-issues-note">
            این موارد بین بوم ایران و خارج بررسی شده‌اند و جلوی شبیه‌سازی این
            بوم را نمی‌گیرند.
          </p>
          <div className="issues-list">
            {pairIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} onAction={onAction} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
