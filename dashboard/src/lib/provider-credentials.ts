import type { Settings } from "./api";

type Models = NonNullable<Settings["models"]>;

export interface Credentials {
  anthropic_oauth_token: string;
  anthropic_api_key: string;
  openai_api_key: string;
  gemini_api_key: string;
}

const LOCATIONS: Record<keyof Credentials, [provider: string, field: string]> = {
  anthropic_oauth_token: ["anthropic", "oauth_token"],
  anthropic_api_key: ["anthropic", "api_key"],
  openai_api_key: ["openai", "api_key"],
  gemini_api_key: ["gemini", "api_key"],
};

export const credentialsFromModels = (m?: Models): Credentials => ({
  anthropic_oauth_token: m?.anthropic?.oauth_token ?? "",
  anthropic_api_key: m?.anthropic?.api_key ?? "",
  openai_api_key: m?.openai?.api_key ?? "",
  gemini_api_key: m?.gemini?.api_key ?? "",
});

/** The nested models patch for committed credentials; blank clears. */
export function credentialsPatch(patch: Partial<Credentials>): Record<string, Record<string, string | undefined>> {
  const out: Record<string, Record<string, string | undefined>> = {};
  for (const [key, value] of Object.entries(patch) as [keyof Credentials, string | undefined][]) {
    if (value === undefined) continue;
    const [provider, field] = LOCATIONS[key];
    out[provider] = { ...out[provider], [field]: value || undefined };
  }
  return out;
}
