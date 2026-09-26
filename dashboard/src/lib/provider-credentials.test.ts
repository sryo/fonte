// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import { credentialsFromModels, credentialsPatch } from "./provider-credentials";
import { mergeSection } from "./settings-patch";

describe("credentialsFromModels", () => {
  it("reads every built-in credential, blank when unset", () => {
    expect(credentialsFromModels({ anthropic: { oauth_token: "tok" }, gemini: { api_key: "g" } })).toEqual({
      anthropic_oauth_token: "tok",
      anthropic_api_key: "",
      openai_api_key: "",
      gemini_api_key: "g",
    });
  });
});

describe("credentialsPatch", () => {
  it("touches only the committed credential", () => {
    expect(credentialsPatch({ anthropic_api_key: "key" })).toEqual({ anthropic: { api_key: "key" } });
    expect(credentialsPatch({ gemini_api_key: "g" })).toEqual({ gemini: { api_key: "g" } });
  });

  it("clears a credential emptied by the user", () => {
    expect(credentialsPatch({ anthropic_oauth_token: "" })).toEqual({ anthropic: { oauth_token: undefined } });
  });

  it("keeps a token saved just before an API key commit that was rendered from older settings", () => {
    const rendered = { provider: "anthropic", anthropic: {} };
    const afterToken = mergeSection(rendered, credentialsPatch({ anthropic_oauth_token: "tok" }));
    const afterKey = mergeSection(afterToken, credentialsPatch({ anthropic_api_key: "key" }));
    expect(afterKey).toEqual({ provider: "anthropic", anthropic: { oauth_token: "tok", api_key: "key" } });
  });
});
