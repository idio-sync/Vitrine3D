# Collections Browser — Design Document

**Date:** 2026-03-09
**Status:** Approved

## Problem

The "Browse Library" button in the Tauri desktop app requires Cloudflare Access authentication to reach the `/api/archives` endpoint. Auth is difficult to implement inside a Tauri webview. The result is a broken flow.

## Solution

Replace the auth-gated Library page with a public-only Collections browser. `/api/collections` and `/api/collections/:slug` are already marked public in `meta-server.js` — no server changes needed. The new browser shows the same editorial UI but scoped to collections only.

## Approach

**Option A chosen: new `collections-browser.ts` module**

A self-contained module managing a 4-level navigation state machine. Replaces the `showLibraryInApp()` / `returnToLibrary()` block in `kiosk-main.ts`. `library-page.ts` is left untouched (still serves the web `/library` route).

## Navigation Stack

```
[file picker] → [collections list] → [collection detail] → [archive viewer]
   (close btn)    (← Collections)      (← Collection Name)
```

- Levels 1–2 render inside a `#collections-browser` overlay container
- Level 3 (viewer): browser container hides, `#app` shows; existing `#kiosk-back-library` button relabeled to `← [Collection Name]`

## State Machine

```typescript
type BrowserView =
  | { kind: 'collections' }
  | { kind: 'collection'; slug: string; name: string }
```

The viewer is not a browser state — transitioning to the viewer hands control back to kiosk-main's existing load path.

## Public API

```typescript
interface CollectionsBrowserOpts {
    loadArchiveFromUrl: (url: string) => void;  // existing kiosk-main function
    libraryBaseUrl: string;                      // VITE_APP_LIBRARY_URL
    backButtonEl: HTMLElement;                   // #kiosk-back-library
}

export function initCollectionsBrowser(opts: CollectionsBrowserOpts): void;
export async function showCollectionsBrowser(): Promise<void>;
```

`initCollectionsBrowser()` is called once during kiosk init. `showCollectionsBrowser()` is called by the "Browse Library" button click handler — no auth check, no browser redirect.

## API Calls

Both plain `fetch()`, no auth. `libraryBaseUrl` is prepended for relative paths.

| Endpoint | Used for |
|---|---|
| `GET {libraryBaseUrl}/api/collections` | Collections list |
| `GET {libraryBaseUrl}/api/collections/:slug` | Collection detail + archives |

Last-fetched collection response is cached in module state so returning from the viewer skips a redundant fetch.

## UI

**Collections list (Level 1)**
- Editorial header: gold spine, logo, eyebrow "Collections", title "Browse Collections", gold rule, collection count
- Grid of `lp-coll-card` style cards: thumbnail, name, description, "N Archives" badge
- "← Main Menu" button returns to file picker

**Collection detail (Level 2)**
- Header updates in-place: eyebrow "Collection", title = collection name, archive count
- "← Collections" back button replaces "← Main Menu"
- Archive grid uses existing `cp-card` poster style (full-bleed, vignette, play button, title overlay, asset type pills)

**Archive viewer (Level 3)**
- `#kiosk-back-library` button relabeled `← [Collection Name]`
- Click returns to collection detail view (Level 2), not collections list

## Visual Distinction

| Collections list | Collection detail |
|---|---|
| `lp-coll-card` — structured card with info rows | `cp-card` — immersive poster, image-first |
| Thumbnail, name, description, count badge | Full-bleed thumbnail, vignette, play button overlay |

## Style Reuse

- `injectStyles()` + `renderCard()` + helpers (`escapeHtml`, `formatBytes`, `formatDate`, `ASSET_LABELS`, `getLogoSrc`) imported from `collection-page.ts`
- `lp-coll-*` CSS (~80 lines) copied from `library-page.ts` into `collections-browser.ts`
- `CollectionArchive` type imported from `collection-page.ts`

## Error Handling

| Scenario | Behavior |
|---|---|
| No collections | "No collections available." empty state |
| Empty collection | "This collection is empty." |
| Collections fetch fails | Error message + "Try again" button |
| Collection detail fetch fails | In-place error, "← Collections" still accessible |
| Loading | Spinner in grid area; header renders immediately |

## Files Changed

| File | Change |
|---|---|
| `src/modules/collections-browser.ts` | **New** — full module |
| `src/modules/kiosk-main.ts` | Replace `showLibraryInApp` / `returnToLibrary` block; call `initCollectionsBrowser` + `showCollectionsBrowser` |
| `library-page.ts` | Untouched |
| `meta-server.js` | Untouched |
| `src/index.html` | No change |
