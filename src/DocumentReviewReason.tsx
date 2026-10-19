import { human, type Row } from "./api";
import { Notice } from "./ui";

/** Display the API's revision-bound reason; current admin settings never explain old decisions. */
export function DocumentReviewReason({ document, finding, changed = false }: { document: Row; finding?: Row; changed?: boolean }) {
  if (document.accepted || document.review_status === "rejected") return null;
  const caseMissing = finding && ["missing", "needs_information"].includes(finding.status);
  const reason = caseMissing ? finding : document.review_requirement;
  if (changed) return <Notice>Save and submit your field changes before requesting a decision. The recorded findings describe the saved revision.</Notice>;
  if (reason) return <Notice>
    <strong>{reason.status === "pending_review" ? "Human decision needed" : "Evidence incomplete"}</strong>
    <p>{reason.explanation}</p>
    {reason.next_action && <p>{reason.next_action}</p>}
  </Notice>;
  // Compatibility while the frontend and API are rolled out separately.
  const parsing = document.parsing_result;
  return <Notice>
    <strong>{document.status === "draft" ? "Draft not submitted" : "Acceptance decision pending"}</strong>
    <p>{document.status === "draft" ? "Complete and submit this revision before review."
      : parsing ? `Recorded parsing outcome: ${human(parsing.reason_code)}.`
        : "No automatic acceptance result is recorded for this revision."}</p>
    {parsing?.parsing_score_percent != null && <p>Recorded classification confidence: {parsing.parsing_score_percent}%{parsing.acceptance_threshold_percent != null ? ` · Threshold: ${parsing.acceptance_threshold_percent}%` : ""}.</p>}
  </Notice>;
}
