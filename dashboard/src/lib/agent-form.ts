import type { AgentConfig, CustomProvider } from "./api";

const BUILTIN_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "sonnet",
  openai: "gpt-5.3-codex",
  gemini: "pro",
  opencode: "sonnet",
};

export const cleanId = (input: string) => input.toLowerCase().replace(/[^a-z0-9_-]/g, "");

export function agentFormError(
  form: { id: string; name: string; model: string },
  existingIds: string[]
): string | null {
  if (!form.id.trim() || !form.name.trim() || !form.model.trim()) return "Id, name, and model are required.";
  if (existingIds.includes(form.id)) return `An agent with id ${form.id} already exists.`;
  return null;
}

export function defaultModelFor(provider: string, customs: Record<string, CustomProvider>): string {
  if (provider.startsWith("custom:")) return customs[provider.slice("custom:".length)]?.model ?? "";
  return BUILTIN_DEFAULT_MODELS[provider] ?? "";
}

export function modelAfterProviderSwitch(
  prev: string,
  next: string,
  model: string,
  customs: Record<string, CustomProvider>
): string {
  return model === defaultModelFor(prev, customs) ? defaultModelFor(next, customs) : model;
}

export function agentsUsingProvider(agents: Record<string, AgentConfig>, providerId: string): string[] {
  return Object.entries(agents)
    .filter(([, a]) => a.provider === `custom:${providerId}`)
    .map(([id]) => id);
}

export function providerFormError(
  form: { id: string; name: string; base_url: string; api_key: string },
  existingIds: string[]
): string | null {
  if (!form.id.trim() || !form.name.trim() || !form.base_url.trim() || !form.api_key.trim()) {
    return "Id, name, base URL, and API key are required.";
  }
  if (existingIds.includes(form.id)) return `A provider with id ${form.id} already exists.`;
  if (!/^https?:\/\//i.test(form.base_url.trim())) return "The base URL must start with http:// or https://.";
  return null;
}
