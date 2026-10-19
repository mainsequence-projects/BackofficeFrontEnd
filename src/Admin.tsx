import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input } from "@dev-mainsequence/command-center-sdk/controls";
import { ResourcePicker } from "@dev-mainsequence/command-center-sdk/views";
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
  const [kind, setKind] = useState(types[0]?.document_type ?? "");
  if (!kind) return <Notice error>No document types are available. Reload the document catalog before configuring acceptance.</Notice>;
  return <ParsingSettingsPage key={kind} documentType={kind} types={types} onTypeChange={setKind} />;
}

function ParsingSettingsPage({ documentType, types, onTypeChange }: { documentType: string; types: DocumentType[]; onTypeChange: (value: string) => void }) {
  const loaded = useLoad(async (signal) => {
    const settings = await api.get<ParsingSettings>(`/admin/parsing-settings?document_type=${encodeURIComponent(documentType)}`, signal);
    if (settings.document_type !== documentType || settings.score_kind !== "classification_confidence")
      throw new Error("The service returned settings for a different document type or confidence measure. Reload before editing.");
    return settings;
  }, [documentType]);
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState("");
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
  return <ApplicationPage maxWidth="wide"><ApplicationPageStack>
    <OperationRecovery />
    <ApplicationPageHeader title="Admin" description="Organization settings for this Back Office environment." />
    <Field label="Document type" description="Each document type has its own policy. Save changes before choosing another type.">
      <ResourcePicker ariaLabel="Document type" fullWidth value={documentType} onValueChange={onTypeChange} disabled={action.pending} options={types.map((type) => ({ value: type.document_type, label: type.name || human(type.document_type), subtitle: type.description }))} />
    </Field>
    {loaded.loading || loaded.error || !loaded.data ? <Loading error={loaded.error} /> : <>
      <ApplicationCard header={<h2>Document parsing</h2>}>
        <p>Choose when {types.find((type) => type.document_type === documentType)?.name || human(documentType)} can be accepted automatically using the extractor’s classification confidence.</p>
        <form onSubmit={save} className="form-stack">
          <Field label="Automatic acceptance" controlId="automatic-acceptance" description="Accept qualifying document revisions automatically after parsing.">
            <Button id="automatic-acceptance" type="button" aria-pressed={enabled} onClick={() => setEnabled((value) => !value)} disabled={action.pending}>
              {enabled ? "Automatic acceptance on" : "Automatic acceptance off"}
            </Button>
          </Field>
          <Field label="Acceptance threshold (%)" controlId="parsing-threshold" required={enabled} description="Classification confidence at or above this percentage qualifies. Use 0–100, with up to two decimal places.">
            <Input id="parsing-threshold" type="number" min="0" max="100" step="0.01" required={enabled} value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Enter a percentage" disabled={action.pending} />
          </Field>
          <p>{enabled ? threshold !== "" ? `Classification confidence of ${threshold}% or higher qualifies for automatic acceptance when all document checks pass. Lower confidence needs review.` : "Enter a threshold before saving automatic acceptance for this document type." : "Automatic acceptance is off. Parsed documents of this type need review."}</p>
          <p className="muted">This is the extractor’s confidence in the document type, expressed as one percentage per document. Missing confidence, invalid or incomplete attributes, and missing source evidence always need review. A score cannot override an existing review decision.</p>
          <p className="muted">Changes apply to future parsing completions. Earlier acceptance decisions retain the policy version used at the time.</p>
          <Button type="submit" disabled={action.pending || loaded.loading}>{action.pending ? "Saving…" : "Save parsing settings"}</Button>
          {action.feedback}
        </form>
      </ApplicationCard>
      <p className="muted">{loaded.data.revision ? `Saved policy version ${loaded.data.revision}${loaded.data.changed_at ? ` · ${new Date(loaded.data.changed_at).toLocaleString()}` : ""}.` : "Not configured for this document type. Automatic acceptance is off until an administrator saves its policy."}</p>
      {action.conflict && <Button onClick={loaded.refresh}>Reload saved settings</Button>}
    </>}
  </ApplicationPageStack></ApplicationPage>;
}
