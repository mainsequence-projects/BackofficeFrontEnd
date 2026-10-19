import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Field, Input } from "@dev-mainsequence/command-center-sdk/controls";
import { ResourceListPage } from "@dev-mainsequence/command-center-sdk/views";
import type { ResourceApplicationDefinition } from "@dev-mainsequence/command-center-sdk/resource";
import { ApplicationCard, ApplicationPage, ApplicationPageHeader, ApplicationPageStack } from "@dev-mainsequence/command-center-sdk/layout";
import { api, human, type Catalog, type DocumentType } from "./api";
import { Loading, Notice, OperationRecovery, useAction, useLoad } from "./ui";

interface ParsingSettings {
  document_type: string;
  score_kind: "classification_confidence";
  revision: number;
  automatic_acceptance_enabled: boolean;
  acceptance_threshold_percent: string | null;
  changed_at: string | null;
}

export function Admin({ viewer, types }: { viewer: Catalog["viewer"]; types: DocumentType[] }) {
  if (viewer.is_organization_admin !== true)
    return <ApplicationPage><ApplicationPageHeader title="Admin" /><Notice error>Organization administrator access is required.</Notice></ApplicationPage>;
  return <DocumentTypeSettings types={types} />;
}

function DocumentTypeSettings({ types }: { types: DocumentType[] }) {
  const definition = useMemo<ResourceApplicationDefinition<DocumentType, string>>(() => ({
    id: "document-parsing-policies",
    label: "Document parsing",
    itemLabel: "document types",
    description: "All document types and their acceptance settings. Save changes separately for each row.",
    getId: (type) => type.document_type,
    columns: [{ id: "policy", header: "Document types", importance: "primary", renderCell: (type) => <ParsingSettingsRow documentType={type.document_type} /> }],
    adapter: {
      async list() {
        return { items: types, pageInfo: { pageIndex: 0, pageSize: Math.max(types.length, 1), totalItems: types.length, hasNextPage: false, hasPreviousPage: false } };
      },
    },
  }), [types]);
  return <ApplicationPage maxWidth="full"><ApplicationPageStack>
    <OperationRecovery />
    <ApplicationPageHeader title="Admin" description="Organization settings for this Back Office environment." />
    <ResourceListPage
      definition={definition}
      pageSize={Math.max(types.length, 1)}
      searchable={false}
      tablePresentation="table"
      emptyContent={<p>No document types are available. Reload the document catalog before configuring acceptance.</p>}
    />
    <ApplicationCard header={<h2>How automatic acceptance works</h2>}>
      <p>Every document type defaults to automatic acceptance On at 80%. Save a row to override its settings.</p>
      <p>The threshold is the extractor’s classification confidence, from 0 to 100%. A score at or above the saved threshold qualifies for automatic acceptance; a lower or missing score needs review.</p>
      <p className="muted">Invalid or incomplete attributes and missing source evidence always need review. Existing review decisions are never overwritten. Changes apply to future parsing completions; earlier decisions retain their recorded policy version.</p>
    </ApplicationCard>
  </ApplicationPageStack></ApplicationPage>;
}

function ParsingSettingsRow({ documentType }: { documentType: string }) {
  const title = human(documentType);
  const loaded = useLoad(async (signal) => {
    const settings = await api.get<ParsingSettings>(`/admin/parsing-settings?document_type=${encodeURIComponent(documentType)}`, signal);
    if (settings.document_type !== documentType || settings.score_kind !== "classification_confidence")
      throw new Error("The service returned settings for a different document type or confidence measure. Reload before editing.");
    return settings;
  }, [documentType]);
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState("80.00");
  const action = useAction(loaded.refresh);
  useEffect(() => {
    if (loaded.data) {
      setEnabled(loaded.data.automatic_acceptance_enabled);
      setThreshold(loaded.data.acceptance_threshold_percent ?? "");
    }
  }, [loaded.data]);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded.data) return;
    void action.run(() => api.command("/admin/parsing-settings", {
      document_type: documentType,
      expected_revision: loaded.data!.revision,
      automatic_acceptance_enabled: enabled,
      acceptance_threshold_percent: threshold.trim() || null,
    }, "PUT"), "Parsing settings saved.");
  }
  const changed = loaded.data && (enabled !== loaded.data.automatic_acceptance_enabled || threshold !== (loaded.data.acceptance_threshold_percent ?? ""));
  return <section className="parsing-policy" data-document-type={documentType} aria-labelledby={`policy-title-${documentType}`}>
    <form onSubmit={save} className="parsing-policy-row" aria-label={`${title} parsing settings`}>
      <div className="parsing-policy-heading">
        <h3 id={`policy-title-${documentType}`}>{title}</h3>
        {loaded.data && <span className="muted" title={loaded.data.changed_at ? `Last saved ${new Date(loaded.data.changed_at).toLocaleString()}` : undefined}>{loaded.data.revision ? `Policy version ${loaded.data.revision}` : "Default · On at 80%"}</span>}
        {changed && <Badge variant="warning">Unsaved changes</Badge>}
      </div>
      {loaded.loading || loaded.error || !loaded.data ? <div className="parsing-policy-load"><Loading error={loaded.error} />{loaded.error && <Button onClick={loaded.refresh}>Retry settings</Button>}</div> : <>
          <Field label="Automatic acceptance" controlId={`automatic-acceptance-${documentType}`}>
            <Button id={`automatic-acceptance-${documentType}`} type="button" aria-pressed={enabled} onClick={() => setEnabled((value) => !value)} disabled={action.pending}>
              {enabled ? "On" : "Off"}
            </Button>
          </Field>
          <Field label="Acceptance threshold (%)" controlId={`parsing-threshold-${documentType}`} required={enabled}>
            <Input id={`parsing-threshold-${documentType}`} type="number" min="0" max="100" step="0.01" required={enabled} value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="0–100" disabled={action.pending} />
          </Field>
          <p className="parsing-policy-rule">{enabled ? threshold !== "" ? `≥ ${threshold}%: accepted · Below ${threshold}%: needs review` : "Enter an acceptance threshold." : "All parsed results need review."}</p>
          <Button type="submit" aria-label="Save parsing settings" disabled={action.pending || (!changed && loaded.data.revision > 0)}>{action.pending ? "Saving…" : "Save"}</Button>
      </>}
    </form>
    {action.feedback}
    {action.conflict && <div><Button onClick={loaded.refresh}>Reload saved settings</Button></div>}
  </section>;
}
