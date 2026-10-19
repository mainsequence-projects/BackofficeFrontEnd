import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChatEngineProvider,
  ChatLauncher,
  ChatPageLayout,
  ChatRail,
  ChatThread,
  createLocalAgentSource,
  ModelProviderSettings,
  useChatEngine,
  type ChatDefaultSession,
  type ChatNotice,
} from "@dev-mainsequence/command-center-ai";
import { Button } from "@dev-mainsequence/command-center-sdk/controls";
import { api, errorText } from "../api";
import { assistantConnection, assistantViewer, loadAssistantContext, type AssistantContext } from "./connection";
import "./assistant.css";

const copy = {
  emptyTitle: "Back Office assistant",
  emptyDescription: "Ask about the selected person, their document set, or what is still missing. The assistant's initial tools are read-only.",
  composerPlaceholder: "Ask about this case…",
  sessionUnavailableTitle: "Back Office assistant is unavailable",
  disclaimer: "AI can make mistakes. Verify findings against the case records. Document reviews remain with reviewers.",
};

// Only references travel with a turn. The API verifies access to each record.
function recordContext(path: string) {
  const url = new URL(path, location.origin);
  const [section, id] = url.pathname.slice(1).split("/");
  const refs: Record<string, string> = {};
  if (section === "persons" && id) refs.person_uid = id;
  if (section === "review" && id) refs.assignment_uid = id;
  if (section === "documents" && id) {
    refs.document_uid = id;
    if (url.searchParams.has("revision")) refs.document_revision = url.searchParams.get("revision")!;
  }
  if (url.searchParams.has("person")) refs.person_uid = url.searchParams.get("person")!;
  if (url.searchParams.has("assignment")) refs.assignment_uid = url.searchParams.get("assignment")!;
  if (url.searchParams.has("evaluation")) refs.evaluation_uid = url.searchParams.get("evaluation")!;
  if (section === "document-sets" && id) {
    refs.document_set_key = id;
    if (url.searchParams.has("version")) refs.document_set_version = url.searchParams.get("version")!;
  }
  return { app: "backoffice", section: section || "persons", ...refs };
}

export function AssistantWorkspace({ children, path, userUid, onNavigate }: {
  children: ReactNode;
  path: string;
  userUid: string;
  onNavigate: (path: string) => void;
}) {
  const expanded = new URL(path, location.origin).pathname === "/agent";
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(540);
  const [docked, setDocked] = useState(() => matchMedia("(min-width: 1400px)").matches);
  const [context, setContext] = useState<AssistantContext | null>(null);
  const [viewerUid, setViewerUid] = useState<string | null>(api.local ? userUid : null);
  const [failure, setFailure] = useState("");
  const [attempt, retry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  const [railSessionId, setRailSessionId] = useState<string | null>(null);
  const returnTo = useRef("/persons");
  const [contextPath, setContextPath] = useState(expanded ? "/persons" : path);
  const visible = open || expanded;
  const requestedSessionId = expanded ? new URL(path, location.origin).searchParams.get("session") : railSessionId;
  const notify = useCallback((value: ChatNotice) => setNotice(value), []);
  const auth = useMemo(() => ({ userUid: viewerUid }), [viewerUid]);
  const localSource = useMemo(() => api.local ? createLocalAgentSource({
    baseUrl: "/__agent__",
    displayName: "Back Office Helper",
    userUid,
  }) : undefined, [userUid]);
  const viewContext = useMemo(() => recordContext(contextPath), [contextPath]);
  useEffect(() => {
    if (!expanded) {
      returnTo.current = path + location.hash;
      setContextPath(path);
    }
  }, [expanded, path]);
  useEffect(() => {
    const query = matchMedia("(min-width: 1400px)");
    const changed = () => setDocked(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const reconnect = () => retry((value) => value + 1);
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, []);
  useEffect(() => {
    if (!visible) return;
    if (api.local) {
      setViewerUid(userUid);
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    setLoading(true);
    setFailure("");
    Promise.all([loadAssistantContext(signal), assistantViewer(userUid, signal)])
      .then(([nextContext, nextViewer]) => {
        if (!signal.aborted) {
          setContext(nextContext);
          setViewerUid(nextViewer);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setContext(null);
          setViewerUid(null);
          setFailure(errorText(error));
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [visible, attempt, userUid]);
  const defaultSession = useMemo<ChatDefaultSession>(() => ({
    agentUid: context?.agentUid ?? null,
    handleUniqueId: "backoffice_assistant",
    name: "Back Office assistant",
    status: loading || !visible ? "loading" : failure ? "error" : context ? "ready" : "loading",
    unavailableMessage: failure || "The Back Office agent is not available in this environment.",
  }), [context, failure, loading, visible]);
  const engineSource = localSource ? { source: localSource } : {
    auth,
    connection: assistantConnection,
    defaultSession,
    environmentUid: context?.environmentUid ?? null,
    showsDefaultSession: !requestedSessionId,
  };
  return (
    <ChatEngineProvider
      {...engineSource}
      isVisible={visible && !loading && !failure}
      notify={notify}
      requestedSessionId={requestedSessionId}
      viewContext={viewContext}
      onRequestVisible={() => setOpen(true)}
      onRequestedSessionRemoved={() => { setRailSessionId(null); if (expanded) onNavigate("/agent"); }}
    >
      <AssistantSurfaces
        children={children}
        contextLabel={Object.keys(viewContext).length > 2 ? `Case context: ${Object.entries(viewContext).filter(([key]) => key !== "app" && key !== "section").map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join(" · ")}` : "Select a case to include its record references."}
        docked={docked} expanded={expanded} open={open} width={width}
        setWidth={setWidth} setOpen={setOpen} onNavigate={onNavigate}
        returnTo={returnTo.current} userUid={viewerUid}
        rememberSession={setRailSessionId}
        environmentUid={context?.environmentUid ?? null}
        loading={loading} failure={failure} onRetry={() => retry((value) => value + 1)}
        notice={notice} notify={notify} dismissNotice={() => setNotice(null)}
      />
    </ChatEngineProvider>
  );
}

function AssistantSurfaces({ children, contextLabel, docked, expanded, open, width, setWidth, setOpen, onNavigate, returnTo, userUid, environmentUid, rememberSession, loading, failure, onRetry, notice, notify, dismissNotice }: {
  children: ReactNode;
  contextLabel: string;
  docked: boolean;
  expanded: boolean;
  open: boolean;
  width: number;
  setWidth: (width: number) => void;
  setOpen: (open: boolean) => void;
  onNavigate: (path: string) => void;
  returnTo: string;
  userUid: string | null;
  environmentUid: string | null;
  rememberSession: (id: string | null) => void;
  loading: boolean;
  failure: string;
  onRetry: () => void;
  notice: ChatNotice | null;
  notify: (notice: ChatNotice) => void;
  dismissNotice: () => void;
}) {
  const engine = useChatEngine();
  const [providers, setProviders] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(false);
  const visible = expanded || open;
  useEffect(() => {
    if (visible && !wasVisible.current) {
      const timer = requestAnimationFrame(() => surface.current?.querySelector<HTMLElement>("button")?.focus());
      wasVisible.current = visible;
      return () => cancelAnimationFrame(timer);
    }
    if (!visible && wasVisible.current)
      document.querySelector<HTMLButtonElement>(".backoffice-assistant-launcher")?.focus();
    wasVisible.current = visible;
  }, [visible]);
  function close() {
    setProviders(false);
    setOpen(false);
  }
  function expand() {
    setOpen(false);
    onNavigate(`/agent${engine.currentSessionId ? `?session=${encodeURIComponent(engine.currentSessionId)}` : ""}`);
  }
  const conversation = (
    <div className="backoffice-assistant-body" ref={surface}>
      <p className="backoffice-assistant-context">{contextLabel}</p>
      {notice && <div className={`notice${notice.variant === "error" ? " error" : ""}`} role={notice.variant === "error" ? "alert" : "status"}>
        <strong>{notice.title}</strong>{notice.description && <p>{notice.description}</p>}
        <Button size="small" variant="ghost" onClick={dismissNotice}>Dismiss</Button>
      </div>}
      {failure ? <div className="backoffice-assistant-unavailable" role="status">
        <h2>Back Office assistant is unavailable</h2>
        <p>{failure}</p>
        <Button onClick={onRetry}>Retry assistant connection</Button>
      </div> : loading ? <div className="backoffice-assistant-unavailable" role="status">Connecting to the Back Office agent…</div> : providers ? <div className="backoffice-assistant-providers">
        <Button size="small" onClick={() => setProviders(false)}>Back to conversation</Button>
        <ModelProviderSettings auth={{ userUid }} connection={assistantConnection} notify={notify} organizationEnvironmentUid={environmentUid} />
      </div> : <ChatThread copy={copy} surface={expanded ? "page" : "overlay"} viewer={{ uid: userUid }} onOpenModelProviderSettings={engine.capabilities.modelProviderSettings ? () => setProviders(true) : undefined} />}
    </div>
  );
  return (
    <div className="backoffice-assistant-workspace" data-assistant-docked={open && docked && !expanded ? "true" : "false"}>
      <div className="backoffice-assistant-content">
        {expanded ? <div className="backoffice-assistant-page">
          <ChatPageLayout
            explorer={api.local || environmentUid ? { onOpenSession: (id) => onNavigate(`/agent${id ? `?session=${encodeURIComponent(id)}` : ""}`) } : null}
            onCreateSession={() => onNavigate("/agent")}
            onMinimize={() => { rememberSession(engine.currentSessionId); onNavigate(returnTo); setOpen(true); }}
          >{conversation}</ChatPageLayout>
        </div> : children}
      </div>
      {!expanded && (open ? <ChatRail
        title="Back Office assistant" subtitle="Ask about requirements and missing evidence"
        mode={docked ? "docked" : "overlay"} width={width} onWidthChange={setWidth}
        onClose={close} onExpand={expand} tone="accent"
      >{conversation}</ChatRail> : <ChatLauncher className="backoffice-assistant-launcher" label="Ask Back Office" onClick={() => setOpen(true)} />)}
    </div>
  );
}
