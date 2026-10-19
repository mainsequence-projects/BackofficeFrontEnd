import { useEffect, useRef, useState } from "react";
import { Button, Input, Field } from "@dev-mainsequence/command-center-sdk/controls";
import { ApplicationCard } from "@dev-mainsequence/command-center-sdk/layout";
import { api, errorText, human, savedState, type Row } from "./api";
import { Notice, Status } from "./ui";
import { navigate } from "./App";
import "./drop-files.css";

type Upload = { key: string; file: File; stage: string; error?: string; result?: Row; operation?: string };
type Limits = { max_bytes: number; max_pages: number; media_types: string[]; upload_concurrency: number };
const mediaType = (file: File) => file.type || ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" }[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "");

const phases = ["Uploaded", "Identify type", "Extract fields", "Find person", "Allocate cases", "Review cases"];
const phaseIndex: Record<string, number> = { uploading: 0, uploaded: 0, classifying: 1, classified: 1, extracting: 2, extracted: 2, resolving_person: 3, persisting: 3, allocating: 4, evaluating: 5, completed: 6, unallocated: 6 };
function progressText(row: Row) {
  if (row.status === "failed") return "Processing stopped. Completed steps are saved; retry resumes this file.";
  if (row.status === "pending") return "Upload complete. Queued for the document worker; parsing has not started yet.";
  if (row.resolution_required) return "Parsing finished. We could not identify the person with certainty. Select the correct person to continue.";
  if (row.status === "needs_input") return "Processing paused. Review the explanation below before continuing.";
  if (row.stage === "unallocated") return "Document saved. No case currently needs this evidence.";
  if (row.status === "completed") return "Document saved and all eligible cases checked. Business approval remains separate.";
  return ({ uploading: "Saving the original document…", uploaded: "Loading the saved document…", classifying: "Identifying the document type…", classified: "Document type identified. Preparing extraction…", extracting: "Parsing the document and extracting its fields…", extracted: "Fields extracted. Checking the person and document evidence…", resolving_person: "Finding the person from the extracted information…", persisting: "Saving the document and checking acceptance rules…", allocating: "Finding and updating cases that need this document…", evaluating: "Reviewing each affected case and checking remaining requirements…" } as Record<string,string>)[row.stage] ?? human(row.stage);
}
const errorMessages: Record<string,string> = {
  processing_dispatch_unavailable: "The document worker could not be started. Your uploaded file is saved. Retry processing.",
  parser_request_failed: "The extraction service could not complete this request. Your file is saved; retry processing.",
  parser_contract_incompatible: "The extraction service is not compatible with this workflow. An administrator must update its deployment before retrying.",
  person_identity_uncertain: "The document could not be matched confidently to an existing person.",
  multiple_documents_require_grouping: "This file contains several documents. Split it into individual documents and upload them separately.",
  mixed_or_unknown_type: "The document type could not be identified reliably. Upload a clearer copy or split different documents into separate files.",
  document_revision_changed_review_required: "The document changed during processing. Review its latest revision before allocating it again.",
};

async function command(path: string, data: Row, key: string) {
  // Intake operations are independent; they do not use the editor's single pending-change slot.
  return (await api.response(path, { method: "POST", body: JSON.stringify({ ...data, operation_key: key }) })).json();
}

function IntakeResult({ row, refresh }: { row: Row; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<Row[]>([]);
  const [person, setPerson] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [extraTargets, setExtraTargets] = useState<Row[]>([]);
  useEffect(() => { setExtraTargets([]); }, [row.updated_at]);
  const targets = [...new Map([...extraTargets, ...(row.targets ?? [])].map((t: Row) => [t.case_uid, t])).values()];
  const [offset, setOffset] = useState(0);
  const operations = useRef(new Map<string, string>());
  const step = phaseIndex[row.stage] ?? 0;
  const active = row.status === "running";
  const queuedLong = row.status === "pending" && Date.now() - Date.parse(row.updated_at) > 60000;
  async function act(action: "resolve" | "retry") {
    const data = action === "resolve" ? { subject_uid: person, expected_revision: row.revision } : {};
    const fingerprint = `${action}:${JSON.stringify(data)}`;
    const key = operations.current.get(fingerprint) ?? crypto.randomUUID();
    operations.current.set(fingerprint, key);
    setBusy(true); setError("");
    try {
      await command(`/document-allocations/${row.uid}/${action}`, data, key);
      operations.current.delete(fingerprint); refresh();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function findPeople(next = 0) {
    setBusy(true); setError("");
    try {
      const page = await api.get(`/persons?search=${encodeURIComponent(search)}&limit=20&offset=${next}`);
      setPeople(next ? (p) => [...p, ...page.items] : page.items);
      setHasMore(page.has_more); setOffset(next);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const candidates = [...new Map([...(row.candidates ?? []), ...people].map((p: Row) => [p.uid, p])).values()];
  return <article className="intake-result" data-intake={row.uid}>
    <header><h3>{row.filename}</h3><Status value={row.stage === "unallocated" ? "unallocated" : row.status === "pending" ? "queued" : row.status} /></header>
    <p role="status" aria-live="polite">{progressText(row)}</p>
    <ol className="intake-steps" aria-label={`Processing steps for ${row.filename}`}>{phases.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} data-complete={index < step}>{index < step ? "✓ " : `${index + 1}. `}{label}</li>)}</ol>
    {active && <progress aria-label={`Processing ${row.filename}`} />}
    {row.document_type && <p>{human(row.document_type)}{row.classification_confidence_percent != null ? ` · Classification confidence ${Number(row.classification_confidence_percent).toFixed(0)}%` : ""}</p>}
    {row.updated_at && <p className="intake-updated">Last update: {new Date(row.updated_at).toLocaleTimeString()}</p>}
    {queuedLong && <Notice>The file is still waiting for a worker. Parsing has not started. Retry processing to request another worker attempt.</Notice>}
    {row.error_code && <Notice error>{errorMessages[row.error_code] ?? human(row.error_code)}</Notice>}
    {row.dispatch_error && <Notice error>The processing service could not be reached. Retry this file.</Notice>}
    {row.subject_uid && <Button variant="ghost" onClick={() => navigate(`/persons/${row.subject_uid}`)}>Open subject</Button>}
    {row.document?.uid && <Button variant="ghost" onClick={() => navigate(`/documents/${row.document.uid}`)}>Open document</Button>}
    {row.completion && <p>Extraction review (revision {row.document?.revision ?? "—"}): <strong>{human(row.completion.decision)}</strong>. Case checks and business approval are separate.</p>}
    {row.completion?.decision === "needs_review" && <Notice>{row.completion.reason_code === "invalid_document_attributes" ? "Some required document attributes are missing or invalid. Open the document to review the extracted fields and complete the draft." : `A review is required: ${human(row.completion.reason_code ?? "review_required")}. Open the document for details.`}</Notice>}
    {targets.length > 0 && <ul className="intake-cases">{targets.map((target: Row) => <li key={target.case_uid}>
      <Button variant="ghost" onClick={() => navigate(`/review/${target.case_uid}`)}>Case {target.case_uid.slice(0, 8)}</Button>
      <Status value={target.status} />
      {target.evaluation_uid && <Button variant="ghost" onClick={() => navigate(`/reconciliation?person=${row.subject_uid}&assignment=${target.case_uid}&evaluation=${target.evaluation_uid}`)}>View evaluation</Button>}
      {target.error_code && <span>{human(target.error_code)}</span>}
      {target.reason && <span>{human(target.reason)}</span>}
    </li>)}</ul>}
    {targets.length < row.target_count && <Button disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { const page = await api.get(`/document-allocations/${row.uid}?limit=20&offset=${targets.length}`); setExtraTargets((items) => [...items, ...page.targets]); }
      catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    }}>More case results</Button>}
    {row.resolution_required && <section className="intake-resolution" aria-label={`Resolve person for ${row.filename}`}>
      <p>Select the person this document belongs to. Other files continue processing.</p>
      <div className="actions"><Field label="Search subjects"><Input value={search} onChange={(e) => { setSearch(e.target.value); setPeople([]); setHasMore(false); }} /></Field>
        <Button disabled={busy} onClick={() => void findPeople()}>Find subjects</Button></div>
      <fieldset><legend>Matching subjects</legend>{candidates.map((p: Row) => <label key={p.uid} className="intake-person">
        <input type="radio" name={`subject-${row.uid}`} value={p.uid} checked={person === p.uid} onChange={() => setPerson(p.uid)} />
        {p.full_name ?? "Unnamed subject"} <small>{p.uid.slice(0, 8)}{p.date_of_birth ? ` · ${p.date_of_birth}` : ""}</small>
      </label>)}</fieldset>
      {hasMore && <Button disabled={busy} onClick={() => void findPeople(offset + 20)}>More subjects</Button>}
      <Button variant="primary" disabled={!person || busy} onClick={() => void act("resolve")}>Confirm person and continue</Button>
    </section>}
    {(row.status === "failed" || queuedLong || row.dispatch_error) && <Button disabled={busy} onClick={() => void act("retry")}>Retry processing</Button>}
    {row.stage === "uploading" && <Notice>Upload is incomplete. Select the same file again to resume.</Notice>}
    {error && <Notice error>{error}</Notice>}
  </article>;
}

export function DropFiles({ userUid }: { userUid: string }) {
  const [limits, setLimits] = useState<Limits>();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [tick, setTick] = useState(0);
  const pending = useRef<Upload[]>([]);
  const active = useRef(0);
  const alive = useRef(true);
  const chooser = useRef<HTMLInputElement>(null);
  const refresh = () => setTick((n) => n + 1);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = []; }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    void api.get<Limits>("/document-intakes/config", abort.signal).then(setLimits).catch((e) => { if (!abort.signal.aborted) setError(errorText(e)); });
    return () => abort.abort();
  }, [tick]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]);
        const page = await api.get(`/document-intakes?limit=20&offset=${offset}`, signal);
        if (abort.signal.aborted) return;
        setRows(page.items); setHasMore(page.has_more); setTotal(page.total_items); setError("");
        setUploads((items) => items.filter((item) => !item.result || !page.items.some((row: Row) => row.uid === item.result?.uid)));
      } catch { if (!abort.signal.aborted) setError("We couldn’t refresh file status. Received files may still be processing. We’ll retry automatically, or you can refresh the queue."); }
      if (!abort.signal.aborted) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [offset, tick]);
  const update = (key: string, change: Partial<Upload>) => {
    if (alive.current) setUploads((items) => items.map((item) => item.key === key ? { ...item, ...change } : item));
  };
  async function send(item: Upload) {
    let storageKey = "";
    try {
      update(item.key, { stage: "Preparing upload", error: undefined });
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await item.file.arrayBuffer())), (n) => n.toString(16).padStart(2, "0")).join("");
      const identity = new TextEncoder().encode(JSON.stringify([hash, item.file.name, mediaType(item.file), item.file.size]));
      const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", identity)), (n) => n.toString(16).padStart(2, "0")).join("");
      storageKey = `backoffice.intake:${userUid}:${requestHash}`;
      item.operation ??= savedState(storageKey) ?? crypto.randomUUID();
      savedState(storageKey, item.operation);
      const form = new FormData();
      form.append("operation_key", item.operation);
      form.append("file", new Blob([item.file], { type: mediaType(item.file) }), item.file.name);
      update(item.key, { stage: "Uploading" });
      const result = await (await api.response("/document-intakes", { method: "POST", body: form })).json();
      savedState(storageKey, null);
      update(item.key, { result, stage: "Received" });
      if (alive.current) refresh();
    } catch (e) { update(item.key, { stage: "Upload failed", error: errorText(e), operation: item.operation }); }
    finally { active.current--; pump(); }
  }
  function pump() {
    if (!alive.current || !limits) return;
    while (active.current < Math.min(limits.upload_concurrency, 2) && pending.current.length) {
      const next = pending.current.shift()!; active.current++; void send(next);
    }
  }
  function add(files: FileList | File[]) {
    if (!limits) return;
    const added = Array.from(files).map((file) => ({ key: crypto.randomUUID(), file, stage: "Queued" } as Upload));
    for (const item of added) {
      if (!limits.media_types.includes(mediaType(item.file)) || item.file.size < 1 || item.file.size > limits.max_bytes) {
        item.stage = "Unsupported file"; item.error = `Choose a PDF, PNG or JPEG between 1 byte and ${limits.max_bytes / 1024 / 1024} MiB.`;
      } else pending.current.push(item);
    }
    setUploads((items) => [...added, ...items]); setOffset(0); pump();
  }
  return <main className="drop-files-page">
    <header><h1>Drop files</h1><p>We’ll identify each document and person, add it to every case that needs it, and update the case checks.</p></header>
    {error && <Notice error>{error}<Button onClick={refresh}>Refresh queue</Button></Notice>}
    <ApplicationCard>
      <div className={`drop-zone${drag ? " drop-zone-active" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>
        <h2>Drop your documents here</h2>
        <p>Several files, one simple step. Each file is processed independently.</p>
        <Button variant="primary" disabled={!limits} onClick={() => chooser.current?.click()}>Choose files</Button>
        <input ref={chooser} type="file" multiple accept="application/pdf,image/png,image/jpeg" className="drop-file-input" aria-label="Choose documents" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
        <p className="drop-limits">{limits ? `PDF, PNG or JPEG · Up to ${limits.max_bytes / 1024 / 1024} MiB and ${limits.max_pages} pages per file` : "Loading upload limits…"}</p>
      </div>
    </ApplicationCard>
    <p>Once a file is received, processing continues even if you leave this page. If a person is uncertain, we’ll ask you to resolve that file.</p>
    <section aria-label="File processing queue" className="intake-queue">
      <h2>Your files <small>{total > 0 ? `(${total} received)` : ""}</small></h2>
      {uploads.map((item) => item.result ? <IntakeResult key={item.key} row={item.result} refresh={refresh} /> : <article key={item.key} className="intake-result">
        <header><h3>{item.file.name}</h3><span role="status">{item.stage}</span></header>
        {["Uploading", "Preparing upload"].includes(item.stage) && <progress aria-label={`Upload ${item.file.name}`} />}
        {item.error && <Notice error>{item.error}</Notice>}
        {item.stage === "Upload failed" && <Button onClick={() => { update(item.key, { stage: "Queued", error: undefined }); pending.current.push(item); pump(); }}>Retry upload</Button>}
      </article>)}
      {rows.map((row) => <IntakeResult key={row.uid} row={row} refresh={refresh} />)}
      {!rows.length && !uploads.length && !error && <p>Your received files will appear here.</p>}
      <div className="actions"><Button disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 20))}>Previous files</Button><Button disabled={!hasMore} onClick={() => setOffset((n) => n + 20)}>More files</Button></div>
    </section>
  </main>;
}
