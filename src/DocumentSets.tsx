import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Field, Input, Textarea } from "@dev-mainsequence/command-center-sdk/controls";
import { ApplicationPage, ApplicationPageHeader, ApplicationPageStack } from "@dev-mainsequence/command-center-sdk/layout";
import { ResourceListPage, ResourcePicker } from "@dev-mainsequence/command-center-sdk/views";
import type { ResourceApplicationDefinition } from "@dev-mainsequence/command-center-sdk/resource";
import { api, errorText, human, type Catalog, type Row, type Schema } from "./api";
import { documentFieldInV1 } from "./DocumentScope";
import { evidenceFieldLabel } from "./ReviewEvidence";
import { Loading, Notice, OperationRecovery, useLoad } from "./ui";
import { navigate } from "./App";
import "./document-sets.css";

type Selection = { kind: "set" } | { kind: "requirement"; r: number } | { kind: "option"; r: number; o: number } | { kind: "comparison"; c: number };
const clone = <T,>(value: T): T => structuredClone(value);
const identifier = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const optionTitle = (option: Row) => human(option.document_type);
function conditionText(condition: Row | null) {
  if (!condition) return "Always applies";
  return condition.field === "residency_permit_required"
    ? `When a residency permit is ${condition.equals ? "required" : "not required"}`
    : `When employment status is ${human(String(condition.equals)).toLowerCase()}`;
}
function optionRules(option: Row): string[] {
  const rules = [];
  if (option.max_age_days != null) rules.push(`At most ${option.max_age_days} days old`);
  if (option.max_age_months != null) rules.push(`At most ${option.max_age_months} calendar months old`);
  if (option.freshness_field) rules.push(`Age measured from ${evidenceFieldLabel(option.freshness_field).toLowerCase()}`);
  if (option.renewal_interval_months != null)
    rules.push(`${option.renewal_basis === "submitted_at" ? "Submit a new revision" : "Review again"} every ${option.renewal_interval_months} calendar months from ${option.renewal_basis === "submitted_at" ? "submission" : "the last accepted review"}`);
  return rules;
}
function newOption(catalog: Catalog): Row {
  const type = catalog.types[0];
  return { document_type: type.document_type, schema_version: type.schema_version, required_fields: [], require_unexpired: false, max_age_days: null, max_age_months: null, freshness_field: null, renewal_interval_months: null, renewal_basis: "reviewed_at" };
}
const newRequirement = (catalog: Catalog): Row => ({ key: "", description: "", mandatory: true, min_count: 1, distinct_period_field: null, condition: null, options: [newOption(catalog)] });

async function allSets(signal?: AbortSignal) {
  const items: Row[] = [];
  let offset = 0;
  for (;;) {
    const page = await api.get(`/document-sets?limit=100&offset=${offset}`, signal);
    items.push(...page.items);
    offset += page.items.length;
    if (!page.has_more) return items;
    if (!page.items.length) throw new Error("The document set catalog returned an incomplete page.");
  }
}

export function DocumentSets({ catalog, selected, version }: { catalog: Catalog; selected?: string; version?: string }) {
  const [refresh, setRefresh] = useState(0);
  const loaded = useLoad((signal) => allSets(signal), [refresh]);
  const [created, setCreated] = useState<Row>();
  const sets = loaded.data ?? catalog.sets;
  const requestedVersion = version === undefined ? undefined : Number(version);
  const policy = created && created.key === selected && created.version === requestedVersion ? created
    : sets.filter((s) => s.key === selected && (requestedVersion === undefined || s.version === requestedVersion))
      .sort((a, b) => b.version - a.version)[0];
  const exact = useLoad(async (signal) => selected && selected !== "new" && requestedVersion !== undefined
    ? api.get(`/document-sets/${encodeURIComponent(selected)}/versions/${requestedVersion}`, signal) : null, [selected, requestedVersion, refresh]);
  const admin = catalog.viewer.is_organization_admin === true;
  const definition: ResourceApplicationDefinition<Row, string> = {
    id: "document-sets", label: "Document Sets", itemLabel: "versions",
    description: "Explore requirements and accepted documents, or create a reusable evidence policy.",
    getId: (s) => `${s.key}@${s.version}`,
    columns: [
      { id: "name", header: "Document set", importance: "primary", getValue: (s) => s.name },
      { id: "version", header: "Version", getValue: (s) => s.version },
      { id: "requirements", header: "Requirements", getValue: (s) => s.requirements.length },
      { id: "checks", header: "Cross-document checks", getValue: (s) => s.comparisons?.length ?? 0 },
    ],
    adapter: { async list(input) {
      const matching = sets.filter((s) => `${s.name} ${s.key}`.toLowerCase().includes((input.search ?? "").toLowerCase()));
      const start = input.pageIndex * input.pageSize;
      return { items: matching.slice(start, start + input.pageSize), pageInfo: { pageIndex: input.pageIndex, pageSize: input.pageSize, totalItems: matching.length, hasNextPage: start + input.pageSize < matching.length, hasPreviousPage: start > 0 } };
    } },
  };
  const copy = new URLSearchParams(location.search).get("copy");
  const seed = copy ? sets.find((s) => `${s.key}@${s.version}` === copy) : undefined;
  return <ApplicationPage maxWidth="full"><ApplicationPageStack>
    <OperationRecovery />
    {selected === "new" ? admin ? (copy && !seed && loaded.loading ? <Loading /> : <SetWorkspace key={`new:${copy ?? "empty"}`} catalog={catalog} seed={seed} editing onCreated={(result) => { setCreated(result); setRefresh((n) => n + 1); navigate(`/document-sets/${result.key}?version=${result.version}`); }} />)
      : <Notice error>Organization administrator access is required to create document sets.</Notice>
    : selected ? (policy || exact.data ? <SetWorkspace key={`published:${selected}@${version}`} catalog={catalog} seed={policy ?? exact.data!} />
      : <><Button onClick={() => navigate("/document-sets")}>All document sets</Button>{loaded.loading || exact.loading ? <Loading /> : <Notice error>{exact.error || loaded.error || "This published document set version is unavailable."}</Notice>}</>)
    : <>{loaded.error && <Notice error>{loaded.error}</Notice>}<ResourceListPage definition={definition} refreshKey={loaded.data} tablePresentation="table"
      primaryActions={admin ? [{ id: "new-set", label: "New document set", onSelect: () => navigate("/document-sets/new") }] : []}
      onRowActivate={(s) => navigate(`/document-sets/${s.key}?version=${s.version}`)} /></>}
  </ApplicationPageStack></ApplicationPage>;
}

function SetWorkspace({ catalog, seed, editing = false, onCreated }: { catalog: Catalog; seed?: Row; editing?: boolean; onCreated?: (result: Row) => void }) {
  const [policy, setPolicy] = useState<Row>(() => editing ? seed ? { ...clone(seed), key: "", version: 1, name: `${seed.name} copy` } : { key: "", version: 1, name: "", description: "", allow_document_reuse: true, requirements: [], comparisons: [] } : clone(seed!));
  const [selection, select] = useState<Selection>({ kind: "set" });
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(seed?.requirements?.length ? [0] : []));
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [caseTypes, setCaseTypes] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const details = useRef<HTMLElement>(null);
  const types = useLoad((signal) => api.get("/case-types", signal), []);
  useEffect(() => {
    if (!editing || !dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [editing, dirty]);
  const update = (next: Row) => { setPolicy(next); setDirty(true); setError(""); };
  const changeRequirement = (r: number, next: Row) => update({ ...policy, requirements: policy.requirements.map((item: Row, i: number) => i === r ? next : item) });
  const changeOption = (r: number, o: number, next: Row) => changeRequirement(r, { ...policy.requirements[r], options: policy.requirements[r].options.map((item: Row, i: number) => i === o ? next : item) });
  const changeComparison = (c: number, next: Row) => update({ ...policy, comparisons: policy.comparisons.map((item: Row, i: number) => i === c ? next : item) });
  function choose(next: Selection) {
    select(next);
    if (next.kind === "requirement" || next.kind === "option") setExpanded((old) => new Set([...old, next.r]));
    if (window.matchMedia("(max-width: 800px)").matches) details.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function addRequirement() {
    const r = policy.requirements.length;
    update({ ...policy, requirements: [...policy.requirements, newRequirement(catalog)] });
    setExpanded((old) => new Set([...old, r])); setFilter(""); choose({ kind: "requirement", r });
  }
  function addComparison() {
    const base = newOption(catalog);
    const selector = { document_type: base.document_type, schema_version: base.schema_version, field: "", unit_field: null, context_fields: [] };
    const c = policy.comparisons.length;
    update({ ...policy, comparisons: [...policy.comparisons, { key: "", description: "", topic: "", left: clone(selector), right: clone(selector), operator: "exact", mandatory: true, when_both_present: false, absolute_tolerance: "0", relative_tolerance_basis_points: 0 }] });
    setFilter(""); choose({ kind: "comparison", c });
  }
  async function publish() {
    if (pending) return;
    setError("");
    if (!policy.name.trim() || !policy.description.trim() || !/^[a-z][a-z0-9_]{0,119}$/.test(policy.key)) { select({ kind: "set" }); setError("Enter a name, description and unique identifier. Identifiers start with a lowercase letter and contain letters, numbers or underscores."); return; }
    if (!caseTypes.length) { select({ kind: "set" }); setError("Choose at least one case type that can use this document set."); return; }
    if (!policy.requirements.length) { setError("Add at least one evidence requirement."); return; }
    setPending(true);
    try { const result = await api.command("/admin/document-sets", { definition: policy, case_type_keys: caseTypes }); setDirty(false); onCreated?.(result); }
    catch (e) { setError(errorText(e)); }
    finally { setPending(false); }
  }
  const requirements: Row[] = policy.requirements;
  const comparisons: Row[] = policy.comparisons ?? [];
  const r = selection.kind === "requirement" || selection.kind === "option" ? requirements[selection.r] : undefined;
  const o = selection.kind === "option" ? r?.options[selection.o] : undefined;
  const c = selection.kind === "comparison" ? comparisons[selection.c] : undefined;
  const title = selection.kind === "set" ? editing ? "Document set details" : "Overview" : o ? optionTitle(o) : r ? human(r.key || "New requirement") : human(c?.key || "New check");
  const query = filter.toLowerCase().trim();
  const matches = (value: unknown) => !query || JSON.stringify(value).toLowerCase().replaceAll("_", " ").includes(query);
  function row(label: string, meta: ReactNode, selected: boolean, onClick: () => void, child = false) {
    return <Button key={`${label}:${typeof meta === "string" ? meta : ""}`} type="button" variant="ghost" className={`set-tree-row${child ? " set-tree-child" : ""}`} aria-current={selected ? "true" : undefined} onClick={onClick}>
      <span className="set-tree-label">{label}</span><span className="set-tree-meta">{meta}</span>
    </Button>;
  }
  return <>
    <div className="set-breadcrumb"><Button size="small" variant="ghost" onClick={() => navigate("/document-sets")}>Document Sets</Button><span aria-hidden="true">/</span><span>{editing ? "New document set" : policy.name}</span></div>
    <ApplicationPageHeader title={editing ? "New document set" : policy.name} description={editing ? "Build the requirements in the tree, then publish the complete set." : `Published version ${policy.version} · ${requirements.length} requirements · ${comparisons.length} cross-document checks`}
      actions={<div className="actions">{editing ? <Button variant="primary" onClick={() => void publish()} disabled={pending}>{pending ? "Publishing…" : "Create document set"}</Button>
        : catalog.viewer.is_organization_admin === true && <><Button onClick={() => navigate(`/document-sets/new?copy=${encodeURIComponent(`${policy.key}@${policy.version}`)}`)}>Use as template</Button><Button variant="primary" onClick={() => navigate("/document-sets/new")}>New document set</Button></>}</div>} />
    {error && <Notice error>{error} Your entries are preserved.</Notice>}
    <div className="set-workspace">
      <nav className="set-tree" aria-label="Document set explorer">
        <div className="set-tree-tools"><Field label="Find a requirement or document" controlId="set-search"><Input id="set-search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search this set…" /></Field>
          <div className="actions"><Button size="small" variant="ghost" onClick={() => setExpanded(new Set(requirements.map((_, i) => i)))}>Expand all</Button><Button size="small" variant="ghost" onClick={() => setExpanded(new Set())}>Collapse all</Button></div></div>
        {row(editing ? policy.name || "Untitled document set" : "Overview", editing ? "Draft" : `v${policy.version}`, selection.kind === "set", () => choose({ kind: "set" }))}
        <div className="set-tree-group"><h2>Required evidence <span>{requirements.length}</span></h2>{editing && <Button size="small" variant="ghost" onClick={addRequirement} disabled={pending}>+ Requirement</Button>}</div>
        {!requirements.length && <p className="set-tree-empty">Add a requirement, then choose the documents it accepts.</p>}
        {requirements.map((requirement, ri) => matches(requirement) && <div key={ri} className="set-tree-branch">
          <div className="set-tree-parent"><Button variant="ghost" size="small" className="set-tree-toggle" aria-label={`${expanded.has(ri) ? "Collapse" : "Expand"} ${human(requirement.key || "New requirement")}`} aria-expanded={expanded.has(ri) || !!query} onClick={() => setExpanded((old) => { const next = new Set(old); next.has(ri) ? next.delete(ri) : next.add(ri); return next; })}>{expanded.has(ri) || query ? "⌄" : "›"}</Button>
            {row(human(requirement.key || "New requirement"), <>{requirement.mandatory ? "Required" : "Optional"} · {requirement.min_count} min</>, selection.kind === "requirement" && selection.r === ri, () => choose({ kind: "requirement", r: ri }))}</div>
          {(expanded.has(ri) || query) && <div className="set-tree-children">{requirement.options.map((option: Row, oi: number) => row(optionTitle(option), `v${option.schema_version}`, selection.kind === "option" && selection.r === ri && selection.o === oi, () => choose({ kind: "option", r: ri, o: oi }), true))}
            {editing && <Button size="small" variant="ghost" className="set-tree-add" disabled={pending} onClick={() => { const oi = requirement.options.length; changeRequirement(ri, { ...requirement, options: [...requirement.options, newOption(catalog)] }); choose({ kind: "option", r: ri, o: oi }); }}>+ Accepted document</Button>}</div>}
        </div>)}
        <div className="set-tree-group"><h2>Cross-document checks <span>{comparisons.length}</span></h2>{editing && <Button size="small" variant="ghost" onClick={addComparison} disabled={pending || comparisons.length >= 25}>+ Check</Button>}</div>
        {comparisons.map((comparison, ci) => matches(comparison) && <div key={ci}>{row(human(comparison.key || "New check"), human(comparison.operator), selection.kind === "comparison" && selection.c === ci, () => choose({ kind: "comparison", c: ci }))}</div>)}
        {!comparisons.length && <p className="set-tree-empty">No cross-document checks.</p>}
        {query && !requirements.some(matches) && !comparisons.some(matches) && <p className="set-tree-empty">No matching requirements or checks.</p>}
      </nav>
      <section ref={details} className="set-detail" aria-label="Selected item details">
        <header className="set-detail-header"><div><span className="muted">{selection.kind === "set" ? "DOCUMENT SET" : selection.kind === "option" ? `ACCEPTED DOCUMENT · ${human(r!.key || "New requirement")}` : selection.kind === "requirement" ? "EVIDENCE REQUIREMENT" : "CROSS-DOCUMENT CHECK"}</span><h2>{title}</h2></div>{!editing && <Badge>{o ? `Schema v${o.schema_version}` : r || c ? (r ?? c)!.mandatory ? "Required" : "Optional" : `Version ${policy.version}`}</Badge>}</header>
        <fieldset disabled={pending} className="set-detail-content">
        {selection.kind === "set" ? editing ? <>
          <TextField label="Name" value={policy.name} onChange={(name) => update({ ...policy, name, key: !policy.key || policy.key === identifier(policy.name) ? identifier(name) : policy.key })} required />
          <TextField label="Identifier" value={policy.key} onChange={(key) => update({ ...policy, key })} required hint="A unique permanent identifier, such as business_loan_evidence." />
          <TextField label="Description" value={policy.description} onChange={(description) => update({ ...policy, description })} multiline required />
          {types.error ? <><Notice error>{types.error}</Notice><Button onClick={types.refresh}>Retry case types</Button></> : <Picker label="Available for case types" multiple value={caseTypes} onChange={(next) => { setCaseTypes(next as string[]); setDirty(true); }} loading={types.loading} options={(types.data?.items ?? []).map((t: Row) => ({ value: t.key, label: t.name }))} />}
          <Toggle label="A document can satisfy several requirements" value={policy.allow_document_reuse} onChange={(allow_document_reuse) => update({ ...policy, allow_document_reuse })} />
          <p className="muted">Creates published version 1. Existing sets and cases keep their current versions.</p>
        </> : <>
          <p className="set-description">{policy.description}</p>
          <Facts rows={[["Evidence requirements", requirements.length], ["Cross-document checks", comparisons.length], ["Document reuse", policy.allow_document_reuse ? "A document may satisfy multiple requirements" : "Each requirement needs separate documents"], ["Available for", (types.data?.items ?? []).filter((t: Row) => (t.document_sets ?? []).some((s: Row) => s.key === policy.key && s.version === policy.version)).map((t: Row) => t.name).join(", ") || "Not assigned to a case type"]]} />
          <p className="muted">Choose a requirement or accepted document in the tree to inspect its rules.</p>
          <details className="set-date-help"><summary>Date and renewal rules</summary><p>Dates are evaluated in UTC. Calendar-month anniversaries clamp to the last day of a shorter month. Evidence is fresh through its age limit; periodic renewal is due on its anniversary.</p></details>
        </> : selection.kind === "requirement" && r ? editing ? <>
          <TextField label="Requirement name" value={human(r.key)} onChange={(value) => changeRequirement(selection.r, { ...r, key: value.toLowerCase().replaceAll(" ", "_") })} required />
          <TextField label="Why this evidence is needed" value={r.description} onChange={(description) => changeRequirement(selection.r, { ...r, description })} multiline required />
          <Toggle label="Required when applicable" value={r.mandatory} onChange={(mandatory) => changeRequirement(selection.r, { ...r, mandatory })} />
          <NumberField label="Minimum distinct documents" value={r.min_count} min={1} onChange={(min_count) => changeRequirement(selection.r, { ...r, min_count })} />
          <Picker label="Applies" value={r.condition?.field ?? "always"} options={[{ value: "always", label: "Always" }, { value: "employment_status", label: "When employment status matches" }, { value: "residency_permit_required", label: "When residency permit requirement matches" }]} onChange={(field) => changeRequirement(selection.r, { ...r, condition: field === "always" ? null : { field, equals: field === "employment_status" ? "employed" : true } })} />
          {r.condition && <Picker label="Expected value" value={String(r.condition.equals)} options={r.condition.field === "residency_permit_required" ? [{ value: "true", label: "Required" }, { value: "false", label: "Not required" }] : ["employed", "self_employed", "unemployed", "retired", "student"].map((value) => ({ value, label: human(value) }))} onChange={(value) => changeRequirement(selection.r, { ...r, condition: { ...r.condition, equals: r.condition.field === "residency_permit_required" ? value === "true" : value } })} />}
          <TextField label="Distinct reporting period field (optional)" value={r.distinct_period_field ?? ""} onChange={(value) => changeRequirement(selection.r, { ...r, distinct_period_field: value || null })} hint="For example, reporting_period. Every accepted document must contain a start and end date at this path." />
          <Button variant="danger" onClick={() => { update({ ...policy, requirements: requirements.filter((_, i) => i !== selection.r) }); select({ kind: "set" }); }}>Remove requirement</Button>
        </> : <>
          <p className="set-description">{r.description}</p>
          <Facts rows={[["Applies", conditionText(r.condition)], ["Minimum evidence", `${r.min_count} distinct document${r.min_count === 1 ? "" : "s"}`], ...(r.distinct_period_field ? [["Distinct reporting periods", evidenceFieldLabel(r.distinct_period_field)]] : [])]} />
          <h3>Accepted documents <span className="muted">· Any qualifying alternative</span></h3>
          <div className="set-accepted-list">{r.options.map((option: Row, oi: number) => <Button key={oi} variant="ghost" onClick={() => choose({ kind: "option", r: selection.r, o: oi })}><span>{optionTitle(option)} <span className="muted">· v{option.schema_version}</span></span><span aria-hidden="true">›</span></Button>)}</div>
          {r.condition && <p className="muted">Missing reference information leaves applicability unresolved and needs clarification.</p>}
        </> : selection.kind === "option" && o ? editing ? <>
          <OptionEditor option={o} catalog={catalog} onChange={(next) => changeOption(selection.r, selection.o, next)} />
          <Button variant="danger" onClick={() => { changeRequirement(selection.r, { ...r, options: r!.options.filter((_: Row, i: number) => i !== selection.o) }); select({ kind: "requirement", r: selection.r }); }}>Remove accepted document</Button>
        </> : <>
          <p className="set-description">One qualifying {optionTitle(o).toLowerCase()} can contribute to <strong>{human(r!.key)}</strong>.</p>
          <Facts rows={[["Schema version", o.schema_version], ["Validity", o.require_unexpired ? "Must be currently valid" : "No additional expiration rule"], ["Additional required fields", o.required_fields?.length ? o.required_fields.map(evidenceFieldLabel).join(", ") : "None beyond the document schema"]]} />
          <h3>Date and renewal rules</h3>{optionRules(o).length ? <ul className="set-rule-list">{optionRules(o).map((rule) => <li key={rule}>{rule}</li>)}</ul> : <p className="muted">No age limit or periodic renewal configured.</p>}
        </> : selection.kind === "comparison" && c ? editing ? <>
          <ComparisonEditor rule={c} catalog={catalog} onChange={(next) => changeComparison(selection.c, next)} />
          <Button variant="danger" onClick={() => { update({ ...policy, comparisons: comparisons.filter((_, i) => i !== selection.c) }); select({ kind: "set" }); }}>Remove check</Button>
        </> : <>
          <p className="set-description">{c.description}</p>
          <Facts rows={[["Method", human(c.operator)], ["Applies", c.when_both_present ? "Only when both document types are present" : "Both document types are required"], ["Comparison topic", c.topic]]} />
          <h3>Fields compared</h3><div className="set-compare-fields">{[c.left, c.right].map((side: Row, i: number) => <div key={i}><span className="muted">{i === 0 ? "Left" : "Right"}</span><strong>{optionTitle(side)} · v{side.schema_version}</strong><span>{evidenceFieldLabel(side.field)}</span>{side.unit_field && <span className="muted">Unit: {evidenceFieldLabel(side.unit_field)}</span>}{side.context_fields?.length > 0 && <span className="muted">Context: {side.context_fields.map(evidenceFieldLabel).join(", ")}</span>}</div>)}</div>
          {c.operator === "numeric" && <Facts rows={[["Absolute tolerance", c.absolute_tolerance], ["Relative tolerance", `${c.relative_tolerance_basis_points / 100}% of the left value`]]} />}
        </> : null}
        </fieldset>
      </section>
    </div>
  </>;
}

function Facts({ rows }: { rows: unknown[][] }) { return <dl className="set-facts">{rows.map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{String(value)}</dd></div>)}</dl>; }
function TextField({ label, value, onChange, required, hint, multiline }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; hint?: string; multiline?: boolean }) {
  const id = `set-${identifier(label)}`;
  return <Field label={label} controlId={id} required={required} description={hint}>{multiline ? <Textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} rows={3} required={required} /> : <Input id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} required={required} />}</Field>;
}
function NumberField({ label, value, onChange, min = 0, max }: { label: string; value: number | null; onChange: (value: number | null) => void; min?: number; max?: number }) {
  const id = `set-${identifier(label)}`;
  return <Field label={label} controlId={id}><Input id={id} type="number" min={min} max={max} step="1" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} /></Field>;
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="set-toggle"><span>{label}</span><Button size="small" aria-label={label} aria-pressed={value} onClick={() => onChange(!value)}>{value ? "Yes" : "No"}</Button></div>;
}
type Choice = { value: string; label: string };
function Picker({ label, value, options, onChange, multiple = false, loading = false }: { label: string; value: string | string[]; options: Choice[]; onChange: (value: any) => void; multiple?: boolean; loading?: boolean }) {
  const id = `set-${identifier(label)}`;
  return <Field label={label} controlId={id}>{multiple ? <ResourcePicker id={id} ariaLabel={label} fullWidth mode="multiple" options={options} value={value as string[]} onValueChange={onChange} loading={loading} /> : <ResourcePicker id={id} ariaLabel={label} fullWidth options={options} value={value as string} onValueChange={onChange} loading={loading} />}</Field>;
}
function fieldsOf(schema: Schema, root = schema, prefix = ""): { value: string; label: string; format?: string }[] {
  if (schema.$ref) return fieldsOf(root.$defs?.[schema.$ref.split("/").pop()!] ?? {}, root, prefix);
  const resolved = schema.anyOf?.find((item) => item.type !== "null") ?? schema;
  if (resolved !== schema) return fieldsOf(resolved, root, prefix);
  return Object.entries(schema.properties ?? {}).filter(([key]) => !["uid", "revision", "document_type", "schema_version"].includes(key) && documentFieldInV1(key)).flatMap(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const target = field.$ref ? root.$defs?.[field.$ref.split("/").pop()!] ?? field : field.anyOf?.find((item) => item.type !== "null") ?? field;
    return target.properties ? fieldsOf(target, root, path) : [{ value: path, label: evidenceFieldLabel(path), format: target.format }];
  });
}
function useDocumentFields(option: Row) {
  const loaded = useLoad((signal) => api.get(`/document-types/${option.document_type}/schema?version=${option.schema_version}`, signal), [option.document_type, option.schema_version]);
  return { ...loaded, fields: loaded.data ? fieldsOf(loaded.data.canonical_schema) : [] };
}
function TypeFields({ value, catalog, onChange, label = "" }: { value: Row; catalog: Catalog; onChange: (value: Row) => void; label?: string }) {
  const options = catalog.types.map((type) => ({ value: type.document_type, label: human(type.document_type) }));
  return <><Picker label={`${label}Document type`} value={value.document_type} options={options} onChange={(document_type) => onChange({ ...value, document_type, schema_version: catalog.types.find((t) => t.document_type === document_type)!.schema_version })} />
    <NumberField label={`${label}Schema version`} value={value.schema_version} min={1} onChange={(schema_version) => onChange({ ...value, schema_version })} /></>;
}
function OptionEditor({ option, catalog, onChange }: { option: Row; catalog: Catalog; onChange: (value: Row) => void }) {
  const schema = useDocumentFields(option);
  const age = option.max_age_months != null ? "months" : option.max_age_days != null ? "days" : "none";
  return <>
    <TypeFields value={option} catalog={catalog} onChange={(next) => onChange({ ...newOption(catalog), document_type: next.document_type, schema_version: next.schema_version })} />
    {schema.error && <Notice error>{schema.error}</Notice>}
    <Picker label="Additional required fields" multiple value={option.required_fields} options={schema.fields} onChange={(required_fields) => onChange({ ...option, required_fields })} loading={schema.loading} />
    <Toggle label="Must be currently valid" value={option.require_unexpired} onChange={(require_unexpired) => onChange({ ...option, require_unexpired })} />
    <Picker label="Maximum document age" value={age} options={[{ value: "none", label: "No age limit" }, { value: "days", label: "Calendar days" }, { value: "months", label: "Calendar months" }]} onChange={(basis) => onChange({ ...option, max_age_days: basis === "days" ? 90 : null, max_age_months: basis === "months" ? 6 : null, freshness_field: basis === "none" ? null : schema.fields.find((f) => ["date", "date-time"].includes(f.format ?? ""))?.value ?? null })} />
    {age !== "none" && <><NumberField label={age === "months" ? "Maximum age in months" : "Maximum age in days"} value={age === "months" ? option.max_age_months : option.max_age_days} min={age === "months" ? 1 : 0} onChange={(value) => onChange({ ...option, [age === "months" ? "max_age_months" : "max_age_days"]: value })} />
      <Picker label="Measure age from" value={option.freshness_field ?? ""} options={schema.fields.filter((f) => ["date", "date-time"].includes(f.format ?? ""))} onChange={(freshness_field) => onChange({ ...option, freshness_field })} /></>}
    <NumberField label="Renew every (months, optional)" value={option.renewal_interval_months} min={1} max={1200} onChange={(renewal_interval_months) => onChange({ ...option, renewal_interval_months, renewal_basis: renewal_interval_months == null ? "reviewed_at" : option.renewal_basis })} />
    {option.renewal_interval_months != null && <Picker label="Renewal measured from" value={option.renewal_basis} options={[{ value: "reviewed_at", label: "Last accepted review" }, { value: "submitted_at", label: "Last submitted revision" }]} onChange={(renewal_basis) => onChange({ ...option, renewal_basis })} />}
  </>;
}
function SelectorEditor({ side, value, catalog, onChange }: { side: string; value: Row; catalog: Catalog; onChange: (value: Row) => void }) {
  const schema = useDocumentFields(value);
  return <div className="set-selector"><h3>{side} document</h3><TypeFields label={`${side} `} value={value} catalog={catalog} onChange={(next) => onChange({ ...next, field: "", unit_field: null, context_fields: [] })} />
    {schema.error && <Notice error>{schema.error}</Notice>}
    <Picker label={`${side} field`} value={value.field} options={schema.fields} onChange={(field) => onChange({ ...value, field })} loading={schema.loading} />
    <Picker label={`${side} unit or currency`} value={value.unit_field ?? ""} options={[{ value: "", label: "None" }, ...schema.fields]} onChange={(unit_field) => onChange({ ...value, unit_field: unit_field || null })} />
    <Picker label={`${side} context fields`} multiple value={value.context_fields} options={schema.fields} onChange={(context_fields) => onChange({ ...value, context_fields })} />
  </div>;
}
function ComparisonEditor({ rule, catalog, onChange }: { rule: Row; catalog: Catalog; onChange: (value: Row) => void }) {
  return <>
    <TextField label="Check name" value={human(rule.key)} onChange={(value) => onChange({ ...rule, key: value.toLowerCase().replaceAll(" ", "_") })} required />
    <TextField label="What this check establishes" value={rule.description} onChange={(description) => onChange({ ...rule, description })} multiline required />
    <TextField label="Comparison topic" value={rule.topic} onChange={(topic) => onChange({ ...rule, topic })} required />
    <Picker label="Comparison method" value={rule.operator} options={["exact", "numeric", "semantic"].map((value) => ({ value, label: human(value) }))} onChange={(operator) => onChange({ ...rule, operator, ...(operator === "numeric" ? {} : { absolute_tolerance: "0", relative_tolerance_basis_points: 0 }) })} />
    <Toggle label="Required when applicable" value={rule.mandatory} onChange={(mandatory) => onChange({ ...rule, mandatory })} />
    <Toggle label="Only apply when both documents are present" value={rule.when_both_present} onChange={(when_both_present) => onChange({ ...rule, when_both_present })} />
    <SelectorEditor side="Left" value={rule.left} catalog={catalog} onChange={(left) => onChange({ ...rule, left })} />
    <SelectorEditor side="Right" value={rule.right} catalog={catalog} onChange={(right) => onChange({ ...rule, right })} />
    {rule.operator === "numeric" && <><TextField label="Absolute tolerance" value={String(rule.absolute_tolerance)} onChange={(absolute_tolerance) => onChange({ ...rule, absolute_tolerance })} /><NumberField label="Relative tolerance (basis points)" min={0} max={10000} value={rule.relative_tolerance_basis_points} onChange={(relative_tolerance_basis_points) => onChange({ ...rule, relative_tolerance_basis_points })} /></>}
  </>;
}
