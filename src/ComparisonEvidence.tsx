import { useState } from "react";
import { Button, Badge } from "@dev-mainsequence/command-center-sdk/controls";
import { ApplicationCard } from "@dev-mainsequence/command-center-sdk/layout";
import { api, human, type Row } from "./api";
import { Loading, Notice, SourcePreview, Status, useLoad } from "./ui";
import { navigate } from "./App";

const display = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

export function ComparisonPolicy({ rules }: { rules: Row[] }) {
  if (!rules.length) return null;
  return (
    <ApplicationCard
      className="evidence-card"
      header={<h2>Cross-document checks</h2>}
    >
      <p>
        Back Office applies these versioned rules to cited evidence. Unresolved
        mandatory checks prevent completion.
      </p>
      {rules.map((rule) => (
        <div className="renewal-finding" key={rule.key}>
          <h3>
            {human(rule.key)}{" "}
            <Badge>{rule.mandatory ? "Mandatory" : "Optional"}</Badge>
          </h3>
          <p>{rule.description}</p>
          <p>
            {human(rule.left.document_type)} · {rule.left.field} ↔{" "}
            {human(rule.right.document_type)} · {rule.right.field}
          </p>
          <p>
            Comparison: {human(rule.operator)}
            {rule.when_both_present
              ? " · When both document types are present"
              : ""}
          </p>
          {rule.operator === "numeric" && (
            <p>
              Absolute tolerance: {rule.absolute_tolerance}. Relative tolerance:{" "}
              {rule.relative_tolerance_basis_points} basis points of the left
              value. Back Office uses the larger allowance.
            </p>
          )}
        </div>
      ))}
    </ApplicationCard>
  );
}

export function ComparisonFindings({ evaluation }: { evaluation: Row }) {
  const [citation, setCitation] = useState<Row>();
  const rules: Row[] = evaluation.input_snapshot?.policy?.comparisons ?? [];
  const observations: Row[] =
    evaluation.input_snapshot?.comparison_result?.observations ?? [];
  if (!rules.length) return null;
  return (
    <ApplicationCard
      className="evidence-card"
      header={<h2>Cited cross-document comparisons</h2>}
    >
      <p>
        These are the retained observations for this evaluation. Findings and
        tolerances come from Back Office policy version {evaluation.set_version}
        ; completion is not loan or account approval.
      </p>
      {rules.map((rule) => {
        const finding = evaluation.findings?.find(
          (f: Row) => f.requirement_key === rule.key,
        );
        const keys = new Set(
          finding?.document_references
            ?.map((ref: Row) => ref.comparison_key)
            .filter(Boolean),
        );
        const pairs = observations.filter((o) => keys.has(o.key));
        return (
          <section className="comparison-finding" key={rule.key}>
            <h3>
              {human(rule.key)} {finding && <Status value={finding.status} />}
            </h3>
            <p>{finding?.explanation ?? "No retained finding is available."}</p>
            {!pairs.length && (
              <>
                <Notice>
                  {finding?.status === "not_applicable"
                    ? "This comparison is not required for the supplied evidence."
                    : "No cited comparison was produced. Check the linked documents, their reviews and extraction evidence."}
                </Notice>
                <div className="actions">
                  {(finding?.document_references ?? [])
                    .filter(
                      (ref: Row, i: number, refs: Row[]) =>
                        refs.findIndex(
                          (r) =>
                            r.document_uid === ref.document_uid &&
                            r.revision === ref.revision,
                        ) === i,
                    )
                    .map((ref: Row) => (
                      <Button
                        key={`${ref.document_uid}:${ref.revision}`}
                        size="small"
                        onClick={() =>
                          navigate(
                            `/documents/${ref.document_uid}?revision=${ref.revision}&tab=evidence`,
                          )
                        }
                      >
                        Inspect revision {ref.revision}
                      </Button>
                    ))}
                </div>
              </>
            )}
            {pairs.map((o) => (
              <div key={o.key} className="comparison-pair">
                <p>
                  <strong>Parser observation:</strong> {human(o.comparability)}{" "}
                  · {human(o.relationship)}
                </p>
                <p>{o.explanation}</p>
                <div className="evidence-table-scroll">
                  <table className="evidence-table">
                    <caption>Compared values and source citations</caption>
                    <thead>
                      <tr>
                        <th>Evidence</th>
                        <th>Field</th>
                        <th>Extracted value</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[o.left, o.right, ...(o.context ?? [])].map(
                        (fact: Row, i: number) => (
                          <tr key={`${fact.document_id}:${fact.pointer}:${i}`}>
                            <td>
                              <Button
                                size="small"
                                onClick={() =>
                                  navigate(
                                    `/documents/${fact.document_id}?revision=${fact.revision}`,
                                  )
                                }
                              >
                                {i < 2
                                  ? human(
                                      (i ? rule.right : rule.left)
                                        .document_type,
                                    )
                                  : "Context"}{" "}
                                · Revision {fact.revision}
                              </Button>
                            </td>
                            <td>{fact.pointer}</td>
                            <td>{display(fact.value)}</td>
                            <td>
                              {fact.citations.map((c: Row, n: number) => (
                                <Button
                                  size="small"
                                  key={n}
                                  onClick={() => setCitation(c)}
                                >
                                  Page {c.page}
                                </Button>
                              ))}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        );
      })}
      {citation && (
        <section aria-label="Cited source" className="comparison-source">
          <div className="actions">
            <h3>Cited source · Page {citation.page}</h3>
            <Button onClick={() => setCitation(undefined)}>Close source</Button>
          </div>
          <SourcePreview
            key={citation.source_id}
            uid={citation.source_id}
            page={citation.page}
            expectedSha256={citation.source_sha256}
          />
        </section>
      )}
    </ApplicationCard>
  );
}

export function ExtractionEvidence({
  uid,
  revision,
}: {
  uid: string;
  revision: number;
}) {
  const loaded = useLoad(
    (signal) =>
      api.get(
        `/documents/${uid}/revisions/${revision}/extraction-evidence`,
        signal,
      ),
    [uid, revision],
  );
  const [source, setSource] = useState<Row>();
  const evidence = loaded.data?.evidence;
  return (
    <ApplicationCard
      className="evidence-card"
      header={<h2>Extraction evidence · Revision {revision}</h2>}
    >
      {loaded.loading || loaded.error ? (
        <Loading error={loaded.error} />
      ) : !evidence ? (
        <Notice>
          This revision has no retained extraction evidence. Manual edits do not
          inherit citations from earlier revisions.
        </Notice>
      ) : (
        <>
          <p>
            Reader observations are retained with this exact revision. Review
            decisions remain in Back Office.
          </p>
          {evidence.extraction.field_evidence
            .filter((field: Row) => !field.candidates.length)
            .map((field: Row) => (
              <Notice key={field.pointer}>
                {field.pointer}: no reader supplied a value or citation.
              </Notice>
            ))}
          <div className="evidence-table-scroll">
            <table className="evidence-table">
              <caption>Field evidence from extraction readers</caption>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Reader</th>
                  <th>Value</th>
                  <th>Agreement</th>
                  <th>Citations</th>
                </tr>
              </thead>
              <tbody>
                {evidence.extraction.field_evidence.flatMap((field: Row) =>
                  field.candidates.map((candidate: Row) => (
                    <tr key={`${field.pointer}:${candidate.reader_id}`}>
                      <td>{field.pointer}</td>
                      <td>
                        {candidate.reader_id}
                        {field.selected_reader_id === candidate.reader_id && (
                          <Badge>Selected</Badge>
                        )}
                      </td>
                      <td>{display(candidate.value)}</td>
                      <td>{human(field.agreement)}</td>
                      <td>
                        {candidate.locations.map((location: Row, i: number) => (
                          <Button
                            size="small"
                            key={i}
                            onClick={() => {
                              const page = evidence.extraction.pages.find(
                                (p: Row) =>
                                  p.source_file === location.source_file &&
                                  p.page === location.page,
                              );
                              setSource({
                                uid: evidence.source_mapping[
                                  location.source_file
                                ],
                                page: location.page,
                                sha: page?.source_sha256,
                              });
                            }}
                          >
                            Page {location.page}
                          </Button>
                        ))}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          {source && (
            <>
              <Button onClick={() => setSource(undefined)}>Close source</Button>
              <SourcePreview
                key={source.uid}
                uid={source.uid}
                page={source.page}
                expectedSha256={source.sha}
              />
            </>
          )}
        </>
      )}
    </ApplicationCard>
  );
}
