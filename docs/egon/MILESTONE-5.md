# Milestone 5 — Asset library and the human asset portal

Closed work order. If this conflicts with [SPEC.md](SPEC.md), SPEC wins — stop and ask.

## Goal

Give every asset an identity the agents can read. Humans upload and **describe** assets through a web portal; the bot measures format and proportions **programmatically**; agents read a generated manifest and copy into the game repo only the assets a feature actually uses.

The portal becomes the **only** intake for game content. Discord keeps its `image` option, demoted to what it is actually good at: reference material an agent looks at, never a file the game ships.

The description path contains **no agent call**. A human writes the description because a human knows the intent ("boss vehicle for level 3", "must tile with `grass-plain`"), which is what drives placement decisions. A vision model would only produce an appearance caption, at cost, on every run.

## Out of scope

- Do not start extra milestones.
- **Do not add an LLM or vision call anywhere in this milestone.** The human describes; the machine measures. If a fact cannot be measured and the human did not type it, it is not known.
- Do not build a sprite-sheet region editor or tile picker. Sheets carry a grid spec and one prose description; see "Sprite sheets" below.
- Do not parse atlas companion files (TexturePacker / Aseprite / LibGDX / Tiled). They are not guaranteed to exist and are not worth a parser yet.
- Do not add a server-side image or 3D processing library (`sharp`, ImageMagick, Blender, FBX2glTF). Nothing enters the Docker image in this milestone.
- Do not accept formats that need a tool the image does not have. Reject them with a reason.
- Do not remove Discord image attachments themselves. `/egon-add`, `/egon-add-to-feature`, and `/egon-pivot` keep their `image` option and keep feeding it to agents as vision. Only the *asset* half goes; see "Discord images become reference-only".
- Do not store the library inside the game repo.
- Do not change planner backends, the state machine, the PR flow, or the scenario suite.

## Prerequisites

Milestones 1–4 complete. The catalog HTTP server on `$FEATURES_HTTP_PORT` is the host for the portal.

## Stack

Existing Node HTTP server and hand-built HTML. `file(1)` is already in the image. Format readers are hand-written — GLB is a 12-byte header plus a JSON chunk, OBJ is text; neither needs a dependency. The browser does all rendering: `<model-viewer>` from a CDN for the 3D preview, `<audio>` for sound, and a captured canvas frame for model thumbnails. No new npm dependency and no new apt package.

## Storage layout

The library lives in `$DATA_DIR`, outside the game repo, so unused assets never bloat git and `godot --import` only ever sees what a feature promoted.

```
$DATA_DIR/assets/
  garbage-truck-orange.glb
  garbage-truck-orange.glb.json      # meta sidecar, one per asset
  grass-plain.png
  grass-plain.png.json
  .thumbs/
    garbage-truck-orange.glb.png     # square gallery preview, models only
```

The stored filename is the asset **id**. It is derived from the description at first save (slugified, extension preserved, `-2` on collision) and **never changes afterwards**, even when the description is edited — a promoted asset's `res://` path must not break. `originalFilename` keeps the cryptic name the human dropped.

Meta sidecar:

```json
{
  "id": "garbage-truck-orange.glb",
  "originalFilename": "a3f9c2d1.glb",
  "sha256": "…",
  "bytes": 481203,
  "kind": "model",
  "format": "glTF 2.0 binary",
  "fileOutput": "glTF model, version 2",
  "measured": {
    "bboxMeters": [2.1, 1.9, 5.4],
    "triangles": 1240,
    "meshes": 3,
    "materials": ["Paint_Orange"],
    "animations": ["wheels_spin"]
  },
  "description": "Orange municipal garbage truck…",
  "tags": ["vehicle"],
  "grid": null,
  "uploadedAt": "2026-09-08T12:00:00.000Z"
}
```

`measured` is best-effort and shaped per kind: images carry `width` / `height` / `colorType`, audio carries `durationSeconds` / `sampleRate` / `channels`, sheets add `grid`. A reader that fails records nothing and does **not** block the upload — the description is the required part, the measurements are the bonus.

One sidecar per asset, not one index file: no write contention between the portal and a concurrent agent run, and deleting the pair is a complete delete.

## Detection

`file(1)` does the format identification, and for images it does the proportions too:

```
$ file --brief sprite.png
PNG image data, 32 x 32, 8-bit/color RGBA, non-interlaced
```

Parse that string for images. Pin the exact format in a test — `file`'s human-readable output is not a stable API; `file --mime-type` is the stable half and is the one that gates the allowlist.

`file` is **not** enough for models. It reports `glTF model, version 2` and stops — no bounding box, no triangle count, no node names. The bounding box is the single most placement-critical number in the library (whether the truck is 5 m or 0.05 m decides whether the implementer has to scale it), and the human will not type it accurately. So models get a real reader:

- **GLB** — 12-byte header (`glTF` magic, version, length), then chunk 0 is JSON. **glTF** — the JSON directly. The spec requires `min`/`max` on `POSITION` accessors, so the bbox is a lookup, not a mesh walk. Triangle count from the index accessors; names from `meshes`, `nodes`, `materials`, `animations`.
- **OBJ** — bbox from min/max over `v` lines, face count from `f` lines, material names from `usemtl`.

## Accepted and rejected formats

Accept, by kind: **image** `.png` `.jpg` `.jpeg` `.webp` `.gif` — **model** `.glb` `.gltf` `.obj` — **audio** `.ogg` `.wav` `.mp3` — **font** `.ttf` `.otf` `.woff2`.

Reject everything else, each with a reason the human can act on. Enforced **server-side** on the mime type and extension; the browser check at drop time is a convenience, not the gate.

| Rejected | Reason shown |
| --- | --- |
| `.fbx` | Needs FBX2glTF, which is not installed. Export `.glb` from Blender. |
| `.blend` | Needs Blender, which is not installed. Export `.glb`. |
| `.psd`, `.ai`, `.xcf` | Layered source formats are not game assets. Export a PNG. |
| `.aseprite`, `.ase` | Needs the Aseprite CLI, which is not installed. Export a PNG sheet. |
| `.zip`, `.rar`, `.7z` | Archives are not indexable. Unpack and upload the files. |
| `.tres`, `.tscn`, `.gd`, `.import` | Godot project files belong in the game repo, not the asset library. |
| anything else | Unsupported format `{ext}`. Accepted: {allowlist}. |

## Portal

Routes on the existing catalog server. Every **write** route reuses the existing catalog password `ente123` (`CATALOG_DELETE_PASSWORD`, `src/catalog/serve.ts`) and the `parsePassword` / `catalogPasswordOk` pair already there. No new secret and no new env var — the portal is for a handful of friends, not the public.

| Route | Purpose |
| --- | --- |
| `GET /assets` | The portal page |
| `GET /assets/file/{id}` | Serve asset bytes (`mimeFor`, streamed) |
| `GET /assets/thumb/{id}` | Serve the model thumbnail |
| `POST /assets` | Upload; returns detected facts plus a draft meta |
| `POST /assets/{id}` | Save description, tags, grid |
| `POST /assets/{id}/delete` | Delete asset, sidecar, and thumbnail |

Path-traversal check on every id, using the resolve-then-verify-prefix pattern already at `src/catalog/serve.ts` in the feature-attachment route. Ids never contain `/` or `\`.

Page layout, top to bottom:

- **Fat drag-and-drop zone.** Dropping files opens the detail dialog for the first, with a **Next** button walking the queue — not forty stacked modals.
- **Detail dialog**, reused for upload and for editing. Preview on top: `<img>` for images, `<model-viewer>` for models, a play control for audio, a rendered specimen line for fonts. Measured facts shown read-only. Below them the editable fields: **description** (the only required one), tags, and grid for sheets. Save, and — when opened from the gallery — Delete.
- **Gallery** of square previews with hover highlight, click to open the detail dialog prefilled. Toggle between gallery and a detail list view. Scrolls.

Thumbnails: images render directly with `object-fit: cover`, no thumbnail needed. Models need one, and the browser already renders the model for the preview — capture that canvas frame and upload it beside the file. No xvfb, no headless Godot, no server-side rendering.

The portal page is its own module. `src/catalog/page.ts` is already 887 lines of hand-built HTML strings; this UI is larger than anything in it and must not grow that file.

### Humans will not fill in the description unless it costs them something

The whole design rests on a human typing a description at the moment they least want to — dragging in forty files to get to the game. Half-filled metadata is worse than none, because the manifest still looks authoritative. Four things make it stick, and all four are required:

- **Description is the only required field.** Everything else is derived or optional.
- **An undescribed asset does not enter the manifest at all.** Agents cannot see it. This is the consequence that makes the rule real.
- **Undescribed assets are visibly broken in the gallery** — red border, plus an "N undescribed" counter pinned above the gallery.
- **The description prefills from the filename slug.** `garbage_truck_orange.glb` → `garbage truck orange`. Most packs already have usable names; the human edits rather than authors, and the genuinely cryptic ones are the ones left blank.

### Sprite sheets

A sheet is a container, not an asset. It carries a **grid spec** the human types — cell width, cell height — from which columns, rows, and frame count are derived programmatically. Those are exactly the numbers Godot's `AtlasTexture` / `SpriteFrames` want. Optional per-row labels ("row 0 = walk down") go in the description as prose.

That covers uniform sheets, which is nearly all of them. Irregular atlases, 9-slice edges, and autotile bitmask blobs stay approximate: grid spec plus a prose description like "13-piece autotile terrain set, grass→dirt transitions", and the implementer works out the bitmask. **Accept this gap.** A picker where humans select several tiles and describe them together ("path on grass tiles") is the eventual answer, and it is not this milestone.

## Discord images become reference-only

Discord stops being an asset intake. The portal is the only way a file becomes game content.

What an attached image is **for** after this milestone: *"make it look like this"*. The agent looks at it and takes direction from it. It never becomes a file in the game.

**Kept, unchanged.** The `image` option on `/egon-add`, `/egon-add-to-feature`, and `/egon-pivot`. The immediate download into `$DATA_DIR/features/{id}/attachments/` (Discord CDN URLs expire). The SQLite `attachments` row. The vision attachment on the first planner and implementer turn, and on a pivot follow-up. The catalog detail page's "Discord reference images" section and the `/features/{slug}/attachments/{file}` route.

**Removed.** The copy into the game repo, and everything that exists to serve it:

- `src/features/artifacts.ts` — delete `copyFeatureAssets`, `plannedAssetPath`, and `featureAssetDir`. `assets/egon/{slug}/` stops existing; nothing writes there.
- `src/pipeline/orchestrator.ts:143`, `:222` — drop both `copyFeatureAssets` calls (branch creation and pre-implementer).
- `src/pipeline/orchestrator.ts:504`, `src/discord/commands.ts:87` — drop the `plannedAssetPath` lookups that tell the human where the file will land in the repo. `formatNoteAdded` / `formatPivoting` keep their `assetPath` parameter unused → remove it from both and from `formatQuotedUserText`'s call sites. The reply confirms the image was attached, and promises no repo path.
- The spec commit stops carrying attachment files. `docs/GAME_DECISIONS.md` and the spec itself are unaffected.
- `src/features/artifacts.test.ts` — the `copyFeatureAssets` and `plannedAssetPath` tests go with the functions.

**Reworded — this is the part that actually changes agent behavior.** `attachmentPromptLines` (`src/cursor/images.ts:93`) currently tells the implementer *"Those files are already in the working tree at `assets/egon/{slug}`. Import them into the Godot project from there (do not re-download)."* That instruction must invert. An agent handed an image will otherwise still try to make it game content, and now the file is not even on disk in the repo:

> N Discord images are attached as vision input. They are **reference material only** — art direction, mockups, "make it look like this". They are not in the working tree and must not be imported, copied, or referenced by any `res://` path. Build what they describe using library assets named in SPEC §4, or with primitives you draw yourself.

The planner's variant says the same and adds: if a reference image implies the feature needs real art, look for it in the asset index and name it in §4 — and if nothing in the library fits, say so in §6 rather than inventing a filename.

**SPEC amendments for this.** Product flow step 3 — drop *"Discord images are copied into `assets/egon/{slug}/`"* and the word "assets" from what the spec commit carries. The `## Discord commands` paragraph on the `image` option — rewrite: the bot still downloads immediately and still attaches as vision, but no longer copies into the game repo; assets come from the portal. `## Out of scope` — Discord as an asset intake.

## Agent-facing side

`$DATA_DIR/ASSETS.md`, generated from the sidecars, cached and regenerated on every portal write and on pipeline start. Never throws; a stale manifest beats a failed run.

The two agents get **different slices of it**, because they need opposite things.

**The planner gets a compact index, injected.** It must know what exists in order to decide, and a pointer does not fix that — an agent with no idea the library has a garbage truck has no reason to go look for one, and will spec a `ColorRect` placeholder instead. "This feature needs no assets" is a conclusion the planner can only reach *after* seeing the library, so the index has to be in front of it. Injected as a prompt section exactly as `GAME_MAP.md` is (`gameMapPromptSection` → `plannerPrompt.ts`, `claude/planner.ts`), and like the Scenarios table it is an **index only**: `id` grouped by kind with the one-line description, and no measured column. Roughly 15 tokens a row.

**The implementer gets only the assets SPEC §4 declared, with their measured facts.** It does not need the catalog — the spec already names its assets by exact id — and handing it the whole library invites it to reach for one the spec never declared, which promotion never copied into the repo, producing a broken `res://` reference. What it does need is the measurements, because that is where they get used: bounding box for scaling, grid for `AtlasTexture` / `SpriteFrames` setup. So the implementer's section resolves the §4 ids into rows carrying the measured column and the promoted `assets/library/{kind}/{id}` path, and nothing else.

This is the same split MILESTONE-4 made for scenarios — a compact index in the prompt, never the accumulated detail.

`ASSETS.md` on disk holds the full table both slices are cut from. Grouped by kind, one row per asset. **Only assets with a description appear.** Cap at `MAX_MANIFEST_ASSETS` with a `… N more` row, following `MAX_BRIDGE_FIELDS`.

```markdown
# Asset library

Assets available to this game. Facts are measured; descriptions are written by the humans who
uploaded them. Not an LLM summary.

An asset is only in the game once a feature copies it in. Name the ones you use in SPEC §4;
after promotion the path is `assets/library/{kind}/{id}`.

## Models

| id | Measured | Description |
| --- | --- | --- |
| `garbage-truck-orange.glb` | 2.1 × 1.9 × 5.4 m, 1.2k tris, anims: wheels_spin | Orange municipal garbage truck, low-poly flat-shaded, wheels are separate nodes |

## Images

| id | Measured | Description |
| --- | --- | --- |
| `grass-plain.png` | 32 × 32 RGBA | Top-down seamless grass tile, 4-colour palette |
| `hero-walk.png` | 512 × 256 RGBA, grid 32 × 32 (16 × 8 = 128 frames) | Hero walk cycle, rows are down/up/left/right |
```

**Promotion.** The implementer copies each asset SPEC §4 names from `$DATA_DIR/assets/{id}` to `assets/library/{kind}/{id}` in the game repo, then imports it. Idempotent by sha256: a file already present with matching content is skipped, never re-copied. Assets are committed with the implementer's commit like any other change. Nothing else in the library reaches the repo.

## Files to create or change

**Library and detection**

- `src/assets/store.ts` *(new)* — layout, sidecar read/write, list, delete, id slugging and collision, sha256, dedupe on re-upload of identical bytes.
- `src/assets/allowlist.ts` *(new)* — accepted extensions per kind and the rejection reason per known-unsupported format. The server-side gate.
- `src/assets/detect.ts` *(new)* — `file --brief` / `file --mime-type`, image dimension parsing, dispatch to the readers.
- `src/assets/gltf.ts` *(new)* — GLB header + JSON chunk, `.gltf` JSON, bbox from `POSITION` accessor min/max, triangle count, mesh/node/material/animation names.
- `src/assets/obj.ts` *(new)* — bbox, face count, `usemtl` names.
- `src/assets/audio.ts` *(new)* — ogg/wav/mp3 duration, sample rate, channels. Best effort, never throws.

**Portal**

- `src/assets/portalPage.ts` *(new)* — the page. Do not grow `src/catalog/page.ts`.
- `src/assets/routes.ts` *(new)* — the six routes, the `catalogPasswordOk` check on writes, the traversal guard, and multipart parsing.
- `src/catalog/serve.ts` — mount the routes.
- `src/catalog/page.ts` — repoint the existing **Upload assets** link (`page.ts:851`) from `https://discord.mbuelow.dev` to `/assets`, and rewrite the index lede that currently ends *"Host sprites, audio, and other files on the sharing service, then paste the URL in a Discord note so the implementer can pull them in."* That sentence instructs humans to do the exact thing this milestone replaces. It becomes a pointer to the portal: upload and describe assets there, and the planner can name them in a spec.
- `src/catalog/page.test.ts:54`, `src/catalog/serve.test.ts:116` — both assert on the `Upload assets` link text. Keep the assertion, retarget the href.

**Agent-facing**

- `src/assets/manifest.ts` *(new)* — `generateAssetManifest`, `writeAssetManifest`, `refreshAssetManifest`, `MAX_MANIFEST_ASSETS`, plus the two prompt slices: `assetIndexPromptSection()` (compact, all described assets, for the planner) and `declaredAssetsPromptSection(ids)` (measured rows for the §4 ids, for the implementer). Mirror `src/godot/gameMap.ts` structurally.
- `src/assets/promote.ts` *(new)* — copy declared assets into the repo, idempotent by sha256.
- `src/cursor/plannerPrompt.ts`, `src/claude/planner.ts` — inject the compact index; teach the planner to name assets by exact id and never invent one.
- `src/cursor/implementer.ts` — inject the resolved §4 rows only, never the full library.
- `src/features/specSections.ts` — add `ASSETS_HEADING_RE` and `assetsSection`.
- `src/features/specValidate.ts` — extend the gate: every id SPEC §4 names must exist in the library and have a description. A `PLAN_COMPLETE` naming an asset that is not there is not complete.
- `src/pipeline/orchestrator.ts` — promote §4 assets before the implementer runs; refresh the manifest at pipeline start.

**Spec contract**

- `templates/spec-sheet.md` — insert **§4 Assets**; renumber Interface → §5, Implementation notes → §6, Verification hooks → §7, Test scenarios → §8, Acceptance criteria → §9, Explicitly NOT this task → §10.

  Section parsers match on heading *name* with an optional number prefix, so `specSections.ts` needs no change for the renumber. The literal `§N` strings in prose do:

  | Location | Now | Becomes |
  | --- | --- | --- |
  | `templates/spec-sheet.md` §5 body | `§6` | `§7` |
  | `templates/spec-sheet.md` §8 body | `§6` | `§7` |
  | `src/cursor/plannerPrompt.ts:32` | `Section 6`, `§7` | `Section 7`, `§8` |
  | `src/cursor/implementer.ts:99` | `§6 field` | `§7 field` |
  | `src/cursor/godotWebGotchas.ts:9` | `§6 state` | `§7 state` |
  | `src/suite/statePoll.ts:2` | `SPEC §6` | `SPEC §7` |
  | `src/cursor/testReport.ts:7` | `SPEC §7 item` | `SPEC §9 item` (already stale — it means Acceptance criteria) |

  `SPEC §3` in `implementer.ts:78` and `implementerSummary.ts:18` is unaffected.

**SPEC amendments** (land these in `SPEC.md` as part of this milestone; do not restate them in here)

- A new `## Asset library` section: the `$DATA_DIR/assets/` layout, the sidecar shape, the id-is-immutable rule, the described-or-invisible rule, the allowlist and rejection reasons, and promotion-on-use into `assets/library/{kind}/{id}`.
- `## Environment` — extend the `DATA_DIR` line to mention the asset library. No new env var.
- `## Feature catalog` — the six portal routes, guarded by the same `ente123` password as delete.
- `## Product flow` step 4 — the implementer promotes SPEC §4 assets before it edits.
- `## Out of scope` — no vision/LLM description of assets; no formats needing tools outside the image.

## Behavior

- Every fact in a sidecar is either measured by the bot or typed by a human. Nothing is inferred by a model.
- An asset without a description is invisible to every agent and visibly broken in the gallery.
- The stored id never changes after first save. Editing a description does not rename the file.
- Re-uploading identical bytes under a different name resolves to the existing asset rather than creating a duplicate.
- Rejections state the format and the reason, and are enforced server-side.
- Only assets a spec names reach the game repo, and promotion is idempotent.
- The external sharing service is no longer the asset route for humans. The implementer's existing ability to download `http(s)` URLs found in feature notes stays as-is — but an asset arriving that way has no sidecar and never reaches the manifest, so it is the unmanaged path by definition. Do not remove it in this milestone; do not advertise it either.
- Deleting an asset from the portal removes it from the library and the manifest. It does **not** touch a copy already promoted into the game repo — that is committed history and git owns it.

## Migration

Nothing to migrate. The library starts empty, no asset exists in the game repo today, and `assets/egon/` has never been created there — so removing the Discord copy path deletes code, not files. If a tree somewhere does have an `assets/egon/`, leave it: git owns what is already committed. Order the work: storage and detection first, then the manifest generator (so `ASSETS.md` exists and is empty), then the portal, then the spec §4 contract, the gate, and promotion last. A feature planned before the first upload sees an empty manifest and writes `None.` in §4, which must validate cleanly.

## Test plan

- `file` output for PNG, JPEG, GIF, and WebP parses to correct dimensions; the exact strings are pinned so a `file` upgrade fails loudly rather than silently returning nothing.
- A GLB and the equivalent `.gltf` yield the same bbox, triangle count, and animation names.
- A model whose `POSITION` accessor lacks `min`/`max` records no bbox and still uploads.
- A truncated or corrupt GLB is stored with no `measured` block instead of failing the upload.
- Every rejected format returns its specific reason, and the rejection holds when the extension is renamed to a permitted one (mime type decides).
- Path traversal in an id is refused on read, write, and delete.
- Every write route without the password returns 403, and `ente123` is accepted on all three.
- An asset saved with an empty description is absent from `ASSETS.md` and counted in the undescribed badge.
- Editing a description does not rename the stored file, and a promoted `res://` path stays valid.
- Re-uploading identical bytes under a new filename resolves to the existing id.
- A sheet with a 32 × 32 grid on a 512 × 256 image reports 16 × 8 = 128 frames.
- The manifest caps at `MAX_MANIFEST_ASSETS` with a `… N more` row.
- The planner's injected index lists every described asset and carries no measured column; the implementer's section carries measurements for exactly the ids its spec declared and no others.
- The spec gate rejects a §4 naming an unknown id, and accepts `None.`
- Promotion copies only declared assets, is idempotent across two runs, and leaves the library untouched.
- The catalog index **Upload assets** link resolves to the portal, and no page still tells humans to host files on the external sharing service.
- `/egon-add` with an image still reaches the planner as vision, still shows on the catalog detail page, and leaves **no** file in the game repo; the working tree after a plan commit contains no `assets/egon/` directory.
- The implementer prompt for a feature with reference images contains no instruction to import them, and the run produces no `res://` reference to an attachment.
- Full run: upload and describe a model in the portal → idea → plan (spec names it in §4) → implement (asset promoted, imported, placed) → export → suite → PASS.

## Done when

- [ ] Humans upload, describe, edit, and delete assets in a browser with no Discord and no agent involved
- [ ] Format and proportions are measured programmatically; `file` for images, a real reader for model bounding boxes
- [ ] Unsupported formats are rejected server-side with a reason that says what to do instead
- [ ] Assets live in `$DATA_DIR`, never in the game repo until a feature uses one
- [ ] Discord images are reference-only: attached as vision, never copied into the game repo, never imported
- [ ] Ids are stable across description edits
- [ ] The gallery shows every asset with a preview, 2D / 3D / audio detail views, and an undescribed count
- [ ] Undescribed assets are invisible to agents
- [ ] `ASSETS.md` is generated from the sidecars; the planner sees a compact index of the whole library and the implementer sees only its spec's declared assets, with measurements
- [ ] Specs declare assets in §4 by exact id, and the gate rejects ids that do not exist
- [ ] The implementer promotes only declared assets, idempotently, and imports them
- [ ] Asset portal writes are password-gated with the existing catalog password
- [ ] The catalog's **Upload assets** link opens the portal, not the external sharing service
- [ ] No LLM or vision call exists anywhere in the asset path
