import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Textarea,
} from "@dev-mainsequence/command-center-sdk/controls";
import {
  ApplicationPage,
  ApplicationPageHeader,
  ApplicationPageStack,
  ApplicationCard,
  ApplicationCardGrid,
} from "@dev-mainsequence/command-center-sdk/layout";
import {
  EntitySummary,
  ResourceDetailShell,
  ResourceListPage,
  ResourcePicker,
} from "@dev-mainsequence/command-center-sdk/views";
import type {
  ResourceApplicationDefinition,
  ResourceColumnDefinition,
} from "@dev-mainsequence/command-center-sdk/resource";
import {
  api,
  human,
  profileInput,
  uploadFile,
  type Row,
  type Catalog,
} from "./api";
import { SchemaForm } from "./SchemaForm";
import { CurrentRequirements, EvidenceDates, recordedTime } from "./DocumentDates";
import {
  Loading,
  Notice,
  Reload,
  SourcePreview,
  Status,
  useAction,
  useLoad,
  OperationRecovery,
} from "./ui";
import { navigate } from "./App";
import { CaseCreation } from "./CaseDashboard";
import { ProcessingRun, evaluationPath } from "./ProcessingRun";
import { ComparisonPolicy, ComparisonFindings, ExtractionEvidence } from "./ComparisonEvidence";

function Page({ children }: { children: ReactNode }) {
  return (
    <ApplicationPage maxWidth="wide">
      <ApplicationPageStack>
        <OperationRecovery />
        {children}
      </ApplicationPageStack>
    </ApplicationPage>
  );
}
function definition(
  id: string,
  label: string,
  path: string,
  columns: ResourceColumnDefinition<Row, ReactNode>[],
): ResourceApplicationDefinition<Row, string> {
  return {
    id,
    label,
    getId: (r) => r.uid,
    columns,
    adapter: {
      async list(input) {
        const join = path.includes("?") ? "&" : "?";
        const result = await api.get(
          `${path}${join}limit=${input.pageSize}&offset=${input.pageIndex * input.pageSize}&search=${encodeURIComponent(input.search ?? "")}`,
          input.signal,
        );
        if (typeof result.total_items !== "number")
          throw new Error(
            "The collection did not return its authoritative total.",
          );
        return {
          items: result.items,
          pageInfo: {
            pageIndex: input.pageIndex,
            pageSize: input.pageSize,
            totalItems: result.total_items,
            hasNextPage:
              result.has_more ??
              (input.pageIndex + 1) * input.pageSize < result.total_items,
            hasPreviousPage: input.pageIndex > 0,
          },
        };
      },
    },
  };
}
function staticDefinition(
  id: string,
  label: string,
  rows: Row[],
  columns: ResourceColumnDefinition<Row, ReactNode>[],
): ResourceApplicationDefinition<Row, string> {
  return {
    id,
    label,
    getId: (r) => r.uid ?? `${r.key}@${r.version}`,
    columns,
    adapter: {
      async list(input) {
        const matching = rows.filter((r) =>
          JSON.stringify(r)
            .toLowerCase()
            .includes(input.search?.toLowerCase() ?? ""),
        );
        const start = input.pageIndex * input.pageSize;
        return {
          items: matching.slice(start, start + input.pageSize),
          pageInfo: {
            pageIndex: input.pageIndex,
            pageSize: input.pageSize,
            totalItems: matching.length,
            hasNextPage: start + input.pageSize < matching.length,
            hasPreviousPage: start > 0,
          },
        };
      },
    },
  };
}
function summary(
  id: string,
  title: string,
  kind: string,
  fields: [string, unknown][] = [],
  badges: { key: string; label: string; tone?: string }[] = [],
) {
  return (
    <EntitySummary
      summary={{
        entity: { id, title, type: kind },
        badges,
        inline_fields: fields.map(([label, value]) => ({
          key: label,
          label,
          value,
        })),
        highlight_fields: [],
        stats: [],
      }}
    />
  );
}
const documentColumns: ResourceColumnDefinition<Row, ReactNode>[] = [
  {
    id: "document_type",
    header: "Document",
    importance: "primary",
    renderCell: (d) => (
      <div className="record-label">
        <strong>{human(d.document_type)}</strong>
        <small>Revision {d.revision}</small>
      </div>
    ),
  },
  {
    id: "status",
    header: "Submission",
    importance: "secondary",
    renderCell: (d) => <Status value={d.status} />,
  },
  {
    id: "review",
    header: "Review",
    importance: "secondary",
    renderCell: (d) => <Status value={d.review_status} />,
  },
];

export function People() {
  const def = useMemo(
    () =>
      definition("persons", "People", "/persons", [
        {
          id: "full_name",
          header: "Person",
          importance: "primary",
          renderCell: (p) => (
            <div className="record-label">
              <strong>{p.full_name || "Unnamed person"}</strong>
              <small>{p.external_reference || "No external reference"}</small>
            </div>
          ),
        },
        {
          id: "employment_status",
          header: "Employment",
          importance: "secondary",
          getValue: (p) =>
            p.employment_status ? human(p.employment_status) : "Not provided",
        },
        {
          id: "revision",
          header: "Profile revision",
          importance: "tertiary",
          getValue: (p) => p.revision,
        },
      ]),
    [],
  );
  return (
    <Page>
      <ResourceListPage
        definition={def}
        tablePresentation="auto"
        primaryActions={[
          {
            id: "create",
            label: "New person",
            tone: "primary",
            onSelect: () => navigate("/persons/new"),
          },
        ]}
        emptyContent={
          <p>No people yet. Create a person to start a document case.</p>
        }
        onRowActivate={(p) => navigate(`/persons/${p.uid}`)}
      />
    </Page>
  );
}

export function PersonPage({
  uid,
  tab = "profile",
  catalog,
}: {
  uid: string;
  tab?: string;
  catalog: Catalog;
}) {
  const isNew = uid === "new";
  const loaded = useLoad(
    async (signal) =>
      isNew
        ? {
            person: {},
            assignments: [],
            documents: [],
            sources: [],
            history: [],
          }
        : {
            person: await api.get(`/persons/${uid}`, signal),
            assignments: (await api.get(`/persons/${uid}/cases`, signal))
              .items,
            documents: (await api.get(`/persons/${uid}/documents`, signal))
              .items,
            sources: (await api.get(`/persons/${uid}/sources`, signal)).items,
            history: (await api.get(`/persons/${uid}/history`, signal)).items,
          },
    [uid],
  );
  const [profile, setProfile] = useState<Row>({});
  useEffect(() => {
    if (loaded.data) setProfile(profileInput(loaded.data.person));
  }, [loaded.data]);
  const action = useAction(loaded.refresh);
  if (!loaded.data || loaded.error)
    return (
      <Page>
        <Loading error={loaded.error} />
        {loaded.error && <Reload onClick={loaded.refresh} />}
      </Page>
    );
  const {
    person,
    assignments,
    documents,
    sources,
    history: events,
  } = loaded.data;
  const selected = ["profile", "documents", "requirements", "history"].includes(
    tab,
  )
    ? tab
    : "profile";
  const save = () =>
    action.run(
      async () => {
        if (isNew) {
          const created = await api.command("/persons", { profile });
          navigate(`/persons/${created.uid}`);
        } else
          await api.command(
            `/persons/${uid}`,
            { profile, expected_revision: person.revision },
            "PUT",
          );
      },
      isNew ? "Person created." : "Reference profile saved.",
    );
  const form = (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <SchemaForm
        prefix="person"
        schema={catalog.personSchema}
        value={profile}
        onChange={setProfile}
        disabled={action.pending}
      />
      {action.feedback}
      <div className="actions">
        <Button type="submit" variant="primary" pending={action.pending}>
          {isNew ? "Create person" : "Save profile"}
        </Button>
        <Button
          onClick={() => (isNew ? navigate("/persons") : loaded.refresh())}
        >
          {" "}
          {isNew ? "Cancel" : "Reload latest"}
        </Button>
      </div>
    </form>
  );
  if (isNew)
    return (
      <Page>
        <ApplicationPageHeader
          title="New person"
          description="Record the reference information used to compare submitted documents. Leave unknown details empty."
        />
        <ApplicationCard>{form}</ApplicationCard>
      </Page>
    );
  return (
    <Page>
      <ResourceDetailShell
        summary={summary(uid, person.full_name || "Unnamed person", "Person", [
          ["External reference", person.external_reference ?? "Not provided"],
          ["Profile revision", person.revision],
        ])}
        breadcrumbs={[
          {
            id: "persons",
            label: "People",
            onSelect: () => navigate("/persons"),
          },
          { id: uid, label: person.full_name || "Person" },
        ]}
        activeTabId={selected}
        onTabChange={(next) => navigate(`/persons/${uid}?tab=${next}`)}
        tabs={[
          { id: "profile", label: "Profile" },
          { id: "documents", label: "Documents", count: documents.length },
          {
            id: "requirements",
            label: "Requirements",
            count: assignments.length,
          },
          { id: "history", label: "Activity" },
        ]}
        contentVariant="plain"
      >
        {selected === "profile" && <ApplicationCard>{form}</ApplicationCard>}
        {selected === "documents" && (
          <ApplicationPageStack>
            <UploadDocument
              personUid={uid}
              catalog={catalog}
              sources={sources}
              onCreated={loaded.refresh}
            />
            <DocumentList rows={documents} />
          </ApplicationPageStack>
        )}
        {selected === "requirements" && (
          <Requirements
            personUid={uid}
            catalog={catalog}
            assignments={assignments}
            documents={documents}
            refresh={loaded.refresh}
          />
        )}
        {selected === "history" && (
          <ResourceListPage
            definition={staticDefinition("history", "Case activity", events, [
              {
                id: "action",
                header: "Action",
                importance: "primary",
                getValue: (e) => human(e.action),
              },
              {
                id: "occurred_at",
                header: "Recorded",
                importance: "secondary",
                getValue: (e) => new Date(e.occurred_at).toLocaleString(),
              },
            ])}
            embedded
            searchable={false}
            tablePresentation="auto"
            emptyContent="No case activity is available."
          />
        )}
      </ResourceDetailShell>
    </Page>
  );
}

function DocumentList({ rows }: { rows: Row[] }) {
  const def = useMemo(
    () => staticDefinition("documents", "Documents", rows, documentColumns),
    [rows],
  );
  return (
    <ResourceListPage
      definition={def}
      embedded
      tablePresentation="auto"
      emptyContent="No documents yet. Upload a source and create its document above."
      onRowActivate={(d) => navigate(`/documents/${d.uid}`)}
    />
  );
}

function UploadDocument({
  personUid,
  catalog,
  sources,
  onCreated,
}: {
  personUid: string;
  catalog: Catalog;
  sources: Row[];
  onCreated: () => void;
}) {
  const [kind, setKind] = useState(
    catalog.types[0]?.document_type ?? "passport",
  );
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState("");
  const [progress, setProgress] = useState("");
  const action = useAction(onCreated);
  return (
    <ApplicationCard header={<h2>Add a document</h2>}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            let sourceUid = source;
            if (file)
              sourceUid = (await uploadFile(personUid, file, setProgress)).uid;
            if (!sourceUid)
              throw new Error(
                "Choose a source file or an existing verified source.",
              );
            const doc = await api.command(`/persons/${personUid}/documents`, {
              document_type: kind,
              schema_version: 1,
              payload: { document_type: kind },
              raw_document_refs: [{ raw_document_uid: sourceUid }],
            });
            setProgress("");
            navigate(`/documents/${doc.uid}`);
          }, "Document created.");
        }}
      >
        <div className="field-grid">
          <Field label="Document type">
            <ResourcePicker
              ariaLabel="Document type"
              fullWidth
              value={kind}
              onValueChange={setKind}
              disabled={action.pending}
              options={catalog.types.map((t) => ({
                value: t.document_type,
                label: t.name || human(t.document_type),
                subtitle: t.description,
              }))}
            />
          </Field>
          <Field
            label="Source file"
            description="PDF, PNG, JPEG or text, up to 10 MiB. The original is preserved as evidence."
          >
            <Input
              className="file-picker"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
              disabled={action.pending}
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                setSource("");
              }}
            />
          </Field>
          {sources.length > 0 && (
            <Field label="Or use an existing source">
              <ResourcePicker
                ariaLabel="Existing source"
                fullWidth
                disabled={action.pending || !!file}
                value={source}
                onValueChange={setSource}
                options={sources
                  .filter((s) => s.status === "ready")
                  .map((s) => ({ value: s.uid, label: s.filename }))}
              />
            </Field>
          )}
        </div>
        <p className="muted">Extract from source lets Back Office classify and read the document. The selected type is used only for manual entry. Upload one logical document per file.</p>
        {progress && <Notice>{progress}</Notice>}
        {action.feedback}
        <div className="actions">
          <Button type="submit" pending={action.pending}>Create document</Button>
          <Button variant="primary" pending={action.pending} disabled={!file && !source} onClick={() => void action.run(async () => {
            if (file && !["application/pdf", "image/png", "image/jpeg"].includes(file.type))
              throw new Error("Extraction supports PDF, PNG and JPEG. Use manual entry for text files.");
            setProgress("Preparing extraction…");
            const sourceUid = file ? (await uploadFile(personUid, file, setProgress)).uid : source;
            const result = await api.command(`/source-documents/${sourceUid}/process`);
            setProgress("");
            navigate(`/documents?person=${personUid}&run=${result.uid}`);
          }, "Extraction requested.")}>Extract from source</Button>
        </div>
      </form>
    </ApplicationCard>
  );
}

function Requirements({
  personUid,
  catalog,
  assignments,
  documents,
  refresh,
}: {
  personUid: string;
  catalog: Catalog;
  assignments: Row[];
  documents: Row[];
  refresh: () => void;
}) {
  return (
    <ApplicationPageStack>
      <CaseCreation personUid={personUid} onCreated={() => refresh()} />
      {assignments.map((a) => (
        <AssignmentCard
          key={a.uid}
          assignment={a}
          documents={documents}
          catalog={catalog}
          personUid={personUid}
          refresh={refresh}
        />
      ))}
      {!assignments.length && (
        <Notice>
          No cases yet. Choose a business case type and a permitted Document Set
          to create one.
        </Notice>
      )}
    </ApplicationPageStack>
  );
}

function AssignmentCard({
  assignment,
  documents,
  catalog,
  personUid,
  refresh,
}: {
  assignment: Row;
  documents: Row[];
  catalog: Catalog;
  personUid: string;
  refresh: () => void;
}) {
  const loaded = useLoad(
    (signal) => api.get(`/cases/${assignment.uid}`, signal),
    [assignment.uid, assignment.revision],
  );
  const [selected, setSelected] = useState<readonly string[]>([]);
  useEffect(() => {
    if (loaded.data) setSelected(loaded.data.document_uids);
  }, [loaded.data]);
  const action = useAction(refresh);
  const policy = catalog.sets.find(
    (s) =>
      s.key === assignment.document_set_key &&
      s.version === assignment.document_set_version,
  );
  if (!loaded.data || loaded.error) return <Loading error={loaded.error} />;
  const item = loaded.data;
  return (
    <ApplicationCard
      header={
        <div className="actions">
          <h2>{item.case_type.name}</h2>
          <span>{policy?.name ?? human(item.document_set_key)}</span>
          <Badge>Document Set v{item.document_set_version}</Badge>
          <Badge>Case revision {item.revision}</Badge>
        </div>
      }
    >
      <div className="form-stack">
        <p className="muted">
          This case stays pinned to the selected policy version. Add the
          evidence that should be evaluated for this case.
        </p>
        <Button onClick={() => navigate(`/review/${assignment.uid}`)}>
          Open review workspace
        </Button>
        <CurrentRequirements
          key={assignment.revision}
          assignmentUid={assignment.uid}
        />
        <Field label="Evidence documents">
          <ResourcePicker
            ariaLabel="Evidence documents"
            mode="multiple"
            fullWidth
            value={selected}
            onValueChange={(next) =>
              setSelected([
                ...new Set([...(item.document_uids ?? []), ...next]),
              ])
            }
            options={documents.map((d) => ({
              value: d.uid,
              label: `${human(d.document_type)} · Revision ${d.revision}`,
              meta: human(d.review_status),
              disabled: item.document_uids.includes(d.uid),
            }))}
          />
        </Field>
        {action.feedback}
        <div className="actions">
          <Button
            pending={action.pending}
            onClick={() =>
              void action.run(
                () =>
                  api.command(
                    `/cases/${item.uid}/documents`,
                    {
                      expected_revision: item.revision,
                      document_uids: selected,
                    },
                    "PUT",
                  ),
                "Evidence linked to case.",
              )
            }
          >
            Add selected evidence
          </Button>
          <Button
            variant="primary"
            pending={action.pending}
            onClick={() =>
              void action.run(async () => {
                const current = await api.get(`/cases/${item.uid}`);
                const result = await api.command(
                  `/cases/${item.uid}/evaluations`,
                  { expected_revision: current.revision },
                );
                navigate(evaluationPath(personUid, current.uid, result));
              })
            }
          >
            Evaluate requirements
          </Button>
          <Button
            onClick={() =>
              navigate(
                `/document-sets/${item.document_set_key}?version=${item.document_set_version}`,
              )
            }
          >
            View requirements
          </Button>
        </div>
      </div>
    </ApplicationCard>
  );
}

export function PersonPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const loaded = useLoad(
    async (signal) =>
      api.get(
        `/persons?search=${encodeURIComponent(search)}&limit=100`,
        signal,
      ),
    [search],
  );
  return (
    <Field label="Person">
      <ResourcePicker
        ariaLabel="Person"
        value={value}
        onValueChange={onChange}
        fullWidth
        loading={loaded.loading}
        searchValue={search}
        onSearchValueChange={setSearch}
        options={(loaded.data?.items ?? []).map((p: Row) => ({
          value: p.uid,
          label: p.full_name || "Unnamed person",
          subtitle: p.external_reference ?? undefined,
        }))}
        placeholder="Choose a person"
      />
      {loaded.error && <Notice error>{loaded.error}</Notice>}
    </Field>
  );
}

export function Documents({
  catalog,
  personUid,
  runUid = "",
}: {
  catalog: Catalog;
  personUid: string;
  runUid?: string;
}) {
  const loaded = useLoad(
    async (signal) =>
      personUid
        ? {
            documents: (
              await api.get(`/persons/${personUid}/documents`, signal)
            ).items,
            sources: (await api.get(`/persons/${personUid}/sources`, signal))
              .items,
          }
        : undefined,
    [personUid],
  );
  return (
    <Page>
      <ApplicationPageHeader
        title="Documents"
        description="Upload source evidence, complete its attributes, and review the exact submitted revision."
      />
      <PersonPicker
        value={personUid}
        onChange={(uid) => navigate(`/documents?person=${uid}`)}
      />
      {personUid && runUid && <ProcessingRun key={runUid} uid={runUid} personUid={personUid} />}
      {personUid ? (
        loaded.loading || loaded.error ? (
          <Loading error={loaded.error} />
        ) : (
          loaded.data && (
            <>
              <UploadDocument
                personUid={personUid}
                catalog={catalog}
                sources={loaded.data.sources}
                onCreated={loaded.refresh}
              />
              <DocumentList rows={loaded.data.documents} />
            </>
          )
        )
      ) : (
        <ApplicationCard>
          <p>
            Choose a person to see their documents, or create a person first.
          </p>
          <Button onClick={() => navigate("/persons/new")}>New person</Button>
        </ApplicationCard>
      )}
    </Page>
  );
}

export function DocumentPage({
  uid,
  tab = "attributes",
  revision,
  catalog,
}: {
  uid: string;
  tab?: string;
  revision?: string;
  catalog: Catalog;
}) {
  const loaded = useLoad(
    async (signal) => {
      let document = await api.get(`/documents/${uid}`, signal);
      const currentRevision = document.revision;
      if (revision !== undefined) {
        const selected = Number(revision);
        if (!Number.isInteger(selected) || selected < 1)
          throw Error("Choose a valid document revision.");
        document = await api.get(
          `/documents/${uid}/revisions/${selected}`,
          signal,
        );
      }
      const [schema, person] = await Promise.all([
        api.get(
          `/document-types/${document.document_type}/schema?version=${document.schema_version}`,
          signal,
        ),
        api.get(`/persons/${document.person_uid}`, signal),
      ]);
      return { document, schema, person, currentRevision };
    },
    [uid, revision],
  );
  const [payload, setPayload] = useState<Row>({});
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  useEffect(() => {
    if (loaded.data) {
      setPayload(loaded.data.document.payload);
      setSource(
        loaded.data.document.raw_document_refs?.[0]?.raw_document_uid ?? "",
      );
    }
  }, [loaded.data]);
  const action = useAction(loaded.refresh);
  if (loaded.loading || !loaded.data || loaded.error)
    return (
      <Page>
        <Loading error={loaded.error} />
        {loaded.error && <Reload onClick={loaded.refresh} />}
      </Page>
    );
  const { document: doc, schema, person } = loaded.data;
  const retained = revision !== undefined;
  const tabPath = (next: string) =>
    `/documents/${uid}?tab=${next}${retained ? `&revision=${doc.revision}` : ""}`;
  const save = () =>
    api.command(
      `/documents/${uid}/draft`,
      {
        expected_revision: doc.revision,
        payload,
        raw_document_refs: doc.raw_document_refs,
      },
      "PATCH",
    );
  return (
    <Page>
      <ResourceDetailShell
        summary={summary(
          uid,
          human(doc.document_type),
          "Document",
          [
            ["Person", person.full_name || "Unnamed person"],
            ["Revision", doc.revision],
          ],
          [
            { key: "submission", label: human(doc.status) },
            {
              key: "review",
              label: human(doc.review_status),
              tone: doc.accepted ? "success" : "warning",
            },
          ],
        )}
        breadcrumbs={[
          {
            id: "persons",
            label: "People",
            onSelect: () => navigate("/persons"),
          },
          {
            id: person.uid,
            label: person.full_name || "Person",
            onSelect: () => navigate(`/persons/${person.uid}?tab=documents`),
          },
          { id: uid, label: human(doc.document_type) },
        ]}
        tabs={[
          { id: "attributes", label: "Attributes and source" },
          { id: "review", label: "Review" },
          { id: "evidence", label: "Extraction evidence" },
        ]}
        activeTabId={["review", "evidence"].includes(tab) ? tab : "attributes"}
        onTabChange={(next) => navigate(tabPath(next))}
        headerActions={<Reload onClick={loaded.refresh} />}
        contentVariant="plain"
      >
        {retained && (
          <Notice>
            Retained revision {doc.revision}. This snapshot is read-only; the
            latest revision is {loaded.data.currentRevision}.{" "}
            <Button size="small" onClick={() => navigate(`/documents/${uid}`)}>
              Open latest revision
            </Button>
          </Notice>
        )}
        <ApplicationCard header={<h2>Document dates</h2>}>
          <dl className="document-dates">
            <div><dt>Document recorded</dt><dd>{recordedTime(doc.created_at)}</dd></div>
            <div><dt>Revision recorded</dt><dd>{recordedTime(doc.revision_created_at)}</dd></div>
            <div><dt>Revision submitted</dt><dd>{doc.submitted_at ? recordedTime(doc.submitted_at) : "Not submitted"}</dd></div>
            <div><dt>Last reviewed</dt><dd>{doc.latest_review ? recordedTime(doc.latest_review.reviewed_at) : "Not reviewed"}</dd></div>
          </dl>
          <p className="muted">Recorded times use your local timezone. Evidence issue and completion dates are shown in the attributes below. Uploading or reviewing evidence does not reset its age.</p>
        </ApplicationCard>
        {doc.parsing_result && <ApplicationCard header={<h2>Parsing result</h2>}>
          <Status value={doc.parsing_result.decision} />
          <dl className="document-dates">
            <div><dt>Classification confidence</dt><dd>{doc.parsing_result.parsing_score_percent === null ? "Not supplied" : `${doc.parsing_result.parsing_score_percent}%`}</dd></div>
            <div><dt>Acceptance threshold</dt><dd>{doc.parsing_result.acceptance_threshold_percent === null ? "Not configured" : `${doc.parsing_result.acceptance_threshold_percent}%`}</dd></div>
            <div><dt>Policy version</dt><dd>{doc.parsing_result.policy_revision || "Review-only default"}</dd></div>
            <div><dt>Processed</dt><dd>{recordedTime(doc.parsing_result.processed_at)}</dd></div>
          </dl>
          <p>{doc.parsing_result.review_uid && doc.latest_review?.uid === doc.parsing_result.review_uid ? "This exact document revision was accepted automatically under the recorded parsing policy." : `Parsing outcome: ${human(doc.parsing_result.reason_code)}. Document review decisions are shown separately below.`}</p>
        </ApplicationCard>}
        {action.feedback}
        {tab === "evidence" ? <ExtractionEvidence key={`${uid}:${doc.revision}`} uid={uid} revision={doc.revision} /> : tab !== "review" ? (
          <div className="split-view">
            <ApplicationCard header={<h2>Original source</h2>}>
              {doc.raw_document_refs.length > 1 && (
                <ResourcePicker
                  ariaLabel="Source document"
                  value={source}
                  onValueChange={setSource}
                  options={doc.raw_document_refs.map((r: Row, i: number) => ({
                    value: r.raw_document_uid,
                    label: `Source ${i + 1}`,
                  }))}
                />
              )}{" "}
              {source ? (
                <SourcePreview uid={source} />
              ) : (
                <Notice>
                  No source attached. Add source evidence before submission.
                </Notice>
              )}
            </ApplicationCard>
            <ApplicationCard header={<h2>Document attributes</h2>}>
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(save, "New draft revision saved.");
                }}
              >
                <p className="muted">
                  {doc.status === "submitted"
                    ? "Submitted attributes are immutable. Save a new draft revision to make corrections; the new revision will require its own review."
                    : "Save incomplete details as a draft. Submission validates every required field and freezes this revision."}
                </p>
                <SchemaForm
                  prefix="document"
                  schema={schema.canonical_schema}
                  value={payload}
                  onChange={setPayload}
                  disabled={action.pending || retained}
                />
                {!retained && (
                  <div className="actions">
                    <Button type="submit" pending={action.pending}>
                      Save draft revision
                    </Button>
                    {doc.status === "draft" && (
                      <Button
                        variant="primary"
                        pending={action.pending}
                        onClick={() =>
                          void action.run(async () => {
                            const changed =
                              JSON.stringify(payload) !==
                              JSON.stringify(doc.payload);
                            const saved = changed ? await save() : doc;
                            await api.command(`/documents/${uid}/submit`, {
                              expected_revision: saved.revision,
                            });
                          }, "Document submitted for review.")
                        }
                      >
                        Submit for review
                      </Button>
                    )}
                    <Button
                      onClick={() => navigate(`/documents/${uid}?tab=review`)}
                    >
                      Review this revision
                    </Button>
                  </div>
                )}
              </form>
            </ApplicationCard>
          </div>
        ) : (
          <ApplicationCard header={<h2>Review revision {doc.revision}</h2>}>
            <div className="form-stack">
              <Notice>
                Acceptance applies only to this exact submitted revision. Record
                a reason based on the original source.
              </Notice>
              {doc.latest_review && (
                <div>
                  <Status value={doc.review_status} />
                  <p>{doc.latest_review.reason}</p>
                  <p className="muted">
                    Reviewed{" "}
                    {new Date(doc.latest_review.reviewed_at).toLocaleString()}
                  </p>
                </div>
              )}
              {retained ? (
                <Notice>
                  This retained revision shows its recorded review. Open the
                  latest revision to prepare a change or a new decision.
                </Notice>
              ) : doc.status !== "submitted" ? (
                <Notice>Submit this draft before recording a review.</Notice>
              ) : !catalog.viewer.can_review ? (
                <Notice>
                  Your account can prepare documents. An authorized reviewer
                  must record acceptance or rejection.
                </Notice>
              ) : (
                <>
                  <Field label="Review reason" required>
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={4}
                      disabled={action.pending}
                    />
                  </Field>
                  <div className="actions">
                    {(["accepted", "rejected"] as const).map((decision) => (
                      <Button
                        key={decision}
                        variant={decision === "accepted" ? "primary" : "danger"}
                        pending={action.pending}
                        disabled={!reason.trim()}
                        onClick={() =>
                          void action.run(
                            () =>
                              api.command(`/documents/${uid}/reviews`, {
                                expected_revision: doc.revision,
                                expected_decision_sequence:
                                  doc.latest_review?.decision_sequence ?? 0,
                                decision,
                                reason,
                              }),
                            `Revision ${decision}.`,
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
              )}
              <Button onClick={() => navigate(tabPath("attributes"))}>
                View attributes and source
              </Button>
            </div>
          </ApplicationCard>
        )}
      </ResourceDetailShell>
    </Page>
  );
}

export function DocumentSets({
  catalog,
  selected,
  version,
}: {
  catalog: Catalog;
  selected?: string;
  version?: string;
}) {
  const policy = catalog.sets.find((s) => s.key === selected && (version === undefined || String(s.version) === version));
  const def = useMemo(
    () =>
      staticDefinition("document-sets", "Document Sets", catalog.sets.map((s) => ({ ...s, uid: `${s.key}@${s.version}` })), [
        {
          id: "name",
          header: "Document set",
          importance: "primary",
          getValue: (s) => s.name,
        },
        {
          id: "version",
          header: "Version",
          importance: "secondary",
          getValue: (s) => s.version,
        },
        {
          id: "requirements",
          header: "Requirements",
          importance: "secondary",
          getValue: (s) => s.requirements.length,
        },
      ]),
    [catalog.sets],
  );
  return (
    <Page>
      {policy ? (
        <ResourceDetailShell
          summary={summary(policy.key, policy.name, "Document set", [
            ["Published version", policy.version],
          ])}
          breadcrumbs={[
            {
              id: "sets",
              label: "Document Sets",
              onSelect: () => navigate("/document-sets"),
            },
            { id: policy.key, label: policy.name },
          ]}
          contentVariant="plain"
        >
          <p>{policy.description}</p>
          <ComparisonPolicy rules={policy.comparisons ?? []} />
          <p className="muted">Each requirement accepts any qualifying alternative below. Calendar-month rules clamp anniversaries to the last day of a shorter month. Evidence is fresh through its age limit; periodic renewal is due on its anniversary. Dates are evaluated in UTC.</p>
          <div className="requirement-list">
            {policy.requirements.map((r: Row) => (
              <ApplicationCard
                key={r.key}
                header={
                  <div className="actions">
                    <h2>{human(r.key)}</h2>
                    <Badge>
                      {r.mandatory ? "Mandatory when applicable" : "Optional"}
                    </Badge>
                  </div>
                }
              >
                <p>{r.description}</p>
                <p>
                  Minimum: {r.min_count} distinct document
                  {r.min_count === 1 ? "" : "s"}
                </p>
                {r.condition && (
                  <p className="muted">
                    Applies when {human(r.condition.field).toLowerCase()} is{" "}
                    {String(r.condition.equals)}. Missing reference information
                    needs clarification.
                  </p>
                )}
                <p>Accepted alternatives (any qualifying option):</p>
                <ul>
                  {r.options.map((o: Row) => (
                    <li key={o.document_type}>
                      {human(o.document_type)}
                      {o.require_unexpired ? " · Must be currently valid" : ""}
                      {o.max_age_days != null ? ` · At most ${o.max_age_days} days old` : ""}
                      {o.max_age_months != null ? ` · At most ${o.max_age_months} calendar months old` : ""}
                      {o.freshness_field ? ` · Age measured from ${human(o.freshness_field).toLowerCase()}` : ""}
                      {o.renewal_interval_months != null ? ` · ${o.renewal_basis === "submitted_at" ? "Submit a new revision" : "Review again"} every ${o.renewal_interval_months} calendar months from ${o.renewal_basis === "submitted_at" ? "submission" : "the last accepted review"}` : ""}
                      {o.required_fields.length
                        ? ` · Also requires ${o.required_fields.map(human).join(", ")}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </ApplicationCard>
            ))}
          </div>
        </ResourceDetailShell>
      ) : (
        <ResourceListPage
          definition={def}
          tablePresentation="auto"
          onRowActivate={(s) => navigate(`/document-sets/${s.key}?version=${s.version}`)}
        />
      )}
    </Page>
  );
}

export function Reconciliation({
  catalog,
  personUid,
  evaluationUid,
  runUid = "",
  requestedAssignment = "",
}: {
  catalog: Catalog;
  personUid: string;
  evaluationUid: string;
  runUid?: string;
  requestedAssignment?: string;
}) {
  const loaded = useLoad(
    async (signal) =>
      personUid
        ? ((await api.get(`/persons/${personUid}/cases`, signal))
            .items as Row[])
        : [],
    [personUid],
  );
  const [assignmentUid, setAssignmentUid] = useState("");
  useEffect(() => {
    setAssignmentUid(loaded.data?.find(a => a.uid === requestedAssignment)?.uid ?? loaded.data?.[0]?.uid ?? "");
  }, [loaded.data, requestedAssignment]);
  const evaluations = useLoad(
    async (signal) =>
      assignmentUid
        ? ((await api.get(`/cases/${assignmentUid}/evaluations`, signal))
            .items as Row[])
        : [],
    [assignmentUid],
  );
  const evaluation = useLoad(
    (signal) =>
      evaluationUid
        ? api.get(`/evaluations/${evaluationUid}`, signal)
        : Promise.resolve(undefined),
    [evaluationUid],
  );
  useEffect(() => {
    if (!requestedAssignment && evaluation.data?.person_uid === personUid)
      setAssignmentUid(evaluation.data.assignment_uid);
  }, [evaluation.data, requestedAssignment, personUid]);
  const action = useAction(() => {
    evaluations.refresh();
    evaluation.refresh();
  });
  const selected = loaded.data?.find((a) => a.uid === assignmentUid);
  const run = () =>
    action.run(async () => {
      const current = await api.get(`/cases/${assignmentUid}`);
      const result = await api.command(
        `/cases/${assignmentUid}/evaluations`,
        { expected_revision: current.revision },
      );
      navigate(evaluationPath(personUid, current.uid, result));
    }, "Evaluation requested.");
  const reports = useMemo(
    () =>
      staticDefinition(
        "evaluations",
        "Evaluation history",
        evaluations.data ?? [],
        [
          {
            id: "created",
            header: "Evaluated",
            importance: "primary",
            getValue: (e) => new Date(e.created_at).toLocaleString(),
          },
          {
            id: "status",
            header: "Status",
            importance: "secondary",
            renderCell: (e) => <Status value={e.status} />,
          },
          {
            id: "version",
            header: "Policy version",
            importance: "secondary",
            getValue: (e) => e.set_version,
          },
        ],
      ),
    [evaluations.data],
  );
  return (
    <Page>
      <ApplicationPageHeader
        title="Reconciliation"
        description="Evaluate the assigned requirements against exact document revisions and recorded reviews."
      />
      <PersonPicker
        value={personUid}
        onChange={(uid) => navigate(`/reconciliation?person=${uid}`)}
      />
      {!personUid ? (
        <Notice>
          Choose a person to inspect their requirements and evaluation history.
        </Notice>
      ) : loaded.loading || loaded.error ? (
        <Loading error={loaded.error} />
      ) : !loaded.data?.length ? (
        <ApplicationCard>
          <p>This subject has no cases yet.</p>
          <Button
            onClick={() => navigate(`/persons/${personUid}?tab=requirements`)}
          >
            Create a case
          </Button>
        </ApplicationCard>
      ) : (
        <>
          <div className="actions">
            <Field label="Case">
              <ResourcePicker
                ariaLabel="Case"
                value={assignmentUid}
                onValueChange={(uid) => navigate(`/reconciliation?person=${personUid}&assignment=${uid}`)}
                options={loaded.data.map((a) => ({
                  value: a.uid,
                  label: a.case_type.name,
                  subtitle: catalog.sets.find((s) => s.key === a.document_set_key && s.version === a.document_set_version)?.name ?? human(a.document_set_key),
                  meta: `Document Set v${a.document_set_version}`,
                }))}
              />
            </Field>
            <Button
              variant="primary"
              disabled={!selected}
              pending={action.pending}
              onClick={() => void run()}
            >
              Run fresh evaluation
            </Button>
            <Button
              onClick={() => navigate(`/persons/${personUid}?tab=requirements`)}
            >
              Manage evidence
            </Button>
          </div>
          {action.feedback}
          {runUid && <ProcessingRun key={runUid} uid={runUid} personUid={personUid} comparison />}
          {assignmentUid && <CurrentRequirements key={`${assignmentUid}:${evaluations.data?.length ?? 0}`} assignmentUid={assignmentUid} />}
          {evaluationUid &&
            (evaluation.loading || evaluation.error ? (
              <Loading error={evaluation.error} />
            ) : (
              evaluation.data && (
                <EvaluationResults
                  row={evaluation.data}
                  personUid={personUid}
                  refresh={evaluation.refresh}
                />
              )
            ))}
          {evaluations.loading || evaluations.error ? (
            <Loading error={evaluations.error} />
          ) : (
            <ResourceListPage
              definition={reports}
              embedded
              searchable={false}
              tablePresentation="auto"
              onRowActivate={(e) =>
                navigate(
                  evaluationPath(personUid, assignmentUid, e),
                )
              }
              emptyContent="No evaluations yet. Run a fresh evaluation to see coverage and next actions."
            />
          )}
        </>
      )}
    </Page>
  );
}

function EvaluationResults({
  row,
  personUid,
  refresh,
}: {
  row: Row;
  personUid: string;
  refresh: () => void;
}) {
  return (
    <ApplicationPageStack>
      <ApplicationCard
        header={
          <div className="actions">
            <h2>Requirement findings</h2>
            <Status value={row.status} />
            {row.stale && <Badge variant="warning">Out of date</Badge>}
            <Reload onClick={refresh} />
          </div>
        }
      >
        <p>
          Evaluated {new Date(row.created_at).toLocaleString()} against policy
          version {row.set_version}, profile revision {row.person_revision}, and
          assignment revision {row.assignment_revision}.
        </p>
        {row.stale && (
          <Notice>
            Case information, reviews, policy evaluation rules, or the evaluation date have changed. Run a fresh evaluation before relying on this saved result.
          </Notice>
        )}
        <p>
          {row.summary?.complete || row.summary?.is_complete
            ? "All applicable mandatory requirements are satisfied."
            : "The case has outstanding requirements. Follow the findings below."}
        </p>
      </ApplicationCard>
      <ComparisonFindings key={row.uid} evaluation={row} />
      <ApplicationCardGrid>
        {row.findings?.filter((finding: Row) => !(row.input_snapshot?.policy?.comparisons ?? []).some((rule: Row) => rule.key === finding.requirement_key)).map((finding: Row) => (
          <ApplicationCard
            key={finding.uid}
            header={
              <div className="actions">
                <h3>{human(finding.requirement_key)}</h3>
                <Status value={finding.status} />
              </div>
            }
          >
            <p>{finding.explanation}</p>
            {finding.field_paths?.length > 0 && (
              <p className="muted">
                Check: {finding.field_paths.map(human).join(", ")}
              </p>
            )}
            {finding.document_references?.map((ref: Row) => (
              <div key={ref.document_uid}><p>Evidence revision {ref.revision}</p><EvidenceDates dates={ref.dates} /></div>
            ))}
            <div className="actions">
              {finding.document_references?.map((ref: Row) => (
                <Button
                  size="small"
                  key={ref.document_uid}
                  onClick={() =>
                    navigate(
                      `/documents/${ref.document_uid}?tab=${finding.status === "pending_review" ? "review" : "attributes"}&revision=${ref.revision}`,
                    )
                  }
                >
                  View revision {ref.revision}
                </Button>
              ))}
              {["missing", "needs_information"].includes(finding.status) && (
                <Button
                  size="small"
                  onClick={() =>
                    navigate(
                      `/persons/${personUid}?tab=${finding.reason_code === "APPLICABILITY_UNKNOWN" ? "profile" : "documents"}`,
                    )
                  }
                >
                  {finding.reason_code === "APPLICABILITY_UNKNOWN"
                    ? "Complete reference profile"
                    : "Add supporting evidence"}
                </Button>
              )}
            </div>
          </ApplicationCard>
        ))}
      </ApplicationCardGrid>
    </ApplicationPageStack>
  );
}
