# Progress & status UI conventions

How Fonte shows "how far along is this." Two idioms, a handful of rules. This
doc is the intent; the source is the reference for exact signatures.

- Bar — [`progress-bar.tsx`](./progress-bar.tsx) (`ProgressBar`, `toPct`)
- Ring — [`../home/progress-ring.tsx`](../home/progress-ring.tsx) (`ProgressRing`)
- Aggregate strip — [`../status-strip.tsx`](../status-strip.tsx)
- Color tokens — `DomainColor` in [`../../lib/utils.ts`](../../lib/utils.ts),
  values in [`../../app/globals.css`](../../app/globals.css)

## Two idioms

**`ProgressBar`** — a filled horizontal bar. Use it wherever there's room for a
bar: the torrent detail page (overall + per-file), the bottom status strip.

**`ProgressRing`** — paints a card's own border as a progress arc. Use it on
poster cards where there's no room for a bar. It self-hides at 100% and has a
`busy` mode for indeterminate "working…" states (watchlist search, automation
run).

Reach for the ring only when a bar won't fit. Everything else is a bar. "Won't
fit" includes rounded-corner surfaces where a straight bar's ends get cropped by
the radius — that's why the home cards and their collapsed mini tiles ring their
borders instead. The ring's scale comes from a modifier class, not call-site
sizing: `progress-ring--mini` (3px, flush) for the 40px tiles, the default
(8px, flush) for cards.

A **full ring** marks a state that awaits or continues, in the domain's color:
green = seeding (live upload), watchlist purple = new results found and not yet
reviewed — it stays until the user opens the entry, which clears it.

## Ranked weights: pick a `variant`, don't hand-size

A bar's prominence comes from its `variant`, not from ad-hoc `h-*`/`rounded-*`
strings at the call site. Three ranked presets, heights `3 : 6 : 14`:

| `variant`  | Height | Shape                        | Use for                          |
| ---------- | ------ | ---------------------------- | -------------------------------- |
| `ambient`  | 3px    | square, full-bleed           | the always-on aggregate rail (status strip) |
| `list`     | 6px    | rounded pill                 | dense list rows (per-file)       |
| `hero`     | 14px   | rounded pill                 | the primary indicator (torrent detail) |

Hierarchy is **size**, never color. All three stay torrent-blue. `ambient`
is deliberately square and edge-to-edge (a system rail, like a browser load bar);
a pill there would read as a detached widget. Pass only layout classes
(`w-full`, `flex-1`) via `className`; the variant owns height and radius.

## Percent is derived once

`toPct(value)` clamps a 0–1 fraction to a whole 0–100. Use it for **both** the
bar width and any adjacent `42%` label so they can never disagree. Don't hand-roll
`Math.round(x * 100)` — that's the drift `toPct` exists to prevent.

## Color: blue in progress, green when done

`DomainColor` is `torrent` (blue) · `watchlist` (purple) · `automation` (orange) —
one hue per activity domain. Domain color earns its keep on the **home cards**,
where the three activity types sit side by side and need to be told apart. A bar
is never in that situation: every bar represents torrent *download* progress, so
`torrent` is the default and the only domain color a bar should use.

`done` is the one sanctioned state color: pass it and the fill turns green
(`--done`), overriding the blue, because a full blue bar reads as "still working"
when it's actually finished. That's the **only** status the bar recolors — every
other state (paused, error, checking…) stays blue and is carried by the status
**badge** above the bar, so status isn't double-encoded.

What counts as "done" is per-surface — pass what's most meaningful:

| Surface      | done when                                  |
| ------------ | ------------------------------------------ |
| Torrent main | `status === "completed" \|\| "seeding"`    |
| Per-file     | `file.progress >= 1`                       |
| Status strip | `aggregateProgress >= 100`                 |

Note the torrent bar keys off **status**, not fullness — a torrent marked
complete with some files deselected sits below 100% but is still done, and should
be green. `done` also suppresses the shine (a finished bar isn't transferring).

One exception for dense **list rows** (the file tree): once a row is done its
bar disappears entirely, replaced by a small green `Check` — a finished file is
a fact, not a process, and a wall of full green bars buries the rows that are
still moving. Persistent surfaces (hero, status strip) keep the green bar; they
must hold their place either way.

The `color` prop stays on the primitive for reuse — but don't pass a non-`torrent`
domain color to a bar unless it genuinely represents that domain's activity. None
do now.

## Shine means active transfer

The sweeping highlight (bar) / rotating gleam (ring) signals **data is actively
moving right now**. Turn it on when something is transferring; leave it off when
it isn't — paused, complete, stalled, or idle.

The current call sites are just that rule applied to each spot's "is it moving"
signal:

| Surface      | shine when                                          |
| ------------ | --------------------------------------------------- |
| Torrent main | `status === "downloading"`                          |
| Per-file     | `downloading && file.selected && file.progress < 1` |
| Status strip | `downloadSpeed > 0`                                 |

A new bar should follow the same rule, not copy whichever boolean is nearest.

Bar and ring share the `--ring-shine` token, so they stay in visual sync. Both
shines are disabled under `prefers-reduced-motion`.

## Stalled means faded + still

Pass `stalled` when a download has frozen (`downloading && numPeers === 0`). The
bar drops its fill to 50% opacity **and** suppresses the shine, so `active =
saturated + moving` reads instantly against `stalled = faded + still` at any
height. Don't fold the stall check into `shine` — pass `stalled` and let the
primitive do both. This mirrors the ring's stalled state (0.35 opacity), one
mechanism across both idioms.

## Accessibility contract

- **Bars** are `role="progressbar"` with `aria-valuenow/min/max` and a `label`.
  Always pass a meaningful `label` (e.g. `` `${file.name}: ${pct}%` ``).
- **The ring is `aria-hidden`** — decorative. It relies on adjacent text (a card
  title, a `%` badge) to carry the value. Never place a ring where nothing nearby
  announces its progress, or that state becomes invisible to screen readers.

## Open questions

- **Ring shine color.** The ring's determinate sweep is gold (`--ring-shine`)
  while its indeterminate sweep uses the domain color — deliberately deferred, not
  yet unified. Decide before adding more ring variants.
- **CLI bar excluded.** `packages/cli/src/torrent.ts` has its own ASCII bar. It's
  a manual, one-shot terminal surface (`fonte torrent list`/`status`) and is
  intentionally out of scope for these conventions.
