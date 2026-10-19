import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button } from "@dev-mainsequence/command-center-sdk/controls";
import { ActivityIndicator } from "@dev-mainsequence/command-center-sdk/feedback";
import {
  api,
  ApiError,
  errorText,
  human,
  savedState,
  clearOperation,
} from "./api";

export function Status({ value }: { value: string }) {
  return (
    <Badge
      variant={
        ["accepted", "satisfied", "completed", "ready"].includes(value)
          ? "success"
          : ["rejected", "failed", "overdue", "due_today"].includes(value)
            ? "danger"
            : [
                  "due_soon",
                  "pending",
                  "pending_review",
                  "needs_review",
                  "needs_information",
                  "missing",
                  "needs_input",
                  "running",
                  "draft",
                ].includes(value)
              ? "warning"
              : "neutral"
      }
    >
      {human(value)}
    </Badge>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={error ? "notice error" : "notice"}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  dependencies: unknown[],
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [...dependencies, revision]);
  return { data, loading, error, refresh: () => refresh((value) => value + 1) };
}
export function useAction(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  async function run(action: () => Promise<unknown>, success = "Saved.") {
    if (pending) return;
    setPending(true);
    setMessage("");
    setError("");
    setConflict(false);
    try {
      await action();
      setMessage(success);
      onSuccess?.();
    } catch (e) {
      setError(errorText(e));
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setPending(false);
    }
  }
  return {
    pending,
    conflict,
    run,
    feedback: (
      <>
        {message && <Notice>{message}</Notice>}
        {error && (
          <Notice error>
            {error}
            {conflict && (
              <p>
                Your entered values are preserved. Reload the latest record
                before applying a new edit; retry an interrupted operation with
                the same values.
              </p>
            )}
          </Notice>
        )}
      </>
    ),
  };
}
export function Loading({ error }: { error?: string }) {
  return error ? (
    <Notice error>{error}</Notice>
  ) : (
    <ActivityIndicator label="Loading records" />
  );
}
export function SourcePreview({ uid, page = 1, expectedSha256 }: { uid: string; page?: number; expectedSha256?: string }) {
  const [url, setUrl] = useState("");
  const result = useLoad(
    async (signal) => {
      const source = await api.get(`/source-documents/${uid}`, signal);
      if (expectedSha256 && source.content_sha256 !== expectedSha256)
        throw new Error("This source does not match the cited checksum.");
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      for (let index = 0; index < source.chunk_count; index++) {
        const response = await api.get(
          `/source-documents/${uid}/chunks/${index}`,
          signal,
        );
        const bytes = Uint8Array.from(
          atob(response.content_base64),
          (character) => character.charCodeAt(0),
        );
        const checksum = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (checksum !== response.content_sha256)
          throw new Error("Source chunk checksum verification failed.");
        chunks.push(bytes);
      }
      const blob = source.storage_kind === "bucket"
        ? await (await api.response(`/source-documents/${uid}/content`, { signal })).blob()
        : new Blob(chunks, { type: source.media_type });
      const checksum = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (blob.size !== source.byte_count || checksum !== source.content_sha256)
        throw new Error("Source integrity verification failed.");
      return {
        source,
        blob,
        text: source.media_type === "text/plain" ? await blob.text() : "",
      };
    },
    [uid, expectedSha256],
  );
  useEffect(() => {
    if (!result.data) return;
    const next = URL.createObjectURL(result.data.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [result.data]);
  if (!result.data || result.loading || result.error || !url)
    return <Loading error={result.error} />;
  const { source, text } = result.data;
  return (
    <div className="source-preview">
      <h3>{source.filename}</h3>
      <p className="muted">
        {source.media_type} · {Math.ceil(source.byte_count / 1024)} KiB ·
        Verified source
      </p>
      {source.media_type.startsWith("image/") ? (
        <img src={url} alt={source.filename} />
      ) : source.media_type === "application/pdf" ? (
        <iframe src={`${url}#page=${page}`} title={`Source: ${source.filename}`} />
      ) : (
        <pre>{text}</pre>
      )}
      <a href={url} download={source.filename}>
        Download source
      </a>
    </div>
  );
}
export function Reload({ onClick }: { onClick: () => void }) {
  return (
    <Button size="small" onClick={onClick}>
      Reload latest
    </Button>
  );
}

export function OperationRecovery() {
  const [uid, setUid] = useState(() =>
    savedState("backoffice.pending-operation"),
  );
  useEffect(() => {
    const changed = () => setUid(savedState("backoffice.pending-operation"));
    window.addEventListener("backoffice-operation", changed);
    return () => window.removeEventListener("backoffice-operation", changed);
  }, []);
  const loaded = useLoad(
    (signal) =>
      uid ? api.get(`/operations/${uid}`, signal) : Promise.resolve(undefined),
    [uid],
  );
  const action = useAction();
  if (!uid) return null;
  return (
    <Notice>
      <div className="form-stack">
        <strong>An interrupted change needs attention</strong>
        <p>
          Check the recorded result before repeating the change. Resume uses the
          original saved request.
        </p>
        {loaded.loading ? (
          <ActivityIndicator label="Checking the last change" />
        ) : loaded.error ? (
          <>
            <p>{loaded.error}</p>
            <div className="actions">
              <Button onClick={loaded.refresh}>Check again</Button>
              <Button onClick={clearOperation}>Dismiss</Button>
            </div>
          </>
        ) : (
          <>
            <p>
              {human(loaded.data?.kind ?? "Change")}:{" "}
              {human(loaded.data?.status ?? "pending")}
            </p>
            <Button
              pending={action.pending}
              onClick={() =>
                void action.run(async () => {
                  if (loaded.data?.status !== "completed")
                    await api.response(`/operations/${uid}/resume`, {
                      method: "POST",
                    });
                  clearOperation();
                  location.reload();
                })
              }
            >
              {loaded.data?.status === "completed"
                ? "Reload saved result"
                : "Resume and reload"}
            </Button>
          </>
        )}
        {action.feedback}
      </div>
    </Notice>
  );
}
