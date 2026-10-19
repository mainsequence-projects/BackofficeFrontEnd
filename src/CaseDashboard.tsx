import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Input,
  Textarea,
  Field,
} from "@dev-mainsequence/command-center-sdk/controls";
import {
  ResourceDetailShell,
  ResourcePicker,
} from "@dev-mainsequence/command-center-sdk/views";
import { api, human, type Catalog, type Row } from "./api";
import {
  Loading,
  Notice,
  OperationRecovery,
  SourcePreview,
  Status,
  useAction,
  useLoad,
} from "./ui";
import { navigate } from "./App";
import { ProcessingRun } from "./ProcessingRun";
import { recordedTime } from "./DocumentDates";
import { ComparisonPolicy } from "./ComparisonEvidence";
import { DocumentReviewReason } from "./DocumentReviewReason";
import { CaseDocumentFields } from "./CaseDocumentFields";
import {
  ApplicationCard,
  ApplicationPage,
  ApplicationPageStack,
  useCommandCenterViewport,
} from "@dev-mainsequence/command-center-sdk/layout";
import {
  evidenceFieldLabel,
  groupRequiredEvidence,
  type EvidenceRequirement,
} from "./ReviewEvidence";
import "./casework.css";

const lanes: Record<string, string> = {
  discrepancy: "Discrepancy",
  missing_evidence: "Missing evidence",
  review_required: "Review required",
  checks_satisfied: "Checks satisfied",
  updating: "Updating",
};
const label = (value: unknown) =>
  value == null
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
const reviewerName = (r: Row) =>
  r.display_name || `Staff ${r.reviewer_uid.slice(0, 8)}`;
const shortId = (uid: string) => uid.slice(0, 8).toUpperCase();
function Lane({ value }: { value: string }) {
  return (
    <span className={`case-lane case-lane--${value}`}>
      {lanes[value] ?? human(value)}
    </span>
  );
}
function Stat({
  title,
  value,
  detail,
}: {
  title: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <div className="case-stat">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`case-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function CaseQueue({ catalog }: { catalog: Catalog }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [responsibility, setResponsibility] = useState("all");
  const [caseType, setCaseType] = useState("");
  const [creating, setCreating] = useState(false);
  const caseTypes = useLoad((signal) => api.get("/case-types", signal), []);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const loaded = useLoad(
    (signal) =>
      api.get(
        `/cases?${new URLSearchParams({ search: query, responsibility, case_type_key: caseType, offset: String(offset), limit: "10" })}`,
        signal,
      ),
    [query, responsibility, caseType, offset],
  );
  const rows: Row[] = loaded.data?.items ?? [];
  const count = (state: string) =>
    rows.filter((r) => r.workflow_state === state).length;
  const visible =
    filter === "all" ? rows : rows.filter((r) => r.workflow_state === filter);
  const frequent = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((r) => {
      if (r.top_finding)
        counts.set(
          r.top_finding.requirement_key,
          (counts.get(r.top_finding.requirement_key) ?? 0) + 1,
        );
    });
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [loaded.data]);
  return (
    <main className="case-dashboard">
      <OperationRecovery />
      <header className="case-page-heading">
        <div>
          <p className="case-eyebrow">Back Office · Document control</p>
          <h1>Case review queue</h1>
          <p className="muted">
            Subjects are the people in the evidence. Assigned reviewers are the
            staff responsible for each case.
          </p>
        </div>
        <div className="actions">
          <Button onClick={loaded.refresh}>Refresh queue</Button>
          <Button onClick={() => navigate("/persons/new")}>New subject</Button>
          <Button variant="primary" onClick={() => setCreating(!creating)}>
            {creating ? "Cancel new case" : "New case"}
          </Button>
        </div>
      </header>
      {creating && (
        <CaseCreation onCreated={(caseUid) => navigate(`/review/${caseUid}`)} />
      )}
      {caseTypes.error && <Notice error>{caseTypes.error}</Notice>}
      <div className="case-toolbar">
        <Input
          aria-label="Search case subjects"
          placeholder="Search subject name or reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ResourcePicker
          ariaLabel="Reviewer responsibility"
          value={responsibility}
          onValueChange={(v) => {
            setResponsibility(v);
            setOffset(0);
          }}
          options={[
            { value: "all", label: "All accessible cases" },
            { value: "mine", label: "Assigned to me" },
            { value: "unassigned", label: "Unassigned" },
          ]}
        />
        <ResourcePicker
          ariaLabel="Case type"
          value={caseType}
          onValueChange={(v) => {
            setCaseType(v);
            setOffset(0);
          }}
          options={[
            { value: "", label: "All case types" },
            ...(caseTypes.data?.items ?? []).map((type: Row) => ({
              value: type.key,
              label: type.name,
            })),
          ]}
        />
      </div>
      {loaded.loading || loaded.error ? (
        <Loading error={loaded.error} />
      ) : (
        <>
          <div className="case-stats">
            <Stat
              title="Accessible cases"
              value={loaded.data?.total_items ?? 0}
              detail="Matching search and responsibility"
            />
            <Stat
              title="Discrepancies"
              value={count("discrepancy")}
              detail="Cases on this page"
            />
            <Stat
              title="Missing evidence"
              value={count("missing_evidence")}
              detail="Cases on this page"
            />
            <Stat
              title="Review required"
              value={count("review_required")}
              detail="Cases on this page"
            />
            <Stat
              title="Checks satisfied"
              value={count("checks_satisfied")}
              detail="Evidence completion, not approval"
            />
          </div>
          <div className="case-filters" aria-label="Filter this page">
            {["all", ...Object.keys(lanes)].map((state) => (
              <Button
                key={state}
                size="small"
                variant={filter === state ? "primary" : "secondary"}
                onClick={() => setFilter(state)}
              >
                {state === "all" ? "All on this page" : lanes[state]} ·{" "}
                {state === "all" ? rows.length : count(state)}
              </Button>
            ))}
          </div>
          <div className="case-queue-layout">
            <Panel
              title="Document cases"
              aside={<small>{visible.length} shown · page counts</small>}
              className="case-queue-table-panel"
            >
              <div className="case-table-scroll">
                <table className="case-table">
                  <thead>
                    <tr>
                      <th>Case / Subject</th>
                      <th>Case type / Document Set</th>
                      <th>Docs</th>
                      <th>Checks</th>
                      <th>Issues</th>
                      <th>Assigned reviewers</th>
                      <th>Top finding</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.uid}>
                        <td>
                          <button
                            className="case-row-link"
                            onClick={() => navigate(`/review/${row.uid}`)}
                          >
                            {row.subject?.full_name ?? "Case is being updated"}
                          </button>
                          <small>
                            {row.subject?.external_reference ||
                              shortId(row.uid)}
                          </small>
                        </td>
                        <td>
                          <strong>
                            {row.case_type?.name ?? human(row.case_type_key)}
                          </strong>
                          <br />
                          {catalog.sets.find(
                            (s) =>
                              s.key === row.set_key &&
                              s.version === row.set_version,
                          )?.name ?? human(row.set_key)}
                          <small>Document Set v{row.set_version}</small>
                        </td>
                        <td>{row.document_count ?? "—"}</td>
                        <td>
                          <strong>
                            {row.summary?.satisfied_requirements ?? "—"} /{" "}
                            {row.summary?.mandatory_requirements ?? "—"}
                          </strong>
                          <small>Mandatory satisfied</small>
                        </td>
                        <td>
                          <span className="case-issue-count">
                            {row.finding_counts.failed ?? 0}
                          </span>{" "}
                          <span className="case-review-count">
                            {row.finding_counts.pending_review ?? 0}
                          </span>
                          <small>Failed · Review</small>
                        </td>
                        <td>
                          {row.reviewers.length ? (
                            row.reviewers.map((r: Row) => (
                              <span
                                className="case-reviewer"
                                key={r.reviewer_uid}
                              >
                                {reviewerName(r)}
                              </span>
                            ))
                          ) : (
                            <span className="muted">Unassigned</span>
                          )}
                        </td>
                        <td className="case-top-finding">
                          {row.top_finding
                            ? human(row.top_finding.requirement_key)
                            : row.error_code
                              ? "Refresh after the current change"
                              : "No outstanding findings"}
                          {row.top_finding?.explanation && <small>{row.top_finding.explanation}</small>}
                          <small>
                            {row.latest_evaluated_at
                              ? `Retained ${recordedTime(row.latest_evaluated_at)}`
                              : "No retained evaluation"}
                          </small>
                        </td>
                        <td>
                          <Lane value={row.workflow_state} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!visible.length && (
                <div className="case-empty">
                  {rows.length
                    ? "No cases match this page filter."
                    : "No matching cases. Create a case by choosing a subject, business type and Document Set version."}
                  <Button onClick={() => navigate("/persons")}>
                    Open subjects
                  </Button>
                </div>
              )}
              <footer className="case-pagination">
                <span>
                  {loaded.data?.total_items
                    ? `${offset + 1}–${offset + rows.length} of ${loaded.data.total_items}`
                    : "0 cases"}
                </span>
                <div className="actions">
                  <Button
                    size="small"
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 10))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="small"
                    disabled={!loaded.data?.has_more}
                    onClick={() => setOffset(offset + 10)}
                  >
                    Next
                  </Button>
                </div>
              </footer>
            </Panel>
            <aside className="case-queue-sidebar">
              <Panel
                title="State distribution"
                aside={<small>This page</small>}
              >
                <div className="case-distribution">
                  {Object.entries(lanes).map(([key, title]) => (
                    <div key={key}>
                      <span>{title}</span>
                      <meter
                        min="0"
                        max={Math.max(1, rows.length)}
                        value={count(key)}
                      />{" "}
                      <strong>{count(key)}</strong>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel
                title="Frequent top findings"
                aside={<small>This page</small>}
              >
                <div className="case-distribution">
                  {frequent.length ? (
                    frequent.map(([key, n]) => (
                      <div key={key}>
                        <span>{human(key)}</span>
                        <strong>{n}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      No outstanding top findings on this page.
                    </p>
                  )}
                </div>
              </Panel>
              <Panel title="One review engine">
                <div className="case-panel-copy">
                  <p>
                    Loans, new accounts and other document sets use the same
                    evidence and review workflow.
                  </p>
                  <p>
                    Policies remain pinned to a version. Assigning a reviewer
                    changes responsibility, not access or approval.
                  </p>
                </div>
              </Panel>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

export function CaseWorkspace({
  uid,
  runUid = "",
  report = false,
  catalog,
}: {
  uid: string;
  runUid?: string;
  report?: boolean;
  catalog: Catalog;
}) {
  const loaded = useLoad(
    (signal) => api.get(`/cases/${uid}/workspace`, signal),
    [uid, runUid],
  );
  const detailRef = useRef<HTMLElement>(null);
  const viewport = useCommandCenterViewport();
  const [selection, setSelection] = useState<{
    requirement: string;
    document: string;
  }>();
  const [source, setSource] = useState<Row>();
  const [focus, setFocus] = useState<Row>();
  const [reason, setReason] = useState("");
  const [fieldDrafts, setFieldDrafts] = useState<
    Record<string, { revision: number; payload: Row }>
  >({});
  const [fieldsPending, setFieldsPending] = useState(false);
  const action = useAction(loaded.refresh);
  const data = loaded.data;
  const docs: Row[] = data?.documents ?? [];
  const findings: Row[] = data?.status.findings ?? [];
  const requirements = groupRequiredEvidence(
    findings,
    docs,
    data?.policy ?? {},
  );
  const active =
    requirements.find((item) => item.key === selection?.requirement) ??
    requirements.find((item) => item.documents.length) ??
    requirements[0];
  const doc =
    active?.documents.find((item) => item.uid === selection?.document) ??
    active?.documents[0];
  const fieldKey = doc ? `${doc.uid}:${doc.revision}` : "";
  const savedPayload = doc?.payload ?? {};
  const fieldPayload = (doc && fieldDrafts[doc.uid]?.payload) ?? savedPayload;
  const fieldsDirty =
    JSON.stringify(fieldPayload) !== JSON.stringify(savedPayload);
  const anyFieldsDirty = Object.keys(fieldDrafts).length > 0;
  function changeFields(payload: Row) {
    setFieldDrafts((previous) => {
      const next = { ...previous };
      if (JSON.stringify(payload) === JSON.stringify(savedPayload))
        delete next[doc!.uid];
      else
        next[doc!.uid] = {
          revision: previous[doc!.uid]?.revision ?? doc!.revision,
          payload,
        };
      return next;
    });
  }
  function reloadDocumentFields() {
    changeFields(savedPayload);
    loaded.refresh();
  }
  const result = data?.latest_evaluation;
  const observations: Row[] =
    result && !result.stale
      ? (result.input_snapshot?.comparison_result?.observations ?? [])
      : [];
  const documentComparisons = observations.filter((item) =>
    [item.left, item.right].some((fact) => fact.document_id === doc?.uid),
  ).length;
  const comparisonKeys = new Set(
    (active?.finding?.document_references ?? [])
      .map((ref: Row) => ref.comparison_key)
      .filter(Boolean),
  );
  const comparisons = observations.filter((observation) =>
    comparisonKeys.has(observation.key),
  );
  function selectRequirement(
    requirement: EvidenceRequirement,
    document = requirement.documents[0]?.uid ?? "",
  ) {
    setSelection({ requirement: requirement.key, document });
    setSource(undefined);
    setFocus(undefined);
    setReason("");
  }
  useEffect(() => {
    if (
      selection &&
      (viewport.breakpoint === "xs" || viewport.breakpoint === "sm")
    )
      detailRef.current?.scrollIntoView({ block: "start" });
  }, [selection]);
  function cite(fact: Row, citation: Row) {
    const requirement = active?.documents.some(
      (item) => item.uid === fact.document_id,
    )
      ? active
      : requirements.find((item) =>
          item.documents.some((document) => document.uid === fact.document_id),
        );
    if (!requirement) return;
    selectRequirement(requirement, fact.document_id);
    setSource(citation);
    setFocus(fact);
  }
  useEffect(() => {
    if (result?.stale || (focus && doc?.revision !== focus.revision)) {
      setSource(undefined);
      setFocus(undefined);
    }
  }, [result?.stale, doc?.uid, doc?.revision]);
  const evidence = useLoad(
    (signal) =>
      doc
        ? api.get(
            `/documents/${doc.uid}/revisions/${doc.revision}/extraction-evidence`,
            signal,
          )
        : Promise.resolve(undefined),
    [doc?.uid, doc?.revision],
  );
  const selectedEvidence =
    evidence.loading || evidence.error ? undefined : evidence.data?.evidence;
  const pages: Row[] = doc?.evidence_summary?.pages ?? [];
  const activeSource =
    source ??
    (pages[0]
      ? {
          source_id: pages[0].source_uid,
          page: pages[0].page,
          source_sha256: pages[0].source_sha256,
        }
      : doc?.raw_document_refs?.[0]
        ? {
            source_id: doc.raw_document_refs[0].raw_document_uid,
            page: doc.raw_document_refs[0].first_page ?? 1,
          }
        : undefined);
  async function evaluate() {
    const current = await api.get(`/cases/${uid}`);
    const response = await api.command(`/cases/${uid}/evaluations`, {
      expected_revision: current.revision,
    });
    if (response.processing_run_uid)
      navigate(`/review/${uid}?run=${response.processing_run_uid}`);
    else loaded.refresh();
  }
  if (loaded.loading || loaded.error || !data)
    return (
      <ApplicationPage maxWidth="full">
        <ResourceDetailShell
          loading={loaded.loading}
          error={
            loaded.error ? (
              <>
                <Loading error={loaded.error} />
                <Button onClick={loaded.refresh}>Reload case</Button>
              </>
            ) : undefined
          }
          breadcrumbs={[
            {
              id: "queue",
              label: "Case queue",
              onSelect: () => navigate("/queue"),
            },
            { id: uid, label: "Case review" },
          ]}
        />
      </ApplicationPage>
    );
  if (report) return <CaseReport data={data} />;
  return (
    <ApplicationPage className="case-workspace" maxWidth="full">
      <ResourceDetailShell
        contentVariant="plain"
        breadcrumbs={[
          {
            id: "queue",
            label: "Case queue",
            onSelect: () => navigate("/queue"),
          },
          { id: uid, label: `Case ${shortId(uid)}` },
        ]}
        headerActions={
          <>
            <Button onClick={() => navigate(`/persons/${data.subject.uid}`)}>
              Subject details
            </Button>
            <Button
              onClick={() => navigate(`/review/${uid}?view=report`)}
              disabled={!result}
            >
              Control report
            </Button>
            <Button
              variant="primary"
              pending={action.pending}
              disabled={fieldsPending || anyFieldsDirty}
              title={
                anyFieldsDirty
                  ? "Save document field changes before running checks."
                  : undefined
              }
              onClick={() => void action.run(evaluate, "Evaluation requested.")}
            >
              Run checks
            </Button>
          </>
        }
        summary={
          <header className="case-page-heading">
            <div>
              <p className="case-eyebrow">
                {data.case.case_type.name} · {data.policy.name} v
                {data.assignment.set_version}
              </p>
              <h1>{data.subject.full_name || "Unnamed subject"}</h1>
              <p className="muted">
                Case subject ·{" "}
                {data.subject.external_reference || "No external reference"}
              </p>
            </div>
            <Lane value={data.workflow_state} />
          </header>
        }
      >
        <ApplicationPageStack>
          <OperationRecovery />
          <div className="case-workspace-summary">
            <div className="case-review-metrics" aria-label="Case summary">
              <span>
                <strong>
                  {data.status.summary.satisfied_requirements} /{" "}
                  {data.status.summary.mandatory_requirements}
                </strong>{" "}
                mandatory checks satisfied
              </span>
              <span>
                <strong>{docs.length}</strong> linked documents
              </span>
              <span>
                <strong>{data.page_count || "—"}</strong> cited source pages
              </span>
            </div>
            <div className="case-responsibility">
              <div>
                <span className="case-eyebrow">Assigned reviewers</span>
                <div className="actions">
                  {data.reviewers.items.length ? (
                    data.reviewers.items.map((reviewer: Row) => (
                      <span
                        className="case-reviewer"
                        key={reviewer.reviewer_uid}
                      >
                        {reviewerName(reviewer)}
                        {reviewer.reviewer_uid === catalog.viewer.user_uid
                          ? " · you"
                          : ""}
                      </span>
                    ))
                  ) : (
                    <span className="muted">No staff reviewer assigned</span>
                  )}
                </div>
              </div>
              {catalog.viewer.can_review && (
                <Button
                  size="small"
                  pending={action.pending}
                  disabled={fieldsPending}
                  onClick={() =>
                    void action.run(
                      () =>
                        api.command(
                          `/cases/${uid}/reviewers/me`,
                          {
                            expected_revision: data.reviewers.my_revision,
                            assigned: !data.reviewers.assigned_to_me,
                          },
                          "PUT",
                        ),
                      "Reviewer responsibility updated.",
                    )
                  }
                >
                  {data.reviewers.assigned_to_me
                    ? "Leave case"
                    : "Assign to me"}
                </Button>
              )}
            </div>
          </div>
          {action.feedback}
          {runUid && (
            <ProcessingRun
              uid={runUid}
              personUid={data.subject.uid}
              comparison
              onOpenResult={() => navigate(`/review/${uid}`)}
            />
          )}
          {result?.stale && (
            <Notice>
              The last retained evaluation is out of date. Current findings
              below use current evidence; its old comparison observations are
              not applied. Run checks to retain a new result.
            </Notice>
          )}
          <div className="case-evidence-workspace">
            <aside
              className="case-evidence-navigation"
              aria-label="Required evidence navigation"
            >
              <ApplicationCard
                contentPadding="none"
                header={
                  <div className="case-section-heading">
                    <h2>Required evidence</h2>
                    <small className="muted">
                      Policy v{data.policy.version}
                    </small>
                  </div>
                }
              >
                <ul className="case-evidence-list">
                  {requirements.map((requirement) => (
                    <li
                      key={requirement.key}
                      data-requirement-key={requirement.key}
                      className={
                        active?.key === requirement.key ? "is-selected" : ""
                      }
                    >
                      <Button
                        className="case-requirement-select"
                        variant="ghost"
                        aria-pressed={active?.key === requirement.key}
                        disabled={fieldsPending}
                        onClick={() => selectRequirement(requirement)}
                      >
                        <span className="case-requirement-name">
                          <strong>{requirement.title}</strong>
                          <small>
                            {requirement.comparison
                              ? "Cross-document check"
                              : requirement.finding?.mandatory
                                ? "Mandatory"
                                : requirement.finding
                                  ? "Optional"
                                  : "Case documents"}
                          </small>
                        </span>
                        {requirement.finding && (
                          <Status value={requirement.finding.status} />
                        )}
                      </Button>
                      <div className="case-requirement-content">
                        {requirement.finding && (
                          <p className="case-requirement-finding">
                            {requirement.finding.explanation}
                          </p>
                        )}
                        {requirement.documents.length ? (
                          <div
                            className="case-requirement-documents"
                            aria-label={`${requirement.title} linked documents`}
                          >
                            <small className="case-eyebrow">
                              Linked documents · {requirement.documents.length}
                            </small>
                            {requirement.documents.map((document) => (
                              <Button
                                key={document.uid}
                                variant={
                                  active?.key === requirement.key &&
                                  doc?.uid === document.uid
                                    ? "secondary"
                                    : "ghost"
                                }
                                className="case-linked-document"
                                aria-pressed={
                                  active?.key === requirement.key &&
                                  doc?.uid === document.uid
                                }
                                disabled={fieldsPending}
                                onClick={() =>
                                  selectRequirement(requirement, document.uid)
                                }
                              >
                                <span>
                                  <strong>
                                    {human(document.document_type)}
                                  </strong>
                                  <small>
                                    Revision {document.revision} ·{" "}
                                    {document.status === "draft"
                                      ? "Draft"
                                      : human(document.review_status)}{" "}
                                    · {shortId(document.uid)}
                                    {fieldDrafts[document.uid]
                                      ? " · Unsaved changes"
                                      : ""}
                                  </small>
                                </span>
                                <span aria-hidden="true">→</span>
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <p className="case-missing-evidence">
                            No linked document
                            {requirement.options.length
                              ? ` · ${[...new Set(requirement.options.map((option) => human(option.document_type)))].join(" or ")}`
                              : ""}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {!requirements.length && (
                  <p className="muted case-panel-copy">
                    No evidence requirements are defined for this case.
                  </p>
                )}
              </ApplicationCard>
              <div className="actions">
                <Button
                  onClick={() =>
                    navigate(`/persons/${data.subject.uid}?tab=requirements`)
                  }
                >
                  Manage linked evidence
                </Button>
                <Button
                  onClick={() =>
                    navigate(`/documents?person=${data.subject.uid}`)
                  }
                >
                  Add source evidence
                </Button>
              </div>
            </aside>
            <section
              className="case-evidence-detail"
              ref={detailRef}
              aria-label="Evidence details"
            >
              {active && (
                <ApplicationCard
                  className="case-requirement-detail"
                  header={
                    <div className="case-section-heading">
                      <div>
                        <p className="case-eyebrow">Selected requirement</p>
                        <h2>{active.title}</h2>
                      </div>
                      {active.finding && (
                        <Status value={active.finding.status} />
                      )}
                    </div>
                  }
                >
                  <div className="form-stack">
                    {active.finding ? (
                      <>
                        <p>{active.finding.explanation}</p>
                        {active.finding.next_action && (
                          <p className="muted">{active.finding.next_action}</p>
                        )}
                      </>
                    ) : (
                      <p>
                        These case-linked documents are not associated with a
                        current requirement.
                      </p>
                    )}
                    {comparisons.map((observation) => (
                      <div className="case-comparison" key={observation.key}>
                        <p>{observation.explanation}</p>
                        <div className="case-comparison-values">
                          {[observation.left, observation.right].map(
                            (fact: Row, i: number) => (
                              <div
                                className="case-compared-value"
                                key={`${fact.document_id}:${fact.pointer}:${i}`}
                              >
                                <small>
                                  {human(
                                    docs.find(
                                      (document) =>
                                        document.uid === fact.document_id,
                                    )?.document_type ?? "document",
                                  )}{" "}
                                  · {evidenceFieldLabel(fact.pointer)}
                                </small>
                                <strong>{label(fact.value)}</strong>
                                <div className="actions">
                                  {fact.citations.map(
                                    (citation: Row, n: number) => (
                                      <Button
                                        key={n}
                                        size="small"
                                        onClick={() => cite(fact, citation)}
                                      >
                                        Inspect page {citation.page}
                                      </Button>
                                    ),
                                  )}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ApplicationCard>
              )}
              {doc ? (
                <section
                  className="case-selected-document"
                  aria-label="Selected document"
                  data-document-uid={doc.uid}
                >
                  <ApplicationPageStack>
                    <ApplicationCard className="case-document-summary">
                      <div
                        className="case-document-states"
                        aria-label="Document states"
                      >
                        {fieldsDirty && (
                          <Badge variant="warning">Unsaved changes</Badge>
                        )}
                        <Status
                          value={
                            doc.status === "draft" ? "draft" : doc.review_status
                          }
                        />
                        <Badge
                          variant={
                            evidence.error ||
                            (!evidence.loading && !selectedEvidence)
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {evidence.loading
                            ? "Loading evidence…"
                            : evidence.error
                              ? "Evidence unavailable"
                              : selectedEvidence
                                ? "Extraction retained"
                                : "No extraction evidence"}
                        </Badge>
                        <Badge variant={result?.stale ? "warning" : "neutral"}>
                          {result?.stale
                            ? "Checks out of date"
                            : !result
                              ? "Not checked"
                              : documentComparisons
                                ? `${documentComparisons} cited comparisons`
                                : "No cited comparisons"}
                        </Badge>
                        <span className="muted">
                          Policy v{data.policy.version}
                        </span>
                      </div>
                      <DocumentReviewReason document={doc} changed={fieldsDirty} finding={data.status.findings.find((finding: Row) =>
                        ["missing", "needs_information"].includes(finding.status) && finding.document_references.some((ref: Row) => ref.document_uid === doc.uid && ref.revision === doc.revision)
                      )} />
                      <div className="case-section-heading">
                        <div>
                          <p className="case-eyebrow">
                            Selected document · {active?.title}
                          </p>
                          <h2>
                            {human(doc.document_type)}{" "}
                            <span className="case-document-revision">
                              · Revision {doc.revision}
                            </span>
                          </h2>
                        </div>
                        <Button
                          size="small"
                          onClick={() =>
                            navigate(
                              `/documents/${doc.uid}?revision=${doc.revision}`,
                            )
                          }
                        >
                          Open document record
                        </Button>
                      </div>
                      <dl className="document-dates">
                        <div>
                          <dt>Classification confidence</dt>
                          <dd>
                            {doc.parsing_result?.parsing_score_percent == null
                              ? "Not supplied"
                              : `${doc.parsing_result.parsing_score_percent}%`}
                          </dd>
                        </div>
                      </dl>
                    </ApplicationCard>
                    <div className="case-document-detail-grid">
                      <ApplicationCard
                        contentPadding="none"
                        className="case-document-source"
                        header={<h2>Source document</h2>}
                      >
                        {pages.length > 0 && (
                          <nav
                            className="case-page-tabs"
                            aria-label="Source pages"
                          >
                            {pages.map((page, i) => (
                              <Button
                                key={`${page.source_uid}:${page.page}:${i}`}
                                size="small"
                                variant={
                                  activeSource?.source_id === page.source_uid &&
                                  activeSource?.page === page.page
                                    ? "primary"
                                    : "secondary"
                                }
                                onClick={() =>
                                  setSource({
                                    source_id: page.source_uid,
                                    source_sha256: page.source_sha256,
                                    page: page.page,
                                  })
                                }
                              >
                                Page {page.page}
                              </Button>
                            ))}
                          </nav>
                        )}
                        <div className="case-source-viewer">
                          {activeSource ? (
                            <SourcePreview
                              key={`${doc.uid}:${activeSource.source_id}`}
                              uid={activeSource.source_id}
                              page={activeSource.page}
                              expectedSha256={activeSource.source_sha256}
                            />
                          ) : (
                            <Notice>No original source is linked.</Notice>
                          )}
                        </div>
                        {focus && (
                          <div className="case-focus-value">
                            <small>
                              Cited comparison ·{" "}
                              {evidenceFieldLabel(focus.pointer)}
                            </small>
                            <strong>{label(focus.value)}</strong>
                          </div>
                        )}
                      </ApplicationCard>
                      <CaseDocumentFields
                        key={fieldKey}
                        document={doc}
                        payload={fieldPayload}
                        draftRevision={
                          fieldDrafts[doc.uid]?.revision ?? doc.revision
                        }
                        onChange={changeFields}
                        onPendingChange={setFieldsPending}
                        onSaved={reloadDocumentFields}
                        onReload={reloadDocumentFields}
                      />
                    </div>
                    <ApplicationCard
                      className="case-document-review"
                      header={
                        <div className="case-section-heading">
                          <h2>Review selected revision</h2>
                          <Status
                            value={
                              doc.status === "draft"
                                ? "draft"
                                : doc.review_status
                            }
                          />
                        </div>
                      }
                    >
                      <div className="form-stack">
                        <p>
                          {human(doc.document_type)} · Revision {doc.revision}
                        </p>
                        {doc.latest_review && <p>{doc.latest_review.reason}</p>}
                        {catalog.viewer.can_review &&
                        doc.status === "submitted" &&
                        !fieldsDirty &&
                        !fieldsPending ? (
                          <>
                            <Field label="Review comments (optional)">
                              <Textarea
                                rows={3}
                                value={reason}
                                onChange={(event) =>
                                  setReason(event.target.value)
                                }
                              />
                            </Field>
                            <div className="actions">
                              {["accepted", "rejected"].map((decision) => (
                                <Button
                                  key={decision}
                                  size="small"
                                  variant={
                                    decision === "accepted"
                                      ? "primary"
                                      : "danger"
                                  }
                                  pending={action.pending}
                                  onClick={() =>
                                    void action.run(
                                      () =>
                                        api.command(
                                          `/documents/${doc.uid}/reviews`,
                                          {
                                            expected_revision: doc.revision,
                                            expected_decision_sequence:
                                              doc.latest_review
                                                ?.decision_sequence ?? 0,
                                            decision,
                                            comments: reason,
                                          },
                                        ),
                                      "Revision review recorded.",
                                    )
                                  }
                                >
                                  {decision === "accepted"
                                    ? "Accept revision"
                                    : "Reject revision"}
                                </Button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="muted">
                            {fieldsDirty || fieldsPending
                              ? "Save field changes before reviewing this document."
                              : doc.status !== "submitted"
                                ? "Complete and submit the draft before review."
                                : "An authorized reviewer must record the decision."}
                          </p>
                        )}
                        <div>
                          <Button
                            size="small"
                            onClick={() => navigate(`/documents/${doc.uid}`)}
                          >
                            Correct attributes
                          </Button>
                        </div>
                      </div>
                    </ApplicationCard>
                  </ApplicationPageStack>
                </section>
              ) : (
                <ApplicationCard className="case-no-document">
                  <div className="case-empty">
                    <h2>No linked document</h2>
                    <p>
                      {active
                        ? `Add evidence for ${active.title.toLowerCase()} to inspect its source and extracted fields here.`
                        : "Select required evidence to inspect a linked document."}
                    </p>
                    <Button
                      onClick={() =>
                        navigate(`/documents?person=${data.subject.uid}`)
                      }
                    >
                      Add source evidence
                    </Button>
                  </div>
                </ApplicationCard>
              )}
            </section>
          </div>
          {!!data.policy.comparisons?.length && (
            <details className="case-policy-details">
              <summary>
                Versioned cross-document rules · policy v{data.policy.version}
              </summary>
              <ComparisonPolicy rules={data.policy.comparisons} />
            </details>
          )}
        </ApplicationPageStack>
      </ResourceDetailShell>
    </ApplicationPage>
  );
}

function CaseReport({ data }: { data: Row }) {
  const row = data.latest_evaluation;
  if (!row)
    return (
      <main className="case-dashboard">
        <Notice>Run checks to create a retained report.</Notice>
      </main>
    );
  const snapshot = row.input_snapshot;
  return (
    <main className="case-report">
      <div className="actions case-no-print">
        <Button onClick={() => navigate(`/review/${data.assignment.uid}`)}>
          Back to review
        </Button>
        <Button variant="primary" onClick={() => window.print()}>
          Print / save PDF
        </Button>
      </div>
      <p className="case-eyebrow">Back Office · Retained control report</p>
      <h1>{snapshot.person.full_name}</h1>
      <p>
        {snapshot.policy.name} · Policy v{row.set_version} ·{" "}
        {recordedTime(row.created_at)}
      </p>
      {row.stale && (
        <Notice>
          This retained report is out of date; it is not a current assessment.
        </Notice>
      )}
      <dl>
        <dt>Evaluation</dt>
        <dd>{row.uid}</dd>
        <dt>Case</dt>
        <dd>{row.assignment_uid}</dd>
        <dt>Subject revision</dt>
        <dd>{row.person_revision}</dd>
        <dt>Requirement result</dt>
        <dd>
          {row.summary.complete
            ? "Applicable mandatory checks satisfied"
            : "Outstanding requirements"}
        </dd>
      </dl>
      <h2>Checks and cited evidence</h2>
      {row.findings.map((f: Row) => (
        <section className="case-report-finding" key={f.uid}>
          <h3>
            {human(f.requirement_key)} · {human(f.status)}
          </h3>
          <p>{f.explanation}</p>
          {f.document_references
            .filter((r: Row) => r.citations)
            .map((r: Row, i: number) => (
              <p key={i}>
                Document {r.document_uid} · revision {r.revision} · {r.pointer}:{" "}
                <strong>{label(r.value)}</strong> · pages{" "}
                {r.citations.map((c: Row) => c.page).join(", ")}
              </p>
            ))}
        </section>
      ))}
      <p className="case-report-disclaimer">
        This report supports human review. It is not automatic loan or account
        approval and is not a signed protocol.
      </p>
    </main>
  );
}

export function CaseCreation({
  personUid,
  onCreated,
}: {
  personUid?: string;
  onCreated: (uid: string) => void;
}) {
  const types = useLoad((signal) => api.get("/case-types", signal), []);
  const [subject, setSubject] = useState(personUid ?? "");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [caseType, setCaseType] = useState("");
  const [policy, setPolicy] = useState("");
  const action = useAction();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const subjects = useLoad(
    (signal) =>
      personUid
        ? Promise.resolve({ items: [] })
        : api.get(
            `/persons?${new URLSearchParams({ search: query, limit: "20", offset: "0" })}`,
            signal,
          ),
    [query, personUid],
  );
  const chosen = types.data?.items.find((t: Row) => t.key === caseType);
  const policies: Row[] = chosen?.document_sets ?? [];
  return (
    <Panel title="Create a case">
      <form
        className="case-panel-copy form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!subject || !caseType || !policy) return;
          void action.run(async () => {
            const selected = policies.find(
              (p) => `${p.key}@${p.version}` === policy,
            );
            if (!selected)
              throw new Error("Choose a permitted Document Set version.");
            const result = await api.command("/cases", {
              subject_uid: subject,
              case_type_key: caseType,
              document_set_key: selected.key,
              document_set_version: selected.version,
            });
            onCreated(result.uid);
          }, "Case created with its pinned Document Set.");
        }}
      >
        <p>
          Choose the business process first, then its exact Document Set
          version. Evidence can be added afterward.
        </p>
        {types.error && <Notice error>{types.error}</Notice>}
        {subjects.error && <Notice error>{subjects.error}</Notice>}
        <div className="field-grid">
          {!personUid && (
            <Field label="Case subject" required>
              <ResourcePicker
                ariaLabel="Case subject"
                searchable
                searchPlaceholder="Search subjects by name or reference"
                onSearchValueChange={setSearch}
                value={subject}
                onValueChange={setSubject}
                loading={subjects.loading}
                placeholder="Choose a subject"
                options={(subjects.data?.items ?? []).map((p: Row) => ({
                  value: p.uid,
                  label: p.full_name || "Unnamed subject",
                  subtitle: p.external_reference || p.uid,
                }))}
              />
            </Field>
          )}
          <Field label="Case type" required>
            <ResourcePicker
              ariaLabel="New case type"
              value={caseType}
              onValueChange={(value) => {
                setCaseType(value);
                setPolicy("");
              }}
              loading={types.loading}
              placeholder="Choose the business process"
              options={(types.data?.items ?? []).map((t: Row) => ({
                value: t.key,
                label: t.name,
                subtitle: t.description,
              }))}
            />
          </Field>
          <Field label="Document Set version" required>
            <ResourcePicker
              ariaLabel="Document Set version"
              value={policy}
              onValueChange={setPolicy}
              disabled={!caseType}
              placeholder="Choose a permitted version"
              options={policies.map((p) => ({
                value: `${p.key}@${p.version}`,
                label: `${p.name} · v${p.version}`,
                meta: `Version ${p.version}`,
              }))}
            />
          </Field>
        </div>
        {chosen && !policies.length && (
          <Notice>
            This case type has no published Document Set available for creation.
          </Notice>
        )}
        {action.feedback}
        <div className="actions">
          <Button
            type="submit"
            variant="primary"
            pending={action.pending}
            disabled={!subject || !caseType || !policy}
          >
            Create case
          </Button>
        </div>
      </form>
    </Panel>
  );
}
