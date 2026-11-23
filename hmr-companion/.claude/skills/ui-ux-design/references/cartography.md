# Cartography recipes for MapLibre (HMR Companion)

Read this when changing anything drawn on the map. Values are starting points tuned for a Swiss-style topo basemap with multidirectional hillshade; adjust after looking at screenshots.

## Z-order (bottom → top)

1. Background, landcover, water fills
2. **Color relief (tint)** → just above background fills
3. **Hillshade** (runtime or precomputed raster) → below roads and water lines (`reliefInsertBefore`)
4. Contours (lines) → below roads; contour labels → below basemap labels
5. Roads, paths, rail, buildings
6. Basemap labels (symbols)
7. **User data**: route casing → route line → direction arrows → markers/waypoints → selection/hover halos → user position
8. Hit layers (transparent, widest) on top

User data goes above basemap labels on purpose: the route matters more than a village name. If a label must stay readable over the route, give labels a halo instead of moving the route down.

## Line widths by zoom

Use `["interpolate", ["exponential", 1.5], ["zoom"], ...]` for lines so width grows like the map scale; linear interpolation makes lines look too fat when zoomed out.

| Layer | z8 | z12 | z15 | z18 |
|---|---|---|---|---|
| Route line | 2.5 | 4 | 6 | 8 |
| Route casing | line + 2.5–3 px | | | |
| Selected route line | ×1.25 | | | |
| Segments | narrower than the route (they sit on top of it) | | | |
| Basemap paths | 0.7 → 1.8 (z12 → z17) | | | |
| Contours | 0.55 intermediate, 1.1 index | | | |

Rule of thumb: the route should be at least ~2× the width of the widest basemap road *class it typically follows* (paths/tracks), so it never reads as "just another road".

## Casing (halo) recipes

Casing = same geometry, wider line underneath, contrasting color, slight transparency.

- **Light basemap:** casing `#ffffff` at 0.85–0.95 opacity, optionally a thin dark outer edge (`rgba(20,24,28,0.25)`, +1 px) for hillshaded slopes where white alone washes out.
- **Dark basemap / orthophoto:** casing `#0d1114`–`#131619` at 0.7–0.85 opacity.
- `line-join: round`, `line-cap: round` on both casing and line, or the joints show gaps.
- Dimmed routes: drop casing opacity together with the line (≈ 0.35) so they recede as a unit.
- Dashed lines (unrouted legs): keep a **solid** casing under the dash so the dash reads as "uncertain route", not "broken line".

## Color

- Sport colors in `src/lib/sports.ts` are pastel. On the dark map they work as-is. On the light map they fail (1.5–2.8:1), so `src/lib/map/route-colors.ts` (`mapLineColor`) builds a map-only variant; the UI palette stays pastel.
- **Fix contrast with chroma, not just darkness.** Darkening a pastel at constant saturation produces muddy browns, dusty violets and grey-teals: technically 3:1, visually ugly (the user rejected exactly this). Push chroma toward the sRGB maximum for the hue (OKLCH), then lower lightness only as much as needed. Vivid `#855ded` beats dull `#7e6cc1` on both contrast and looks.
- Measure against **both** light samples, paper `#f6f3ea` and forest `#d4e3c2` (forest is the worst case): `node .claude/skills/ui-ux-design/scripts/contrast.mjs "#855ded" "#f6f3ea" "#d4e3c2"`.
- Warn/danger on the map: use `--hmr-warn`/`--hmr-danger` equivalents, never pure `#ff0000`.
- Avoid pure black/white lines; near-black `#14181c` and warm white `#fbfaf7` look less harsh.

## Markers and points

- Circles: fill = category color, **stroke 2 px** in casing color (white on light, near-black on dark). Without a stroke, small circles vanish on hillshade.
- Radius grows with zoom (see `WAYPOINT_RADIUS` in `constants.ts`); hit radius ≥ 12 px.
- Start/end: distinct shape or label, not only color.

## Labels

- `text-halo-width` 1.2–1.6, halo color = basemap paper color at ~0.9 opacity.
- Font from the style's glyphs (`pickStyleFont`) so labels don't 404.
- Line labels (contours, rivers): `symbol-spacing` ≥ 250 px, `text-padding` ≥ 8.

## Relief

- Hillshade is context. Light mode, Swiss recipe: **light blue-violet shadows** `rgba(74,80,112,0.30)` + **warm sunlit highlights** `rgba(255,247,220,0.42)`, exaggeration ≈ 0.42. A full slate-grey shadow (`rgba(43,52,70,0.42)`) turns the whole map into dirty concrete; too much yellow in highlights reads as sand. If the route struggles, lower relief contrast before making the route louder.
- Dark mode, "Swiss night" recipe: **soft blue-night shadows** `rgba(5,8,18,0.40)` + **cool moonlight highlights** `rgba(196,212,236,0.16)`, exaggeration ≈ 0.38; forest `#22322a` on paper `#1b2024`. Pure black shadows at 0.55 crush whole slopes into mud; light, dense contours on a dark ground become white noise, so keep them at ~0.22 opacity and thinner (0.45/0.9 px).
- Landcover carries the life of a topo map: forests must be a readable green (`#d4e3c2`), paper warm ivory (`#f6f3ea`). A near-grey forest makes the map monochrome.
- Color relief (tint) ≤ 0.45 opacity; off by default.
- Precomputed relief replaces runtime hillshade only inside the corridor (see `reliefMode` in `src/lib/map/relief.ts`).

## "Hand-drawn" Swiss textures

Generated on canvas in `src/components/v2/map/mapImages.ts` (ids in `PATTERN_IDS`, `swiss-style.ts`), light and dark variants:
- Rock: irregular groups of oblique hatch strokes (z11+), scree: variable stipple (z12+), forest: staggered "lollipop" tree marks (z13+), paper: faint grain on a world polygon.
- Work in **canvas pixels at pixelRatio 2**: a radius of 2 px is 1 px on screen and vanishes. Tree crowns ≈ 4–6 canvas px, strokes ≥ 1.5.
- Make patterns seamless (redraw marks near edges at ±size) and deterministic (seeded PRNG).
- Fade textures in with zoom; far out they turn into noise.
- Use `fill-pattern` (fires `styleimagemissing`), not `background-pattern`: the latter never asks for the image and loses it on every `setStyle`.

## Testing on the map

```js
// dev console / javascript tool
const m = window.__v2map;
m.jumpTo({ center: [21.73, 39.68], zoom: 13 });           // HMR, Greece
await new Promise(r => m.once('idle', r));
m.getStyle().layers.map(l => l.id);                         // check z-order
m.getPaintProperty('v2-route', 'line-width');
```

Test locations: Valchiavenna `[9.40, 46.32]` (dense paths, Alps), Pindus/HMR `[21.73, 39.68]` (Greece, global DEM only).
