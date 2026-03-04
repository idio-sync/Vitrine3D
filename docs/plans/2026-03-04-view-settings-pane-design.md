# View Settings Pane — Design

**Date**: 2026-03-04
**Status**: Approved

## Summary

Consolidate the **Scene pane** and **Default View metadata tab** into a single **View Settings** tool rail button. Clearly separate archived defaults (saved to `.a3d/.a3z`) from editor-only preview settings (session-only).

## Motivation

- Default View settings are buried inside metadata edit mode — hard to discover
- Scene pane and Default View both touch background color — confusing overlap
- No clear visual signal distinguishing "saved to archive" vs "editor-only" settings

## Tool Rail Change

- **New button**: "View Settings" (`V` hotkey), positioned in the Narrate zone between Capture and Metadata
- **Removed**: Scene button (previously `S` hotkey) — absorbed into View Settings

## Pane Structure: `pane-view-settings`

### Section 1: Archive Defaults (accent left border)

Saved to `.a3d/.a3z` archives.

| Subsection | Controls | Origin |
|---|---|---|
| Background | Scene-wide color picker + preset swatches | Scene pane |
| Background Overrides | Mesh bg color, Splat bg color (checkbox + picker each) | Default View tab |
| Display Mode | Default asset view dropdown, Default matcap dropdown | Default View tab |
| Mesh Rendering | Single-sided toggle | Default View tab |
| Opening Camera | "Save Current View" / "Clear" buttons | Default View tab |
| Camera Constraints | Lock orbit, Lock distance, Keep above ground toggles | Default View tab |

### Section 2: Editor Preview (no accent border)

Session-only — not saved to archives.

| Subsection | Controls | Origin |
|---|---|---|
| Camera | FOV slider, Auto-rotate toggle, Show grid toggle, Fly mode toggle | Scene pane |
| Lighting | 4 sliders (ambient, key, fill, rim) | Scene pane |
| Tone Mapping | Exposure slider, Method dropdown | Scene pane |
| Environment IBL | Preset selector dropdown | Scene pane |

## Removals

- **Scene pane** (`pane-scene`): Entirely removed, all sections migrated to View Settings
- **Default View tab** (`edit-tab-viewer`): Removed from metadata. Metadata retains Info and Edit tabs only.
- **Scene tool rail button**: Removed from rail

## Behavior

- No changes to archive save/load — all archived settings serialize identically
- Session-only settings continue to reset on reload
- Per-asset background overrides preserved
- Event wiring in `event-wiring.ts` targets same element IDs (elements just move in DOM)

## Alternatives Considered

- **Three-section split by domain** (Scene Appearance / Camera & Navigation / Editor Preview): More granular but higher cognitive load
- **Tabbed split** (Defaults tab / Preview tab): Clean separation but adds click overhead and duplicates the tab pattern already used in metadata
