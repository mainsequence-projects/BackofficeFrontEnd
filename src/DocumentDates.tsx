import { useEffect, useState } from "react";
import { Button } from "@dev-mainsequence/command-center-sdk/controls";
import { ApplicationCard } from "@dev-mainsequence/command-center-sdk/layout";
import { api, human, type Row } from "./api";
import { Loading, Reload, Status, useLoad } from "./ui";
import { navigate } from "./App";

export function recordedTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

export function EvidenceDates({ dates }: { dates?: Row }) {
  if (!dates) return null;
  const labels = [
    ["Evidence dated", dates.freshness_date],
    ["Fresh through", dates.fresh_until],
    ["Expires on", dates.expires_on],
    ["Renewal measured from (UTC)", dates.renewal_from],
    ["Renewal due on", dates.renewal_due_on],
  ];
  return (
    <div className="form-stack">
      <dl className="document-dates">
        {labels.filter(([, value]) => value).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {dates.action_due_on && (
        <p>
          <Status value={dates.due_status} />{" "}
          {human(dates.action)} on {dates.action_due_on}.
        </p>
      )}
    </div>
  );
}

export function CurrentRequirements({
  assignmentUid,
}: {
  assignmentUid: string;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const loaded = useLoad(
    (signal) => api.get(`/assignments/${assignmentUid}/status`, signal),
    [assignmentUid, tick],
  );
  return (
    <ApplicationCard
      header={
        <div className="actions">
          <h3>Current requirements and renewals</h3>
          <Reload onClick={loaded.refresh} />
        </div>
      }
    >
      {loaded.loading || loaded.error ? (
        <Loading error={loaded.error} />
      ) : loaded.data && (
        <>
          <p>
            Checked for {loaded.data.summary.evaluation_date} (UTC), policy
            version {loaded.data.set_version}. Updates every minute while this
            page is open.
          </p>
          <p>
            {loaded.data.summary.complete
              ? "Current mandatory requirements are satisfied."
              : "Current requirements need attention."}
          </p>
          {loaded.data.findings.map((finding: Row) => (
            <div className="renewal-finding" key={finding.requirement_key}>
              <h4>
                {human(finding.requirement_key)} <Status value={finding.status} />
              </h4>
              <p>{finding.explanation}</p>
              {finding.document_references.filter((ref: Row, i: number, refs: Row[]) => refs.findIndex(r => r.document_uid === ref.document_uid && r.revision === ref.revision) === i).map((ref: Row) => (
                <div key={`${ref.document_uid}:${ref.revision}`}>
                  <EvidenceDates dates={ref.dates} />
                  <Button
                    size="small"
                    onClick={() => navigate(
                      `/documents/${ref.document_uid}?tab=${
                        ref.dates?.action === "review_again" || finding.status === "pending_review"
                          ? "review" : "attributes"
                      }`,
                    )}
                  >
                    {ref.dates?.action === "review_again"
                      ? "Review document" : "Open document"} · Revision {ref.revision}
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </ApplicationCard>
  );
}
