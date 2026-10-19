import { useEffect, useRef, useState } from "react";
import { createStaticSiteIframeClient } from "@dev-mainsequence/command-center-sdk/embed";
import {
  ApplicationNavigationPanelShell,
  defineNavigationApplication,
} from "@dev-mainsequence/command-center-sdk/navigation";
import { ApplicationStatusScreen } from "@dev-mainsequence/command-center-sdk/feedback";
import {
  applyThemePresetToRoot,
  resolveCommandCenterThemeById,
  mainSequenceTheme,
  quartzLightTheme,
} from "@dev-mainsequence/command-center-sdk/theme";
import { api, ApiError, errorText, type Catalog } from "./api";
import {
  People,
  PersonPage,
  Documents,
  DocumentPage,
  DocumentSets,
  Reconciliation,
} from "./pages";

const destinations = [
  {
    id: "persons",
    label: "People",
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
];
const navigation = defineNavigationApplication({
  id: "backoffice",
  label: "Back Office",
  defaultDestinationId: "persons",
  subApplications: [{ id: "casework", label: "Back Office", destinations }],
});
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
              types: types.items,
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
        ) ?? mainSequenceTheme;
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
              : mainSequenceTheme),
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
  const [section = "persons", uid] = url.pathname.slice(1).split("/");
  const tab = url.searchParams.get("tab") ?? undefined;
  const page =
    section === "persons" ? (
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
        />
      )
    ) : section === "document-sets" ? (
      <DocumentSets catalog={catalog} selected={uid} />
    ) : section === "reconciliation" ? (
      <Reconciliation
        catalog={catalog}
        personUid={url.searchParams.get("person") ?? ""}
        evaluationUid={url.searchParams.get("evaluation") ?? ""}
      />
    ) : (
      <People />
    );
  return (
    <ApplicationNavigationPanelShell
      application={navigation}
      activeDestinationId={
        destinations.some((d) => d.id === section) ? section : "persons"
      }
      menuOpen={menu}
      onMenuOpenChange={setMenu}
      onNavigate={(intent) => navigate(`/${intent.destinationId}`)}
      presentation="auto"
    >
      {page}
    </ApplicationNavigationPanelShell>
  );
}
