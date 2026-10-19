import { useEffect, useRef, useState } from "react";
import { createStaticSiteIframeClient } from "@dev-mainsequence/command-center-sdk/embed";
import {
  ApplicationNavigationPanelShell,
  defineNavigationApplication,
} from "@dev-mainsequence/command-center-sdk/navigation";
import { ApplicationStatusScreen } from "@dev-mainsequence/command-center-sdk/feedback";
import { Button } from "@dev-mainsequence/command-center-sdk/controls";
import {
  applyThemePresetToRoot,
  resolveCommandCenterThemeById,
  mainSequenceSpaceTheme,
  quartzLightTheme,
} from "@dev-mainsequence/command-center-sdk/theme";
import { api, ApiError, errorText, latestDocumentTypes, type Catalog } from "./api";
import { AssistantWorkspace } from "./assistant/Assistant";
import { CaseQueue, CaseWorkspace } from "./CaseDashboard";
import { Admin } from "./Admin";
import { DropFiles } from "./DropFiles";
import {
  People,
  PersonPage,
  Documents,
  DocumentPage,
  DocumentSets,
  Reconciliation,
} from "./pages";

const destinations = [
  { id: "drop-files", label: "Drop files", href: "/drop-files", description: "Upload documents and allocate them to every eligible case" },
  { id: "queue", label: "Cases", href: "/queue", description: "Review queue, subjects and assigned staff" },
  {
    id: "persons",
    label: "Subjects",
    href: "/persons",
    description: "Reference profiles and document cases",
  },
  {
    id: "documents",
    label: "Documents",
    href: "/documents",
    description: "Source evidence, attributes and reviews",
  },
  {
    id: "document-sets",
    label: "Document Sets",
    href: "/document-sets",
    description: "Published evidence requirements",
  },
  {
    id: "reconciliation",
    label: "Reconciliation",
    href: "/reconciliation",
    description: "Coverage, findings and next actions",
  },
  {
    id: "agent",
    label: "Agent",
    href: "/agent",
    description: "Ask the Back Office assistant about a case",
  },
  { id: "admin", label: "Admin", href: "/admin", description: "Document parsing and acceptance settings" },
];
function applicationNavigation(isAdmin: boolean) { return defineNavigationApplication({
  id: "backoffice",
  label: "Back Office",
  defaultDestinationId: "queue",
  subApplications: [{ id: "casework", label: "Back Office", destinations: destinations.filter((item) => item.id !== "admin" || isAdmin) }],
}); }
const connectionMessages: Record<string, string> = {
  idle: "Waiting for Command Center to connect.",
  authorizing: "Authorizing the secure application connection.",
  "runtime-starting": "The document service is starting.",
  ready: "Checking business services and the document catalog.",
  expired: "Refreshing the secure application connection.",
  "authentication-failed": "Sign in to Command Center again to continue.",
  forbidden: "Your account does not have access to this application.",
  "missing-route": "The requested application route is unavailable.",
  transient: "The service is temporarily busy. Retrying the connection.",
  cancelled: "The connection request was cancelled.",
  unavailable: "The document service is unavailable. Retry startup.",
  unsupported: "Open Back Office from its Command Center navigation link.",
  invalid: "The application connection configuration needs attention.",
};
export function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [failure, setFailure] = useState("");
  const [phase, setPhase] = useState(0);
  const [attempt, retry] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState(
    "Connecting securely and checking document services.",
  );
  const [path, setPath] = useState(location.pathname + location.search);
  const [menu, setMenu] = useState(false);
  const identity = useRef<string | null>(null);
  useEffect(() => {
    const changed = () => setPath(location.pathname + location.search);
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(undefined);
    setFailure("");
    setPhase(0);
    setRetrying(false);
    setConnectionMessage("Connecting securely and checking document services.");
    let started = false;
    const signal = controller.signal;
    const start = async () => {
      if (started || signal.aborted) return;
      started = true;
      const attempts = api.local ? 3 : 1;
      for (let n = 0; n < attempts && !signal.aborted; n++) {
        try {
          const requestSignal = api.local
            ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
            : signal;
          setPhase(1);
          const viewer = await api.get("/me", requestSignal);
          if (identity.current && viewer.user_uid !== identity.current)
            throw new Error(
              "Your signed-in identity changed. Reopen Back Office.",
            );
          setPhase(2);
          const ready = await api.get("/readyz", requestSignal);
          if (ready.status !== "ready")
            throw new Error("The business service is not ready.");
          const [types, personSchema, sets] = await Promise.all([
            api.get("/document-types", requestSignal),
            api.get("/person-schema", requestSignal),
            api.get("/document-sets", requestSignal),
          ]);
          if (!signal.aborted) {
            setCatalog({
              viewer: viewer as Catalog["viewer"],
              personSchema,
              types: latestDocumentTypes(types.items),
              sets: sets.items,
            });
            setPhase(3);
            setRetrying(false);
          }
          return;
        } catch (error) {
          if (signal.aborted) return;
          if (
            n === attempts - 1 ||
            (error instanceof ApiError && error.status < 500)
          ) {
            setFailure(errorText(error));
            return;
          }
          setRetrying(true);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, (n + 1) * 800);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        }
      }
    };
    if (api.local) {
      const theme =
        resolveCommandCenterThemeById(
          new URLSearchParams(location.search).get("theme") ?? "",
        ) ?? mainSequenceSpaceTheme;
      applyThemePresetToRoot(document.documentElement, { theme });
      identity.current = null;
      void start();
      return () => controller.abort();
    }
    const hostOrigin = import.meta.env.VITE_COMMAND_CENTER_ORIGIN;
    if (
      !hostOrigin ||
      window.parent === window ||
      !import.meta.env.VITE_BACKOFFICE_API_RELEASE_UID
    ) {
      setFailure(
        "Open Back Office from Command Center. This page needs its trusted application connection.",
      );
      return () => controller.abort();
    }
    const bridge = createStaticSiteIframeClient({
      channel: "mainsequence.backoffice",
      hostOrigin,
      parentWindow: window.parent,
      onContext(context) {
        applyThemePresetToRoot(document.documentElement, {
          theme:
            resolveCommandCenterThemeById(context.themeId) ??
            (context.themeMode === "light"
              ? quartzLightTheme
              : mainSequenceSpaceTheme),
        });
        if (started && context.userUid !== identity.current) {
          identity.current = context.userUid;
          retry((v) => v + 1);
          return;
        }
        identity.current = context.userUid;
        if (!context.userUid) {
          setCatalog(undefined);
          setFailure("Sign in to Command Center to open Back Office.");
          return;
        }
        void start();
      },
      onFastApiStateChange(state) {
        setConnectionMessage(connectionMessages[state.status]);
        setRetrying(
          ["transient", "runtime-starting", "expired"].includes(state.status),
        );
        if (
          ["authentication-failed", "forbidden", "unsupported"].includes(
            state.status,
          )
        ) {
          setCatalog(undefined);
          setFailure(connectionMessages[state.status]);
        }
      },
      onProtocolError(message) {
        setCatalog(undefined);
        setFailure(message);
      },
    });
    api.bridge = bridge;
    const receive = (event: MessageEvent) => bridge.handleMessage(event);
    window.addEventListener("message", receive);
    bridge.announceReady();
    const timeout = setTimeout(() => {
      if (!started)
        setFailure(
          "Command Center did not initialize this application. Reopen it from the navigation menu.",
        );
    }, 15000);
    return () => {
      controller.abort();
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      bridge.dispose();
      api.bridge = undefined;
    };
  }, [attempt]);
  if (!catalog)
    return (
      <ApplicationStatusScreen
        variant="viewport"
        state={failure ? "error" : retrying ? "retrying" : "loading"}
        eyebrow="Back Office"
        title={
          failure ? "Back Office could not start" : "Preparing your workspace"
        }
        message={failure || connectionMessage}
        action={
          failure
            ? { label: "Retry startup", onSelect: () => retry((v) => v + 1) }
            : undefined
        }
        stages={[
          "Command Center context",
          "Authorized API connection",
          "Business services and document catalog",
        ].map((label, i) => ({
          id: String(i),
          label,
          status:
            phase > i
              ? "complete"
              : phase === i
                ? failure
                  ? "error"
                  : "active"
                : "pending",
        }))}
      />
    );
  const url = new URL(path, location.origin);
  const [section = "queue", uid] = url.pathname.slice(1).split("/").filter(Boolean);
  const tab = url.searchParams.get("tab") ?? undefined;
  const allowedDestinations = destinations.filter((item) => item.id !== "admin" || catalog.viewer.is_organization_admin === true);
  const page =
    section === "drop-files" ? (
      <DropFiles userUid={catalog.viewer.user_uid} />
    ) : section === "queue" ? (
      <CaseQueue catalog={catalog} />
    ) : section === "review" && uid ? (
      <CaseWorkspace key={uid} uid={uid} catalog={catalog} runUid={url.searchParams.get("run") ?? ""} report={url.searchParams.get("view") === "report"} />
    ) : section === "persons" ? (
      uid ? (
        <PersonPage key={uid} uid={uid} tab={tab} catalog={catalog} />
      ) : (
        <People />
      )
    ) : section === "documents" ? (
      uid ? (
        <DocumentPage
          key={`${uid}:${url.searchParams.get("revision") ?? "latest"}`}
          uid={uid}
          tab={tab}
          revision={url.searchParams.get("revision") ?? undefined}
          catalog={catalog}
        />
      ) : (
        <Documents
          catalog={catalog}
          personUid={url.searchParams.get("person") ?? ""}
          runUid={url.searchParams.get("run") ?? ""}
        />
      )
    ) : section === "document-sets" ? (
      <DocumentSets catalog={catalog} selected={uid} version={url.searchParams.get("version") ?? undefined} />
    ) : section === "reconciliation" ? (
      <Reconciliation
        catalog={catalog}
        personUid={url.searchParams.get("person") ?? ""}
        evaluationUid={url.searchParams.get("evaluation") ?? ""}
        runUid={url.searchParams.get("run") ?? ""}
        requestedAssignment={url.searchParams.get("assignment") ?? ""}
      />
    ) : section === "admin" ? (
      <Admin viewer={catalog.viewer} types={catalog.types} />
    ) : (
      <People />
    );
  return (
    <ApplicationNavigationPanelShell
      application={applicationNavigation(catalog.viewer.is_organization_admin === true)}
      activeDestinationId={
        section === "review" ? "queue" : allowedDestinations.some((d) => d.id === section) ? section : "queue"
      }
      menuOpen={menu}
      onMenuOpenChange={setMenu}
      onNavigate={(intent) => navigate(`/${intent.destinationId}`)}
      panelClassName="backoffice-navigation"
      renderDestinationTrailing={({ destination }) =>
        destination.id === allowedDestinations[allowedDestinations.length - 1].id ? (
          <div className="documentation-footer">
            <Button
              iconOnly
              variant="ghost"
              aria-label="Documentation"
              title="Documentation"
              onClick={() => location.assign("/docs/")}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <path d="M12 5.5C9.5 3.7 6 3.7 3 5v14c3-1.3 6.5-1.3 9 .5 2.5-1.8 6-1.8 9-.5V5c-3-1.3-6.5-1.3-9 .5Z" />
                <path d="M12 5.5v14" />
              </svg>
            </Button>
          </div>
        ) : null
      }
      presentation="auto"
    >
      <AssistantWorkspace path={path} userUid={catalog.viewer.user_uid} onNavigate={navigate}>
        {page}
      </AssistantWorkspace>
    </ApplicationNavigationPanelShell>
  );
}
