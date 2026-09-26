const SECRET_KEY_RE = /(api_key|oauth_token|token)$/i;
export const REDACTED = "__REDACTED__";

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merge a field patch into a settings section: objects merge, arrays
    and primitives replace, undefined deletes the key. */
export function mergeSection(current: unknown, patch: Json): Json {
  const out: Json = isPlainObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete out[key];
    else if (isPlainObject(value)) out[key] = mergeSection(out[key], value);
    else out[key] = value;
  }
  return out;
}

/** Replace secret-shaped string leaves so the Advanced editor never renders
    keys in plaintext. */
export function redactSecrets(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(redactSecrets);
  if (!isPlainObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] =
      SECRET_KEY_RE.test(key) && typeof value === "string" && value !== ""
        ? REDACTED
        : redactSecrets(value);
  }
  return out;
}

/** Swap untouched placeholders back for the saved secret at the same path.
    Placeholders with nothing saved behind them are reported, not dropped. */
export function restoreSecrets(node: unknown, source: unknown): { value: unknown; unresolved: string[] } {
  const unresolved: string[] = [];
  const walk = (n: unknown, src: unknown, path: string): unknown => {
    if (Array.isArray(n)) return n.map((v, i) => walk(v, Array.isArray(src) ? src[i] : undefined, `${path}[${i}]`));
    if (!isPlainObject(n)) return n;
    const from = isPlainObject(src) ? src : {};
    const out: Json = {};
    for (const [key, value] of Object.entries(n)) {
      const at = path ? `${path}.${key}` : key;
      if (value === REDACTED) {
        if (typeof from[key] === "string") out[key] = from[key];
        else unresolved.push(at);
      } else {
        out[key] = walk(value, from[key], at);
      }
    }
    return out;
  };
  return { value: walk(node, source, ""), unresolved };
}

function canonical(node: unknown): string {
  if (Array.isArray(node)) return `[${node.map(canonical).join(",")}]`;
  if (!isPlainObject(node)) return JSON.stringify(node) ?? "undefined";
  return `{${Object.keys(node)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(node[k])}`)
    .join(",")}}`;
}

/** Top-level sections the raw editor changed relative to the text it was
    loaded with, so an unrelated stale section can't overwrite a newer save. */
export function rawJsonPatch(edited: Json, baseline: Json): { patch: Json; removed: string[] } {
  const patch: Json = {};
  for (const [key, value] of Object.entries(edited)) {
    if (!(key in baseline) || canonical(value) !== canonical(baseline[key])) patch[key] = value;
  }
  const removed = Object.keys(baseline).filter((key) => !(key in edited));
  return { patch, removed };
}
