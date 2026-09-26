// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import { agentFormError, agentsUsingProvider, cleanId, defaultModelFor, modelAfterProviderSwitch, providerFormError } from "./agent-form";

describe("cleanId", () => {
  it("matches the CLI, since @mentions are lowercased before routing", () => {
    expect(cleanId("My Agent!")).toBe("myagent");
    expect(cleanId("tv_bot-2")).toBe("tv_bot-2");
  });
});

describe("agentFormError", () => {
  const form = { id: "tv", name: "TV", provider: "anthropic", model: "sonnet" };

  it("accepts a complete form with a new id", () => {
    expect(agentFormError(form, ["fonte"])).toBeNull();
  });

  it("refuses an id that would silently replace an existing agent", () => {
    expect(agentFormError({ ...form, id: "fonte" }, ["fonte"])).toBe("An agent with id fonte already exists.");
  });

  it("asks for the missing fields", () => {
    expect(agentFormError({ ...form, model: " " }, [])).toBe("Id, name, and model are required.");
  });
});

describe("defaultModelFor", () => {
  it("names a model each built-in provider runs", () => {
    expect(defaultModelFor("anthropic", {})).toBe("sonnet");
    expect(defaultModelFor("openai", {})).toBe("gpt-5.3-codex");
    expect(defaultModelFor("gemini", {})).toBe("pro");
    expect(defaultModelFor("opencode", {})).toBe("sonnet");
  });

  it("uses a custom provider's own model", () => {
    const customs = { local: { name: "Local", harness: "codex" as const, base_url: "", api_key: "", model: "qwen" } };
    expect(defaultModelFor("custom:local", customs)).toBe("qwen");
    expect(defaultModelFor("custom:gone", customs)).toBe("");
  });
});

describe("modelAfterProviderSwitch", () => {
  it("follows the provider while the model is still the previous default", () => {
    expect(modelAfterProviderSwitch("anthropic", "openai", "sonnet", {})).toBe("gpt-5.3-codex");
  });

  it("keeps a model the user typed", () => {
    expect(modelAfterProviderSwitch("anthropic", "opencode", "opus", {})).toBe("opus");
  });
});

describe("agentsUsingProvider", () => {
  it("lists the agents that would break if the provider were deleted", () => {
    const agents = {
      fonte: { name: "Fonte", provider: "anthropic", model: "sonnet", working_directory: "" },
      local: { name: "Local", provider: "custom:ollama", model: "qwen", working_directory: "" },
    };
    expect(agentsUsingProvider(agents, "ollama")).toEqual(["local"]);
    expect(agentsUsingProvider(agents, "other")).toEqual([]);
  });
});

describe("providerFormError", () => {
  const form = { id: "ollama", name: "Ollama", base_url: "http://localhost:11434/v1", api_key: "k" };

  it("accepts a complete form with a new id", () => {
    expect(providerFormError(form, [])).toBeNull();
  });

  it("refuses an id that would silently replace an existing provider", () => {
    expect(providerFormError(form, ["ollama"])).toBe("A provider with id ollama already exists.");
  });

  it("asks for a base URL the harness can reach", () => {
    expect(providerFormError({ ...form, base_url: "localhost:11434" }, [])).toBe(
      "The base URL must start with http:// or https://."
    );
  });
});
