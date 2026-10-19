import {
  Button,
  Field,
  Input,
} from "@dev-mainsequence/command-center-sdk/controls";
import { ResourcePicker } from "@dev-mainsequence/command-center-sdk/views";
import { human, type Schema } from "./api";

function resolve(schema: Schema, root: Schema): Schema {
  if (schema.$ref)
    return {
      ...resolve(root.$defs?.[schema.$ref.split("/").pop()!] ?? {}, root),
      ...Object.fromEntries(
        Object.entries(schema).filter(([k]) => k !== "$ref"),
      ),
    };
  const choices = schema.anyOf?.filter((s) => s.type !== "null");
  if (choices?.length) {
    // Decimal unions retain their textual representation; never round money in the browser.
    const choice = choices.find((s) => s.type === "string") ?? choices[0];
    return {
      ...resolve(choice, root),
      ...Object.fromEntries(
        Object.entries(schema).filter(([k]) => k !== "anyOf"),
      ),
    };
  }
  return schema;
}

interface Props {
  schema: Schema;
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  disabled?: boolean;
  prefix?: string;
  highlightMissing?: boolean;
  expandMissing?: boolean;
  showDescriptions?: boolean;
}
export function SchemaForm({
  schema,
  value,
  onChange,
  disabled,
  prefix = "form",
  highlightMissing = false,
  expandMissing = false,
  showDescriptions = true,
}: Props) {
  return (
    <div className="field-grid">
      {Object.entries(schema.properties ?? {})
        .filter(
          ([key, field]) =>
            !["uid", "revision", "document_type"].includes(key) &&
            field.const === undefined,
        )
        .map(([key, field]) => (
          <SchemaField
            key={key}
            schema={field}
            root={schema}
            value={value[key]}
            onChange={(next) => onChange({ ...value, [key]: next })}
            required={schema.required?.includes(key)}
            disabled={disabled}
            path={`${prefix}.${key}`}
            label={field.title ?? human(key)}
            highlightMissing={highlightMissing}
            expandMissing={expandMissing}
            showDescriptions={showDescriptions}
          />
        ))}
    </div>
  );
}

interface FieldProps {
  schema: Schema;
  root: Schema;
  value: any;
  onChange: (value: any) => void;
  required?: boolean;
  disabled?: boolean;
  path: string;
  label: string;
  highlightMissing: boolean;
  expandMissing: boolean;
  showDescriptions: boolean;
}
function SchemaField({
  schema,
  root,
  value,
  onChange,
  required,
  disabled,
  path,
  label,
  highlightMissing,
  expandMissing,
  showDescriptions,
}: FieldProps) {
  const field = resolve(schema, root);
  const title = schema.title ?? field.title ?? label;
  const description = showDescriptions
    ? (schema.description ?? field.description)
    : undefined;
  const empty = value == null || (typeof value === "string" && !value.trim());
  const missing = highlightMissing && required &&
    (empty || (Array.isArray(value) && value.length < (field.minItems ?? 0)));
  const optionalMissing = highlightMissing && !required && empty;
  if (field.type === "object" || field.properties) {
    if (value == null && !required && !expandMissing)
      return (
        <div className="structured-field">
          <strong>{title}</strong>
          {description && <p className="muted">{description}</p>}
          <Button size="small" disabled={disabled} onClick={() => onChange({})}>
            Add {title.toLowerCase()}
          </Button>
        </div>
      );
    return (
      <fieldset className="structured-field" disabled={disabled}>
        <legend>
          {title}
          {required ? " *" : ""}
        </legend>
        {description && <p className="muted">{description}</p>}
        <div className="field-grid">
          {Object.entries(field.properties ?? {}).map(([key, node]) => (
            <SchemaField
              key={key}
              schema={node}
              root={root}
              value={value?.[key]}
              onChange={(next) => onChange({ ...value, [key]: next })}
              required={
                (required || value != null) && field.required?.includes(key)
              }
              disabled={disabled}
              path={`${path}.${key}`}
              label={human(key)}
              highlightMissing={highlightMissing}
              expandMissing={expandMissing}
              showDescriptions={showDescriptions}
            />
          ))}
        </div>
        {!required && (
          <Button size="small" variant="ghost" onClick={() => onChange(null)}>
            Remove {title.toLowerCase()}
          </Button>
        )}
      </fieldset>
    );
  }
  if (field.type === "array")
    return (
      <fieldset
        className="structured-field"
        disabled={disabled}
        data-missing={missing || undefined}
        aria-invalid={missing || undefined}
      >
        <legend>
          {title}
          {required ? " *" : ""}
        </legend>
        {description && <p className="muted">{description}</p>}
        {(Array.isArray(value) ? value : []).map((item, index) => (
          <div className="array-item" key={index}>
            <SchemaField
              schema={field.items ?? { type: "string" }}
              root={root}
              value={item}
              onChange={(next) =>
                onChange(
                  value.map((v: any, i: number) => (i === index ? next : v)),
                )
              }
              required
              disabled={disabled}
              path={`${path}.${index}`}
              label={`${title} ${index + 1}`}
              highlightMissing={highlightMissing}
              expandMissing={expandMissing}
              showDescriptions={showDescriptions}
            />
            <Button
              size="small"
              variant="ghost"
              onClick={() =>
                onChange(value.filter((_: unknown, i: number) => i !== index))
              }
            >
              Remove item {index + 1}
            </Button>
          </div>
        ))}
        <Button
          size="small"
          disabled={
            disabled ||
            (field.maxItems !== undefined &&
              (value?.length ?? 0) >= field.maxItems)
          }
          onClick={() =>
            onChange([
              ...(value ?? []),
              resolve(field.items ?? {}, root).type === "object" ? {} : "",
            ])
          }
        >
          Add {title.toLowerCase()} item
        </Button>
      </fieldset>
    );
  const choice =
    field.enum ?? (field.type === "boolean" ? [true, false] : undefined);
  return (
    <Field
      label={title}
      required={required}
      description={
        field.format === "date-time"
          ? `${description ?? ""} Enter an ISO 8601 timestamp including its timezone.`
          : description
      }
      controlId={path}
      error={missing ? "Missing value" : undefined}
      className={missing ? "schema-field--missing" : optionalMissing ? "schema-field--optional-missing" : undefined}
      role={choice ? "group" : undefined}
      aria-invalid={missing || undefined}
    >
      {choice ? (
        <ResourcePicker
          id={path}
          ariaLabel={title}
          fullWidth
          value={value == null ? "" : String(value)}
          disabled={disabled}
          options={[
            { value: "", label: "Not provided" },
            ...choice.map((v) => ({
              value: String(v),
              label:
                typeof v === "boolean" ? (v ? "Yes" : "No") : human(String(v)),
            })),
          ]}
          onValueChange={(next) =>
            onChange(
              next === ""
                ? null
                : field.type === "boolean"
                  ? next === "true"
                  : next,
            )
          }
        />
      ) : (
        <Input
          id={path}
          disabled={disabled}
          value={value ?? ""}
          type={field.format === "date" ? "date" : "text"}
          inputMode={
            field.type === "integer" || field.type === "number"
              ? "decimal"
              : undefined
          }
          maxLength={field.maxLength}
          onChange={(event) => {
            const next = event.target.value;
            onChange(
              next === ""
                ? null
                : field.type === "integer" || field.type === "number"
                  ? Number(next)
                  : next,
            );
          }}
        />
      )}
      {optionalMissing && <small className="schema-optional-hint">Optional — not provided</small>}
    </Field>
  );
}
