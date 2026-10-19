import { useEffect, useState } from "react";
import { Button } from "@dev-mainsequence/command-center-sdk/controls";
import { ApplicationCard } from "@dev-mainsequence/command-center-sdk/layout";
import { api, errorText, human, type Row } from "./api";
import { Loading, Notice, Status, useAction } from "./ui";
import { navigate } from "./App";

export function evaluationPath(
  person: string,
  assignment: string,
  result: Row,
) {
  const params = new URLSearchParams({ person, assignment });
  if (result.processing_run_uid) params.set("run", result.processing_run_uid);
  else if (result.uid) params.set("evaluation", result.uid);
  else
    throw new Error(
      "The service did not return an evaluation or processing reference.",
    );
  return `/reconciliation?${params}`;
}

// The same lifecycle serves extraction and comparison, regardless of product.
export function ProcessingRun({
  uid,
  personUid,
  comparison = false,
  onOpenResult,
}: {
  uid: string;
  personUid: string;
  comparison?: boolean;
  onOpenResult?: () => void;
}) {
  const [row, setRow] = useState<Row>();
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const action = useAction(() => setTick((n) => n + 1));
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setRow(undefined);
    setError("");
    const poll = async () => {
      try {
        const next = await api.get(
          `/processing-runs/${uid}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setRow(next);
        setError("");
        if (["pending", "running"].includes(next.status))
          timer = setTimeout(poll, 2500);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e));
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [uid, tick]);
  const completed = row?.status === "completed";
  return (
    <ApplicationCard
      header={
        <h2>{comparison ? "Evaluation processing" : "Document processing"}</h2>
      }
    >
      <div className="form-stack" aria-live="polite">
        {error && <Notice error>{error}</Notice>}
        {!row && !error && <Loading />}
        {row && (
          <>
            <div className="actions">
              <Status value={row.status} />
              <span>{human(row.stage ?? "pending")}</span>
            </div>
            {["pending", "running"].includes(row.status) && (
              <p>
                Work continues on the server. You can leave this page and return
                using this URL.
              </p>
            )}
            {row.error_code && <Notice error>{human(row.error_code)}</Notice>}
            {row.status === "needs_input" && (
              <Notice>
                {comparison
                  ? "The case changed during processing. Run a fresh evaluation using the current evidence."
                  : "This source needs attention. Separate multiple documents into individual files or use manual entry."}
              </Notice>
            )}
            {completed &&
              (comparison ? row.evaluation?.uid : row.document?.uid) && (
                <Button
                  variant="primary"
                  onClick={() =>
                    onOpenResult ? onOpenResult() : navigate(
                      comparison
                        ? evaluationPath(
                            personUid,
                            row.assignment_uid,
                            row.evaluation,
                          )
                        : `/documents/${row.document.uid}`,
                    )
                  }
                >
                  {comparison ? "View evaluation" : "Review extracted document"}
                </Button>
              )}
            {["failed", "pending", "running"].includes(row.status) && (
              <Button
                pending={action.pending}
                onClick={() =>
                  void action.run(
                    () => api.command(`/processing-runs/${uid}/retry`),
                    "Processing requested.",
                  )
                }
              >
                Retry processing
              </Button>
            )}
          </>
        )}
        <Button onClick={() => setTick((n) => n + 1)}>
          Refresh processing status
        </Button>
        {action.feedback}
      </div>
    </ApplicationCard>
  );
}
