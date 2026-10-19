import { useEffect } from "react";
import { Button } from "@dev-mainsequence/command-center-sdk/controls";
import { ApplicationCard } from "@dev-mainsequence/command-center-sdk/layout";
import { api, type Row, type Schema } from "./api";
import { navigate } from "./App";
import { SchemaForm } from "./SchemaForm";
import { documentFacts } from "./DocumentScope";
import { Loading, Notice, useAction, useLoad } from "./ui";

export function CaseDocumentFields({
  document,
  payload,
  draftRevision,
  onChange,
  onSaved,
  onReload,
  onPendingChange,
}: {
  document: Row;
  payload: Row;
  draftRevision: number;
  onChange: (payload: Row) => void;
  onSaved: () => void;
  onReload: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const schema = useLoad(
    (signal) =>
      api.get<{ canonical_schema: Schema }>(
        `/document-types/${document.document_type}/schema?version=${document.schema_version}`,
        signal,
      ),
    [document.document_type, document.schema_version],
  );
  const action = useAction(onSaved);
  useEffect(() => {
    onPendingChange(action.pending);
    return () => onPendingChange(false);
  }, [action.pending, onPendingChange]);
  const scopedPayload = documentFacts(payload);
  const changed = JSON.stringify(scopedPayload) !== JSON.stringify(documentFacts(document.payload));
  const needsScopeCleanup = JSON.stringify(documentFacts(document.payload)) !== JSON.stringify(document.payload);
  return (
    <ApplicationCard
      className="case-document-fields"
      header={
        <div className="case-section-heading">
          <h2>Document fields</h2>
          <Button
            size="small"
            onClick={() =>
              navigate(
                `/documents/${document.uid}?tab=evidence&revision=${document.revision}`,
              )
            }
          >
            Reader evidence
          </Button>
        </div>
      }
    >
      {schema.loading || schema.error || !schema.data ? (
        <div className="form-stack">
          <Loading error={schema.error} />
          {schema.error && (
            <Button onClick={schema.refresh}>Retry fields</Button>
          )}
        </div>
      ) : (
        <form
          className="form-stack"
          aria-label="Document fields"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(
              () =>
                api.command(
                  `/documents/${document.uid}/draft`,
                  {
                    expected_revision: draftRevision,
                    payload: scopedPayload,
                    raw_document_refs: document.raw_document_refs,
                  },
                  "PATCH",
                ),
              "Document fields saved as a new draft revision.",
            );
          }}
        >
          <p className="muted case-fields-help">
            Red fields are required. Yellow fields are optional and do not prevent completion.
          </p>
          <SchemaForm
            prefix={`case-document-${document.uid}`}
            schema={schema.data.canonical_schema}
            value={payload}
            onChange={onChange}
            disabled={action.pending}
            highlightMissing
            expandMissing
            showDescriptions={false}
          />
          {action.feedback}
          {(action.conflict || draftRevision !== document.revision) && (
            <div>
              <Button onClick={onReload}>Reload latest document</Button>
            </div>
          )}
          <div className="actions">
            <Button
              type="submit"
              variant="primary"
              pending={action.pending}
              disabled={!changed}
            >
              Save document fields
            </Button>
            <Button
              disabled={!changed || action.pending}
              onClick={() => onChange(document.payload)}
            >
              Discard field changes
            </Button>
            {document.status === "draft" && (
              <Button
                disabled={changed}
                pending={action.pending}
                onClick={() =>
                  void action.run(
                    async () => {
                      const draft = needsScopeCleanup
                        ? await api.command(`/documents/${document.uid}/draft`, {
                            expected_revision: document.revision,
                            payload: scopedPayload,
                            raw_document_refs: document.raw_document_refs,
                          }, "PATCH")
                        : document;
                      return api.command(`/documents/${document.uid}/submit`, {
                        expected_revision: draft.revision,
                      });
                    },
                    "Document submitted for review.",
                  )
                }
              >
                Submit for review
              </Button>
            )}
          </div>
        </form>
      )}
      {draftRevision !== document.revision && (
        <Notice error>
          These field changes began on revision {draftRevision}. The document is
          now at revision {document.revision}; reload the latest document before
          applying changes.
        </Notice>
      )}
      {changed && document.status === "submitted" && (
        <Notice>
          Saving creates a new draft that must be submitted and reviewed.
        </Notice>
      )}
    </ApplicationCard>
  );
}
