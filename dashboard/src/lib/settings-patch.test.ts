// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import { REDACTED, mergeSection, rawJsonPatch, redactSecrets, restoreSecrets } from "./settings-patch";

describe("mergeSection", () => {
  it("keeps sibling secrets when two credential commits land one after the other", () => {
    const saved = { provider: "anthropic", anthropic: { oauth_token: "tok" } };
    const afterFirst = mergeSection(saved, { anthropic: { api_key: "key" } });
    const afterSecond = mergeSection(afterFirst, { openai: { api_key: "oai" } });
    expect(afterSecond).toEqual({
      provider: "anthropic",
      anthropic: { oauth_token: "tok", api_key: "key" },
      openai: { api_key: "oai" },
    });
  });

  it("drops a key whose patched value is undefined", () => {
    expect(mergeSection({ anthropic: { oauth_token: "tok", api_key: "key" } }, { anthropic: { oauth_token: undefined } }))
      .toEqual({ anthropic: { api_key: "key" } });
  });

  it("replaces arrays and primitives wholesale", () => {
    expect(mergeSection({ target_languages: ["en", "es"], enabled: true }, { target_languages: ["fr"], enabled: false }))
      .toEqual({ target_languages: ["fr"], enabled: false });
  });

  it("starts from nothing when the section is missing", () => {
    expect(mergeSection(undefined, { anthropic: { api_key: "key" } })).toEqual({ anthropic: { api_key: "key" } });
  });
});

describe("redactSecrets", () => {
  it("hides tokens and keys at any depth, including custom providers", () => {
    expect(
      redactSecrets({
        models: { anthropic: { oauth_token: "tok", model: "sonnet" } },
        custom_providers: { local: { api_key: "k", base_url: "http://x" } },
        watchlist: { jackett_api_key: "" },
      })
    ).toEqual({
      models: { anthropic: { oauth_token: REDACTED, model: "sonnet" } },
      custom_providers: { local: { api_key: REDACTED, base_url: "http://x" } },
      watchlist: { jackett_api_key: "" },
    });
  });
});

describe("restoreSecrets", () => {
  const live = {
    models: { anthropic: { oauth_token: "tok" } },
    custom_providers: { local: { api_key: "k", name: "Local" } },
  };

  it("puts saved values back behind untouched placeholders", () => {
    expect(restoreSecrets(redactSecrets(live), live)).toEqual({ value: live, unresolved: [] });
  });

  it("keeps a newly typed secret", () => {
    const edited = { models: { anthropic: { oauth_token: "new" } } };
    expect(restoreSecrets(edited, live).value).toEqual(edited);
  });

  it("reports a placeholder with nothing saved behind it instead of dropping the key", () => {
    const edited = { custom_providers: { renamed: { api_key: REDACTED, name: "Local" } } };
    expect(restoreSecrets(edited, live).unresolved).toEqual(["custom_providers.renamed.api_key"]);
  });
});

describe("rawJsonPatch", () => {
  const baseline = {
    watchlist: { preferred_quality: "1080p" },
    models: { anthropic: { oauth_token: REDACTED } },
    notifications: { enabled: false },
  };

  it("sends only the sections the user edited", () => {
    const edited = { ...baseline, notifications: { enabled: true } };
    expect(rawJsonPatch(edited, baseline)).toEqual({
      patch: { notifications: { enabled: true } },
      removed: [],
    });
  });

  it("names sections deleted from the text, which a save cannot remove", () => {
    const { watchlist: _dropped, ...edited } = baseline;
    void _dropped;
    expect(rawJsonPatch(edited, baseline)).toEqual({ patch: {}, removed: ["watchlist"] });
  });

  it("sends a section the user added", () => {
    const edited = { ...baseline, libraries: { Movies: "/m" } };
    expect(rawJsonPatch(edited, baseline).patch).toEqual({ libraries: { Movies: "/m" } });
  });

  it("treats key order inside a section as no change", () => {
    const b = { torrent: { dht: true, port: 1 } };
    expect(rawJsonPatch({ torrent: { port: 1, dht: true } }, b).patch).toEqual({});
  });
});
