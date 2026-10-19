import type { StaticSiteIframeClient } from "@dev-mainsequence/command-center-sdk/embed";

export type Row = Record<string, any>;
export interface Schema {
  title?: string;
  description?: string;
  type?: string;
  format?: string;
  const?: unknown;
  enum?: unknown[];
  anyOf?: Schema[];
  $ref?: string;
  $defs?: Record<string, Schema>;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
}
export interface DocumentType {
  document_type: string;
  schema_version: number;
  name: string;
  description: string;
}
export interface Catalog {
  personSchema: Schema;
  types: DocumentType[];
  sets: Row[];
  viewer: { user_uid: string; can_review: boolean; is_organization_admin?: boolean };
}

export function savedState(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* Storage can be unavailable in an embedded privacy context. */
  }
  return null;
}
export function clearOperation() {
  savedState("backoffice.pending-operation", null);
  window.dispatchEvent(new Event("backoffice-operation"));
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(
      Array.isArray(detail)
        ? detail
            .map(
              (e: Row) =>
                `${(e.loc ?? []).filter((x: string) => x !== "body").join(".")}: ${e.msg}`,
            )
            .join("; ")
        : typeof detail === "string"
          ? detail.replaceAll("_", " ")
          : `Request failed (${status})`,
    );
  }
}

export class Api {
  bridge?: StaticSiteIframeClient;
  local =
    import.meta.env.DEV &&
    window.parent === window &&
    ["127.0.0.1", "localhost"].includes(location.hostname);
  private pending = new Map<string, string>();
  async response(path: string, init: RequestInit = {}) {
    const request = {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    };
    const result = this.local
      ? await fetch(`/api${path}`, request)
      : this.bridge
        ? await this.bridge.fetchFastApi(
            {
              resourceReleaseUid:
                import.meta.env.VITE_BACKOFFICE_API_RELEASE_UID ?? "",
              path,
            },
            request,
          )
        : (() => {
            throw new Error(
              "Open Back Office from Command Center to establish the secure application connection.",
            );
          })();
    if (!result.ok) {
      const body = await result
        .json()
        .catch(() => ({
          detail: "The service returned an unreadable response.",
        }));
      throw new ApiError(result.status, body.detail ?? body);
    }
    return result;
  }
  async get<T = Row>(path: string, signal?: AbortSignal): Promise<T> {
    return (await this.response(path, { signal })).json();
  }
  async command<T = Row>(
    path: string,
    data: Row = {},
    method = "POST",
  ): Promise<T> {
    const key = `${method} ${path} ${JSON.stringify(data)}`;
    const operation = this.pending.get(key) ?? crypto.randomUUID();
    const prior = savedState("backoffice.pending-operation");
    if (prior && prior !== operation)
      throw new Error(
        "Resolve the interrupted change before starting another one.",
      );
    this.pending.set(key, operation);
    savedState("backoffice.pending-operation", operation);
    try {
      const result = await this.response(path, {
        method,
        body: JSON.stringify({ ...data, operation_key: operation }),
      });
      const body = await result.json();
      this.pending.delete(key);
      clearOperation();
      return body;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status < 500 &&
        !(error.status === 409 && String(error.detail).includes("operation"))
      )
        clearOperation();
      else window.dispatchEvent(new Event("backoffice-operation"));
      throw error;
    }
  }
  async chunk(path: string, content_base64: string) {
    return this.response(path, {
      method: "PUT",
      body: JSON.stringify({ content_base64 }),
    });
  }
}
export const api = new Api();
export const human = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The operation could not finish.";
export const profileInput = (person: Row) =>
  Object.fromEntries(
    Object.entries(person).filter(([k]) => !["uid", "revision"].includes(k)),
  );

const uploads = new Map<string, string>();
export async function uploadFile(
  personUid: string,
  file: File,
  progress: (message: string) => void,
): Promise<Row> {
  if (file.size < 1 || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a file between 1 byte and 10 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const key = `${personUid}:${hash}:${file.name}`;
  let uid =
    uploads.get(key) ?? savedState(`backoffice.upload:${key}`) ?? undefined;
  if (!uid) {
    progress("Starting upload…");
    const created = await api.command("/source-documents/uploads", {
      person_uid: personUid,
      filename: file.name,
      media_type: file.type || "text/plain",
      byte_count: file.size,
      content_sha256: hash,
    });
    uid = created.uid;
    uploads.set(key, uid!);
    savedState(`backoffice.upload:${key}`, uid!);
  }
  const source = await api.get(`/source-documents/${uid}`);
  const chunkSize = source.chunk_bytes ?? 262144;
  const received = new Set(source.received_chunks ?? []);
  for (let index = 0; index * chunkSize < bytes.length; index++) {
    if (received.has(index)) continue;
    const chunk = bytes.subarray(
      index * chunkSize,
      Math.min((index + 1) * chunkSize, bytes.length),
    );
    let binary = "";
    for (let n = 0; n < chunk.length; n += 8192)
      binary += String.fromCharCode(...chunk.subarray(n, n + 8192));
    progress(
      `Uploading ${Math.min(100, Math.round((((index + 1) * chunkSize) / bytes.length) * 100))}%…`,
    );
    await api.chunk(
      `/source-documents/uploads/${uid}/chunks/${index}`,
      btoa(binary),
    );
  }
  progress("Verifying source integrity…");
  await api.command(`/source-documents/uploads/${uid}/finalize`);
  return api.get(`/source-documents/${uid}`);
}
