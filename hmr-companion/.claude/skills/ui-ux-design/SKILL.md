---
name: ui-ux-design
description: UI/UX, visual design and map cartography for HMR Companion (Next.js 16 + MapLibre outdoor app). Use this skill whenever a task touches how the app looks or feels: colors, palettes, light/dark themes, typography, spacing, sizes, icons, buttons, panels, mobile layout, touch targets, accessibility/contrast, animations, empty states, or anything drawn on the map (route/track lines, casing, markers, waypoints, segments, hillshade, contours, labels, basemap style). Also use it for vague requests like "make it nicer", "migliora i colori", "rendi più leggibile", "sistema la grafica", "più pulito", "esperienza", even when the word "design" isn't used.
---

# UI/UX e design — HMR Companion

The app is an outdoor/route-planning tool used **outside, on a phone, often in sunlight, with gloves or one hand**. Every design decision serves that: the user's route and position must read instantly over a busy topographic map, and controls must be hard to miss and easy to hit. Beauty matters, but legibility on a trail beats elegance on a monitor.

## 1. Find the ground truth before inventing anything

The app already has a design system. Reuse it; don't introduce new hex values when a token exists.

| What | Where |
|---|---|
| Theme tokens (dark default, light "pietra") | `src/app/globals.css` → `.v2-theme` and `.v2-theme.v2-light` (`--hmr-bg/surface/elev/border/text/muted/faint/accent/accent-2/warn/danger/safe`, `--hmr-radius`) |
| Tailwind names for the tokens | `globals.css` `@theme` block → `bg-hmr-surface`, `text-hmr-muted`, `border-hmr-border`, … |
| Sport colors (used for routes) | `src/lib/sports.ts` (`color:` per sport) |
| Basemap palettes | `src/lib/map/swiss-style.ts` → `SWISS`, `SWISS_DARK` |
| Relief (hillshade, tint) | `src/lib/map/topo-style.ts` → `applyRelief` |
| Data layers on the map (route, markers, segments, POI, user) | `src/components/v2/map/overlayLayers.ts` |
| Line widths / radii by zoom | `src/components/v2/map/constants.ts` |
| Contours | `src/components/v2/map/contourLayer.ts` |

Brand character (from the comments in `globals.css`): **minimal, solid surfaces, thin borders, no glass/blur, pastel and few colors** — petrol green (primary accent) + violet (secondary). Light mode is warm stone, never pure white. Keep that character when you "improve" things: improvement usually means *more contrast and clearer hierarchy*, not *more colors*.

## 2. Principles (and why)

1. **Hierarchy: the user's data > the base map.** Route, position and selected items sit on top and carry the strongest contrast. The basemap (roads, landcover, relief, contours) is context: desaturated, thinner, lower opacity. If two things compete, push the basemap down rather than shouting louder with the data.
2. **Pastel brand, high-contrast data.** Pastel sport colors look great in panels but disappear over hillshade. Keep the UI palette pastel; on the map give data a **casing** (a halo line underneath, light on light maps, dark on dark maps), enough width, and — on light maps — a *vivid* variant of the hue. Never reach contrast by only darkening a pastel: it passes the number and looks like mud (this was rejected by the user). Contrast ratio is necessary, not sufficient: always judge the screenshot too.
3. **One meaning per visual variable.** Color = sport/category. Dash = uncertainty (unrouted straight legs, previews, unofficial paths). Opacity = de-emphasis (dimmed/other routes). Width = importance/zoom. Don't reuse dashes for decoration or color for state if it already means sport.
4. **State is consistent.** Hover, selected, dimmed must look the same everywhere: selected = wider + full opacity + stronger casing; dimmed = ~0.35 opacity and no arrows; hover = halo in `--hmr-accent-2`.
5. **Accessibility is legibility outdoors.** Text ≥ 4.5:1 contrast with its background (3:1 for ≥ 18px bold); map lines and icons ≥ 3:1 against their surroundings (measure against both a light and a dark basemap sample). Never encode meaning with color alone — pair it with shape, dash, icon or label. Run `node .claude/skills/ui-ux-design/scripts/contrast.mjs <fg> <bg>` instead of guessing.
6. **Touch first.** Interactive targets ≥ 44×44 px (map hit-layers: line hit width ≥ 16px, circle hit radius ≥ 12px). Primary actions within thumb reach at the bottom on mobile; respect `--safe-bottom`/`--safe-top`. Design at **390×844** first, then widen.
7. **Light and dark parity.** Every change must be checked in both `.v2-light` and dark. Map styles have `mode: "light" | "dark"`; casing color, halo color and opacities usually differ between the two.
8. **Restraint in motion.** Map transitions 200–800 ms with easing; no animation that delays a tap. Prefer `easeTo` over `flyTo` for short moves.
9. **Small, reversible steps.** Change one family of things at a time (e.g. "route lines"), compare before/after, keep what clearly wins.

Map-specific rules (line widths by zoom, casing recipes, z-order, labels, relief) are in `references/cartography.md` — read it whenever the change touches anything drawn by MapLibre.

## 3. Workflow

1. **Look first.** Open the real screen in the browser (dev server `npm run dev`, port 3002; the map instance is exposed in dev as `window.__v2map`). Take *before* screenshots: desktop + 390 px, light + dark, at a zoom where the change matters (usually z12–15).
2. **Name the problem in one sentence** ("the trekking route disappears over hillshade at z13", "the close button is 28 px"). If you can't name it, you're decorating, not designing.
3. **Change via tokens/constants**, not scattered literals. If a value is used twice, it belongs in `constants.ts` or a CSS variable.
4. **Verify**: same screenshots *after*; check contrast with the script; check hit areas; check that nothing else regressed (labels still readable, contours not louder than the route).
5. **Report** what changed and why, with the before/after observation. Mention anything you deliberately left alone.

## 4. Checklist before saying "done"

- [ ] Route/track readable over the topo basemap with hillshade, in light and dark, at z11, z13, z15
- [ ] Selected vs. dimmed vs. normal states clearly distinguishable
- [ ] Text contrast ≥ 4.5:1, line/icon contrast ≥ 3:1 (measured)
- [ ] Touch targets ≥ 44 px; map hit layers wide enough
- [ ] Checked at 390 px width; nothing overflows; safe areas respected
- [ ] No new hex literals where a token exists; new shared values added to `constants.ts` / CSS vars
- [ ] Tests and lint still pass (`npx vitest run`, `npx eslint <files>`)
