import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Input,
  Textarea,
  Field,
} from "@dev-mainsequence/command-center-sdk/controls";
import { ResourcePicker } from "@dev-mainsequence/command-center-sdk/views";
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
  const [selected, setSelected] = useState("");
  const [source, setSource] = useState<Row>();
  const [focus, setFocus] = useState<Row>();
  const [reason, setReason] = useState("");
  const [findingFilter, setFindingFilter] = useState("outstanding");
  const action = useAction(loaded.refresh);
  const data = loaded.data;
  const docs: Row[] = data?.documents ?? [];
  useEffect(() => {
    if (data && !docs.some((d) => d.uid === selected))
      setSelected(docs[0]?.uid ?? "");
  }, [data, selected]);
  const doc = docs.find((d) => d.uid === selected);
  function selectDocument(id: string) {
    setSelected(id);
    setSource(undefined);
    setFocus(undefined);
    setReason("");
  }
  useEffect(() => {
    if (
      data?.latest_evaluation?.stale ||
      (focus && doc?.revision !== focus.revision)
    ) {
      setSource(undefined);
      setFocus(undefined);
    }
  }, [data?.latest_evaluation?.stale, doc?.revision]);
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
  if (loaded.loading || loaded.error || !data)
    return (
      <main className="case-dashboard">
        <Button onClick={() => navigate("/queue")}>Back to queue</Button>
        <Loading error={loaded.error} />
        <Button onClick={loaded.refresh}>Reload case</Button>
      </main>
    );
  if (report) return <CaseReport data={data} />;
  const findings: Row[] = data.status.findings;
  const result = data.latest_evaluation;
  const observations: Row[] =
    result && !result.stale
      ? (result.input_snapshot?.comparison_result?.observations ?? [])
      : [];
  const pages: Row[] = doc?.evidence_summary?.pages ?? [];
  const activeSource =
    source ??
    (pages[0]
      ? {
          source_id: pages[0].source_uid,
          page: pages[0].page,
          source_sha256: pages[0].source_sha256,
        }
      : doc?.raw_document_refs[0]
        ? {
            source_id: doc.raw_document_refs[0].raw_document_uid,
            page: doc.raw_document_refs[0].first_page ?? 1,
          }
        : undefined);
  const selectedEvidence = evidence.data?.evidence;
  function cite(fact: Row, citation: Row) {
    selectDocument(fact.document_id);
    setSource(citation);
    setFocus(fact);
  }
  async function evaluate() {
    const current = await api.get(`/cases/${uid}`);
    const response = await api.command(`/cases/${uid}/evaluations`, {
      expected_revision: current.revision,
    });
    if (response.processing_run_uid)
      navigate(`/review/${uid}?run=${response.processing_run_uid}`);
    else loaded.refresh();
  }
  return (
    <main className="case-dashboard case-workspace">
      <OperationRecovery />
      <header className="case-page-heading">
        <div>
          <button className="case-back" onClick={() => navigate("/queue")}>
            ← Case queue
          </button>
          <p className="case-eyebrow">
            {data.case.case_type.name} · Case {shortId(uid)} ·{" "}
            {data.policy.name} v{data.assignment.set_version}
          </p>
          <h1>{data.subject.full_name || "Unnamed subject"}</h1>
          <p className="muted">
            Case subject ·{" "}
            {data.subject.external_reference || "No external reference"}
          </p>
        </div>
        <div className="case-heading-actions">
          <Lane value={data.workflow_state} />
          <div className="actions">
            <Button
              onClick={() => navigate(`/review/${uid}?view=report`)}
              disabled={!result}
            >
              Control report
            </Button>
            <Button
              variant="primary"
              pending={action.pending}
              onClick={() => void action.run(evaluate, "Evaluation requested.")}
            >
              Run checks
            </Button>
          </div>
        </div>
      </header>
      <div className="case-stats">
        <Stat
          title="Mandatory checks"
          value={`${data.status.summary.satisfied_requirements} / ${data.status.summary.mandatory_requirements}`}
          detail="Satisfied under the pinned policy"
        />
        <Stat
          title="Linked documents"
          value={docs.length}
          detail={`${docs.filter((d) => d.accepted).length} accepted revisions`}
        />
        <Stat
          title="Source pages"
          value={data.page_count || "—"}
          detail={
            data.page_count_complete
              ? "Cited physical pages"
              : "Only pages with extraction evidence counted"
          }
        />
        <Stat
          title="Assigned reviewers"
          value={data.reviewers.items.length}
          detail="Staff responsibility, separate from subject"
        />
      </div>
      <div className="case-responsibility">
        <div>
          <span className="case-eyebrow">Assigned reviewers</span>
          <div className="actions">
            {data.reviewers.items.length ? (
              data.reviewers.items.map((r: Row) => (
                <span className="case-reviewer" key={r.reviewer_uid}>
                  {reviewerName(r)}
                  {r.reviewer_uid === catalog.viewer.user_uid ? " · you" : ""}
                </span>
              ))
            ) : (
              <span className="muted">No staff reviewer assigned</span>
            )}
          </div>
        </div>
        {catalog.viewer.can_review && (
          <Button
            pending={action.pending}
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
            {data.reviewers.assigned_to_me ? "Leave case" : "Assign to me"}
          </Button>
        )}
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
          The last retained evaluation is out of date. Current findings below
          use current evidence; its old comparison observations are not applied.
          Run checks to retain a new result.
        </Notice>
      )}
      <div className="case-review-grid">
        <aside className="case-left-column">
          <Panel
            title="Required evidence"
            aside={<small>Policy v{data.policy.version}</small>}
          >
            <ul className="case-requirements">
              {findings.map((f) => (
                <li key={f.requirement_key}>
                  <span
                    className={`case-state-dot case-state-dot--${f.status}`}
                  />
                  <div>
                    <strong>{human(f.requirement_key)}</strong>
                    <small>
                      {human(f.status)}
                      {f.mandatory ? " · Mandatory" : " · Optional"}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel
            title="Linked documents"
            aside={
              <Button
                size="small"
                onClick={() =>
                  navigate(`/persons/${data.subject.uid}?tab=requirements`)
                }
              >
                Manage
              </Button>
            }
          >
            <div className="case-document-list">
              {docs.map((d) => (
                <button
                  key={d.uid}
                  className={selected === d.uid ? "selected" : ""}
                  onClick={() => selectDocument(d.uid)}
                >
                  <span
                    className={`case-state-dot case-state-dot--${d.accepted ? "satisfied" : "pending_review"}`}
                  />
                  <span>
                    <strong>{human(d.document_type)}</strong>
                    <small>
                      Revision {d.revision} · {human(d.review_status)}
                    </small>
                    <small>
                      {d.evidence_summary.field_count} cited fields ·{" "}
                      {d.evidence_summary.pages.length || "—"} pages
                    </small>
                  </span>
                </button>
              ))}
              {!docs.length && (
                <p className="case-panel-copy muted">
                  Link a subject's documents to begin review.
                </p>
              )}
            </div>
          </Panel>
          <Button
            onClick={() => navigate(`/documents?person=${data.subject.uid}`)}
          >
            Add source evidence
          </Button>
        </aside>
        <section className="case-middle-column">
          <Panel
            title={doc ? human(doc.document_type) : "Source document"}
            aside={doc && <small>Revision {doc.revision}</small>}
          >
            {doc ? (
              <>
                <nav className="case-page-tabs" aria-label="Source pages">
                  {pages.map((p, i) => (
                    <Button
                      key={`${p.source_uid}:${p.page}:${i}`}
                      size="small"
                      variant={
                        activeSource?.source_id === p.source_uid &&
                        activeSource?.page === p.page
                          ? "primary"
                          : "secondary"
                      }
                      onClick={() =>
                        setSource({
                          source_id: p.source_uid,
                          source_sha256: p.source_sha256,
                          page: p.page,
                        })
                      }
                    >
                      Page {p.page}
                    </Button>
                  ))}
                </nav>
                <div className="case-source-viewer">
                  {activeSource ? (
                    <SourcePreview
                      key={activeSource.source_id}
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
                    <small>Cited comparison · {focus.pointer}</small>
                    <strong>{label(focus.value)}</strong>
                  </div>
                )}
              </>
            ) : (
              <div className="case-empty">Choose a linked document.</div>
            )}
          </Panel>
          {doc && (
            <Panel
              title="Field evidence"
              aside={
                <Button
                  size="small"
                  onClick={() =>
                    navigate(
                      `/documents/${doc.uid}?tab=evidence&revision=${doc.revision}`,
                    )
                  }
                >
                  Full evidence
                </Button>
              }
            >
              {evidence.loading || evidence.error ? (
                <Loading error={evidence.error} />
              ) : !selectedEvidence ? (
                <p className="case-panel-copy muted">
                  No extraction evidence is retained for this revision.
                </p>
              ) : (
                <div className="case-table-scroll">
                  <table className="case-table case-field-table">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Reader values</th>
                        <th>Agreement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEvidence.extraction.field_evidence.map(
                        (f: Row) => (
                          <tr key={f.pointer}>
                            <td>{f.pointer}</td>
                            <td>
                              {f.candidates.map((c: Row) => (
                                <div key={c.reader_id}>
                                  <strong>{label(c.value)}</strong>
                                  <small>
                                    {c.reader_id}{" "}
                                    {f.selected_reader_id === c.reader_id
                                      ? "· selected"
                                      : ""}
                                    {c.confidence == null
                                      ? ""
                                      : ` · confidence ${c.confidence}`}
                                  </small>
                                </div>
                              ))}
                            </td>
                            <td>{human(f.agreement)}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </section>
        <aside className="case-right-column">
          <Panel
            title="Findings"
            aside={
              <span className="case-eyebrow">{findings.length} checks</span>
            }
          >
            <div className="case-filters">
              {["outstanding", "all"].map((f) => (
                <Button
                  key={f}
                  size="small"
                  variant={findingFilter === f ? "primary" : "secondary"}
                  onClick={() => setFindingFilter(f)}
                >
                  {human(f)}
                </Button>
              ))}
            </div>
            {findings
              .filter(
                (f) =>
                  findingFilter === "all" ||
                  !["satisfied", "not_applicable"].includes(f.status),
              )
              .map((f) => {
                const pairs = new Set(
                  (f.document_references ?? [])
                    .map((r: Row) => r.comparison_key)
                    .filter(Boolean),
                );
                const relevant = observations.filter((o) => pairs.has(o.key));
                return (
                  <article
                    className={`case-finding case-finding--${f.status}`}
                    key={f.requirement_key}
                  >
                    <header>
                      <Status value={f.status} />
                      <strong>{human(f.requirement_key)}</strong>
                    </header>
                    <p>{f.explanation}</p>
                    {relevant.map((o) => (
                      <div className="case-comparison" key={o.key}>
                        <p>{o.explanation}</p>
                        {[o.left, o.right].map((fact: Row, i: number) => (
                          <div
                            className="case-compared-value"
                            key={`${fact.document_id}:${fact.pointer}:${i}`}
                          >
                            <small>
                              {human(
                                docs.find((d) => d.uid === fact.document_id)
                                  ?.document_type ?? "document",
                              )}{" "}
                              · {fact.pointer}
                            </small>
                            <strong>{label(fact.value)}</strong>
                            <div className="actions">
                              {fact.citations.map((c: Row, n: number) => (
                                <Button
                                  key={n}
                                  size="small"
                                  onClick={() => cite(fact, c)}
                                >
                                  Inspect page {c.page}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    <p className="muted">{f.next_action}</p>
                    <div className="actions">
                      {[
                        ...new Set<string>(
                          (f.document_references ?? []).map(
                            (r: Row) => r.document_uid,
                          ),
                        ),
                      ].map((id) => (
                        <Button
                          key={id}
                          size="small"
                          onClick={() => selectDocument(id)}
                        >
                          Inspect{" "}
                          {human(
                            docs.find((d) => d.uid === id)?.document_type ??
                              "document",
                          )}
                        </Button>
                      ))}
                    </div>
                  </article>
                );
              })}
            {findingFilter === "outstanding" &&
              findings.every((f) =>
                ["satisfied", "not_applicable"].includes(f.status),
              ) && (
                <p className="case-panel-copy">
                  No outstanding findings. Check completion does not approve a
                  loan or account.
                </p>
              )}
          </Panel>
          {doc && (
            <Panel
              title="Review selected revision"
              aside={<Status value={doc.review_status} />}
            >
              <div className="case-panel-copy form-stack">
                <p>
                  {human(doc.document_type)} · Revision {doc.revision}
                </p>
                {doc.latest_review && <p>{doc.latest_review.reason}</p>}
                {catalog.viewer.can_review && doc.status === "submitted" ? (
                  <>
                    <Field label="Review reason" required>
                      <Textarea
                        rows={3}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </Field>
                    <div className="actions">
                      {["accepted", "rejected"].map((decision) => (
                        <Button
                          key={decision}
                          size="small"
                          variant={
                            decision === "accepted" ? "primary" : "danger"
                          }
                          disabled={!reason.trim()}
                          pending={action.pending}
                          onClick={() =>
                            void action.run(
                              () =>
                                api.command(`/documents/${doc.uid}/reviews`, {
                                  expected_revision: doc.revision,
                                  expected_decision_sequence:
                                    doc.latest_review?.decision_sequence ?? 0,
                                  decision,
                                  reason,
                                }),
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
                    {doc.status !== "submitted"
                      ? "Complete and submit the draft before review."
                      : "An authorized reviewer must record the decision."}
                  </p>
                )}
                <Button
                  size="small"
                  onClick={() => navigate(`/documents/${doc.uid}`)}
                >
                  Correct attributes
                </Button>
              </div>
            </Panel>
          )}
        </aside>
      </div>
      {!!data.policy.comparisons?.length && (
        <details className="case-policy-details">
          <summary>
            Versioned cross-document rules · policy v{data.policy.version}
          </summary>
          <ComparisonPolicy rules={data.policy.comparisons} />
        </details>
      )}
      <div className="case-bottom-grid">
        <Panel
          title="Processing evidence"
          aside={<small>Selected document</small>}
        >
          <div className="case-pipeline">
            {[
              [
                "01",
                "Classify",
                selectedEvidence?.classification?.pages?.length
                  ? `${selectedEvidence.classification.pages.length} pages identified`
                  : "No retained classification",
              ],
              [
                "02",
                "Extract",
                selectedEvidence
                  ? `${selectedEvidence.extraction.field_evidence.length} cited fields`
                  : "No retained extraction",
              ],
              [
                "03",
                "Compare",
                result && !result.stale
                  ? `${observations.length} cited comparisons`
                  : "Run checks for current observations",
              ],
              [
                "04",
                "Apply policy",
                `Version ${data.policy.version} · ${findings.length} checks`,
              ],
              [
                "05",
                "Human review",
                `${docs.filter((d) => d.accepted).length} accepted revisions`,
              ],
            ].map(([n, title, detail]) => (
              <div key={n}>
                <small>{n}</small>
                <strong>{title}</strong>
                <p>{detail}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Subject activity"
          aside={
            <small>
              Latest {data.subject_history.items.length} of{" "}
              {data.subject_history.total_items}
            </small>
          }
        >
          <ol className="case-timeline">
            {data.subject_history.items.map((event: Row) => (
              <li key={event.uid}>
                <strong>{human(event.action.replaceAll(".", " "))}</strong>
                <time>{recordedTime(event.occurred_at)}</time>
                <small>Actor {event.actor_uid.slice(0, 8)}</small>
              </li>
            ))}
          </ol>
          <p className="case-panel-footnote">
            Activity covers this subject's cases. No cryptographic verification
            is asserted.
          </p>
        </Panel>
      </div>
    </main>
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
