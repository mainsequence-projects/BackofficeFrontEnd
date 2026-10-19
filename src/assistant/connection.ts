import { createChatBackendConnection } from "@dev-mainsequence/command-center-ai";
import { api, ApiError } from "../api";

export interface AssistantContext {
  environmentUid: string;
  agentUid: string;
}

const uid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The host sends platform requests as the signed-in person. The local proxy is
// available only under Vite on loopback; neither path exposes a platform token.
export const assistantConnection = createChatBackendConnection({
  apiBaseUrl: location.origin,
  async sendPlatformRequest(request) {
    if (api.local) {
      const url = new URL(request.url);
      return fetch(new Request(`${location.origin}/__mainsequence__${url.pathname}${url.search}`, request));
    }
    if (!api.bridge) throw new Error("Reconnect Back Office through Command Center.");
    return api.bridge.sendPlatformRequest(request);
  },
});

export async function loadAssistantContext(signal: AbortSignal) {
  let context: AssistantContext;
  try {
    context = await api.get<AssistantContext>("/assistant/context", signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404)
      throw new Error("The Back Office agent is not available yet. Try again after it has been deployed.");
    throw error;
  }
  if (!uid.test(context.environmentUid ?? "") || !uid.test(context.agentUid ?? ""))
    throw new Error("The Back Office agent is not configured for this environment.");
  return context;
}

export async function assistantViewer(userUid: string, signal: AbortSignal) {
  if (!api.local) return userUid;
  const response = await fetch("/__mainsequence__/api/v1/users/me/", { signal });
  if (!response.ok) throw new Error("Sign in to Main Sequence on this machine to use the assistant.");
  const user = await response.json();
  if (!uid.test(user.uid ?? "") || user.uid !== userUid)
    throw new Error("The assistant and Back Office must use the same signed-in account.");
  return user.uid as string;
}
