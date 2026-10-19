import { human, type Row } from "./api";

/** Display JSON pointers and dotted field paths without exposing machine keys. */
export function evidenceFieldLabel(pointer: string) {
  return pointer
    .replace(/^\//, "")
    .split(/[/.]/)
    .filter(Boolean)
    .map((part) => {
      const decoded = part.replaceAll("~1", "/").replaceAll("~0", "~");
      return /^\d+$/.test(decoded)
        ? `Item ${Number(decoded) + 1}`
        : human(decoded.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
    })
    .join(" › ");
}

export interface EvidenceRequirement {
  key: string;
  title: string;
  finding?: Row;
  options: Row[];
  documents: Row[];
  comparison: boolean;
}

/** Associate case-linked candidates using explicit finding references and pinned policy options.
 * Candidate association does not establish that a document satisfies the requirement.
 */
export function groupRequiredEvidence(
  findings: Row[],
  documents: Row[],
  policy: Row,
): EvidenceRequirement[] {
  const groups: EvidenceRequirement[] = findings.map((finding) => {
    const requirement = policy.requirements?.find(
      (r: Row) => r.key === finding.requirement_key,
    );
    const comparison = policy.comparisons?.find(
      (r: Row) => r.key === finding.requirement_key,
    );
    const options: Row[] = finding.alternatives?.length
      ? finding.alternatives
      : (requirement?.options ??
        (comparison ? [comparison.left, comparison.right] : []));
    const referenced = new Set(
      (finding.document_references ?? []).map((ref: Row) => ref.document_uid),
    );
    return {
      key: finding.requirement_key,
      title: human(finding.requirement_key),
      finding,
      options,
      comparison: Boolean(comparison),
      documents: documents.filter(
        (document) =>
          referenced.has(document.uid) ||
          options.some(
            (option) =>
              option.document_type === document.document_type &&
              option.schema_version === document.schema_version,
          ),
      ),
    };
  });
  const assigned = new Set(
    groups.flatMap((group) => group.documents.map((document) => document.uid)),
  );
  const remaining = documents.filter((document) => !assigned.has(document.uid));
  if (remaining.length)
    groups.push({
      key: "other-linked-documents",
      title: "Other linked documents",
      finding: undefined,
      options: [],
      comparison: false,
      documents: remaining,
    });
  return groups;
}
