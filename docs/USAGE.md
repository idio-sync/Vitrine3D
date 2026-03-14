# Usage Guide

This guide covers the **editor** at `/editor/`. For the kiosk viewer at `/`, see [Kiosk Viewer](KIOSK-VIEWER.md).

## Loading Files

**From the UI**: Use the Load Files panel to load assets from local files or URLs. Each asset type (Splat, Model, Point Cloud, Drawing, Archive) has "From File" and "From URL" buttons.

**From URL parameters**: Pass file URLs directly in the address bar (see [Configuration](CONFIGURATION.md#url-parameters)).

**From an archive**: Loading a `.ddim` or `.zip` file automatically extracts and displays all bundled assets with their saved transforms, metadata, and annotations.

**Asset types**:
- **Splat** — Gaussian splat (`.splat`, `.ply`, `.sog`, `.sogz`)
- **Model** — 3D mesh (`.glb`, `.obj`)
- **Point Cloud** — E57 point cloud (`.e57`)
- **Drawing** — 2D/3D CAD drawing (`.dxf`); load from file or URL like any other asset type
- **Flight Path** — Drone flight log (`.txt`, `.csv`, `.kml`, `.kmz`, `.srt`); renders GPS telemetry as a 3D line with hover data points. Supports non-destructive trim with start/end scrubber handles
- **SfM Cameras** — Colmap Structure-from-Motion data (`cameras.bin` + `images.bin`); visualizes camera positions as frustum wireframes or instanced markers. Can be auto-aligned to a flight path via Umeyama similarity transform
- **Detail Model** — High-resolution GLB mesh attached to a specific annotation for close-up inspection. Opened in a dedicated overlay viewer with its own lighting, camera, and sub-annotations

## Example: Archive Creation to Delivery

This walkthrough covers the full pipeline from loading raw assets through to sharing an archive with a client.

### 1. Load assets

Open the editor at `/editor/`. Use the Load Files panel to bring in your data:

- **Splat**: Click "From File" under Splat and select your `.ply` or `.splat` Gaussian splat file
- **Model**: Click "From File" under Model and load the `.glb` mesh
- **Point Cloud** (optional): Load an `.e57` if you have LiDAR data to include

All three assets render simultaneously in "Both" display mode. If you also have a DJI flight log or Colmap SfM cameras, load those from their respective sections — they'll appear as overlays in the scene.

### 2. Align assets spatially

Assets rarely share the same coordinate system out of the box:

1. Click **Auto Align** to get a rough bounding-box alignment
2. Use **Landmark Alignment** for precision — place 3+ matching point pairs on the splat and mesh, check the RMSE readout, then click Apply
3. Alternatively, use **ICP Align** if the assets are already close — it refines the registration automatically using rigid transforms

If you have a flight path and SfM cameras loaded, click **Align Cameras to Path** to compute the Umeyama similarity transform automatically.

### 3. Set up the scene

In the Scene Settings panel:

- Choose a **background color** or load an **HDR environment map** for image-based lighting
- Enable **shadows** — a shadow catcher ground plane appears automatically
- Adjust **tone mapping** (ACESFilmic works well for presentation) and **exposure**
- Optionally enable **SSAO** and **Bloom** for depth and cinematic polish

Frame the subject with the camera, then set any **camera constraints** (lock orbit/pan/zoom, max elevation) that should apply in the kiosk viewer.

### 4. Add annotations

Press `A` to enter annotation mode, then click on surfaces to place markers. For each annotation:

- Write a **title** and **description** (supports markdown)
- Attach **images** that get bundled into the archive
- The current camera viewpoint is saved — kiosk viewers will animate to this view when the annotation is selected

### 5. Fill in metadata

Press `M` to open the metadata sidebar. Choose a **completeness profile** (Basic for quick delivery, Archival for full Dublin Core). Key fields:

- **Project tab**: Title, creator, description, tags, license
- **Provenance tab**: Capture date, equipment, operator
- **Quality tab**: Accuracy, resolution, coordinate reference system

The **SIP validator** at export time will flag any missing required fields.

### 6. Create a walkthrough (optional)

Open the Walkthrough panel and click "Add Stop" at each camera position you want in the guided tour. Set transition types (fly/fade/cut) and dwell times. Click Preview to test the sequence.

### 7. Capture a preview image

Click **Set Archive Preview Image** to open the viewfinder overlay. Frame the subject and capture — this becomes the archive thumbnail shown in the kiosk click-to-load gate and the library browser.

### 8. Export the archive

Click the **Export Archive** toolbar button (or use the Export section in the controls panel). The editor:

1. Computes SHA-256 hashes for all bundled files (requires HTTPS)
2. Runs the SIP compliance validator — review any warnings
3. Bundles everything (assets, manifest, annotations, screenshots, preview image, README.txt) into a `.ddim` ZIP archive
4. Downloads the file to your browser

### 9. Deploy to the library (Docker)

Upload the `.ddim` file to your Docker server's archive directory. The meta-server API (`POST /api/archives`) indexes it automatically. The archive appears in the library browser at `/`.

Optionally, add the archive to a **collection** via the library panel — collections group related archives with a shared thumbnail and description.

### 10. Share with clients

Generate a share link:

- **Direct link**: `https://viewer.example.com?archive=/archives/uuid/scan.ddim` — loads immediately
- **Deferred embed**: Add `&autoload=false` for a click-to-load gate (~100KB initial transfer instead of the full archive)
- **Themed**: Add `&theme=editorial` for the gold-and-navy editorial layout, or `&theme=gallery` for cinematic full-bleed

For iframes:

```html
<iframe
  src="https://viewer.example.com?archive=/archives/uuid/scan.ddim&autoload=false&theme=editorial"
  width="100%" height="600" frameborder="0" allow="fullscreen">
</iframe>
```

For desktop delivery, build a **branded Tauri executable** (`npm run branded`) that bundles the archive into a standalone `.exe` or `.msi` installer with a custom name and icon.

---

## Display Modes

| Mode | Description |
|------|-------------|
| **Splat** | Show only the Gaussian splat |
| **Model** | Show only the 3D model |
| **Point Cloud** | Show only the point cloud |
| **Both** | Overlay all assets for comparison |
| **Split** | Side-by-side: splat on left, model + point cloud on right, with synced camera |

## Camera Controls

### Orbit Mode (default)

- **Left-click + drag** — Rotate view
- **Right-click + drag** — Pan view
- **Scroll wheel** — Zoom in/out
- **Reset Camera** button — Return to initial position
- **Fit to View** button — Auto-frame all loaded content

### Fly Mode (press `F` or click the fly camera toolbar button)

- **WASD** — Move forward/left/backward/right
- **Q / E** — Move down / up
- **Right-click + drag** — Mouse look (yaw/pitch)
- **Shift** — Fast movement (3x speed)
- **Ctrl** — Slow movement (0.25x speed)
- **Scroll wheel** — Adjust movement speed
- **Escape** — Exit fly mode

## Alignment

- **Auto Align** — Aligns objects using bounding box center-of-mass matching
- **ICP Align** — Iterative Closest Point algorithm for precise point-to-point registration using rigid transforms (works best when objects are roughly aligned first). Supports optional `points3D.bin` from Colmap for denser correspondence sets
- **Landmark Alignment (N-point)** — Interactive point-pair matching for precise manual alignment:
  1. Click the landmark alignment button to enter the tool
  2. Click a point on the anchor object, then the matching point on the mover object — this is one pair
  3. Add 3 or more pairs; the transformation previews live as each pair is added
  4. RMSE quality metric updates after each pair
  5. Press Ctrl+Z (or the Undo button) to remove the last placed point
  6. Click Apply to commit the alignment
- **Save Alignment** — Downloads transform data as a JSON file
- **Load Alignment** — Applies transforms from a saved JSON file or URL
- **Reset All** — Resets all objects to origin with default scale

## Measurement & Analysis Tools

### Distance Measurement

- Click the ruler (Measurement) toolbar button to enter measurement mode
- Click two points on any loaded mesh surface to measure point-to-point distance
- A 3D line overlay with DOM labels shows each measurement
- Units are configurable: m, cm, mm, in, ft
- Measurements are session-only — they are not saved to archives
- Multiple measurements can be active simultaneously; each has an × button to remove it

### Cross-Section

- Click the Cross-Section toolbar button to activate a clipping plane
- The plane can be oriented on any axis and repositioned along it
- Everything on one side of the plane is hidden, exposing interior geometry
- Toggle the clipping plane on/off without losing its current position

## Annotations

Press `A` or click the annotation toolbar button to enter placement mode, then click on any 3D surface to create an annotation.

Each annotation stores:
- Title and description (supports markdown with inline images)
- 3D position on the surface
- Camera viewpoint (position + target) for restoring the view
- Optional image attachments stored inside the archive

Annotations appear as numbered markers in the 3D view and as chips in a bottom bar. Markers are **depth-aware** — they fade when the annotated surface faces away from the camera, reducing visual clutter. In the kiosk viewer, selecting a marker draws an SVG connecting line to its popup.

Annotations are saved inside archive containers and persist across sessions via localStorage. Images referenced in annotation descriptions use an `asset:images/filename.ext` protocol that resolves to blob URLs at runtime.

Additional annotation features:
- **Smooth camera animation** — clicking an annotation chip navigates the camera to the saved viewpoint with a smooth animated transition; the viewport fades during the move
- **Hero image** — annotations can include a hero image displayed prominently above the description text
- **Lightbox** — clicking any inline image in an annotation opens a full-screen lightbox viewer
- **YouTube embeds** — a bare YouTube URL on its own line in an annotation description renders as an embedded video player (uses youtube-nocookie.com)

## Walkthrough

A walkthrough is a guided sequence of camera stops that plays back automatically. Walkthroughs are saved in the archive and play in both the editor and kiosk viewer.

**Creating a walkthrough (editor)**:
1. Open the Walkthrough panel in the properties pane
2. Click "Add Stop" to capture the current camera position as a stop
3. Each stop has: title, optional annotation link, transition type (fly/fade/cut), transition duration, and dwell time
4. Stops can be reordered by drag-and-drop
5. Click Preview to play back the sequence in the editor

**Playback**:
- Auto-play starts the walkthrough automatically when the archive loads (configurable)
- Loop option replays the sequence continuously
- Play/pause button in the kiosk viewer controls playback
- Respects `prefers-reduced-motion` — skips animations for accessibility

**Transition types**:

| Type | Behaviour |
|------|-----------|
| `fly` | Smooth camera animation from current position to stop |
| `fade` | Fades to black, cuts camera, fades back in |
| `cut` | Instant camera jump with no animation |

## Detail Model Viewer

The detail model viewer lets you attach a high-resolution 3D model (GLB) to any annotation for close-up inspection. When a viewer clicks "Inspect Detail" on an annotation, a dedicated overlay opens with its own scene, lighting, camera, and annotation system.

### Attaching a detail model (editor)

1. Select an annotation in the 3D view or annotation list
2. In the annotation sidebar, find the **Detail Model** section
3. Click **Attach .glb** and select a GLB file — the model is added to the archive
4. Optionally capture a **thumbnail** (shown as a preview in the annotation popup)
5. Click **Inspect** to open the detail viewer and configure it

### Detail viewer controls

Inside the detail viewer overlay:

- **Orbit, pan, zoom** — same controls as the main scene
- **Lighting preset** — choose from Neutral, Studio, Outdoor, or Warm
- **Camera constraints** — lock orbit, distance, or height; set initial camera position
- **Auto-rotate** — toggle turntable rotation with configurable speed
- **Background color** — independent from the main scene
- **Sub-annotations** — click **Place Annotation** to add markers directly on the detail model. Sub-annotations are saved inside the parent annotation and persist in the archive
- **View settings** — all camera, lighting, and display settings are saved per-detail-model in the archive

### Detail viewer in kiosk mode

In the kiosk viewer, annotations with attached detail models show an **Inspect Detail** button (with optional thumbnail preview) in the annotation popup. Clicking it opens the detail viewer in read-only mode with the saved view settings. The editorial theme uses a split-push layout — the main scene freezes on the right while the detail viewer and info panel slide in from the left.

### Archive format

Detail models are stored as `detail_N` entries (e.g., `detail_0`, `detail_1`) under `assets/` in the archive with role `"detail"`. Thumbnails are stored as `images/detail_N_thumb.png`. Sub-annotations and view settings are stored inline in the parent annotation's `detail_annotations` and `detail_view_settings` fields.

## VR Mode

Vitrine3D supports WebXR virtual reality on compatible headsets (e.g., Meta Quest, HTC Vive, Valve Index). VR mode is available in both the editor and kiosk viewer.

### Requirements

- A WebXR-compatible browser (Chrome, Edge, or Quest Browser)
- A VR headset with controllers
- The **Enter VR** button appears automatically when WebXR is detected

### Entering VR

- Click the **Enter VR** button in the toolbar (bottom-right corner)
- Alternatively, use `?vr=true` in the URL to show a full-screen "Tap to enter VR" overlay on load

### VR controls

| Input | Action |
|-------|--------|
| Right trigger | Teleport (aim with parabolic arc, release to jump) |
| Right thumbstick | Snap turn (30° increments) |
| Left wrist gaze | Show wrist menu (look at your left wrist) |

### Wrist menu

A canvas-rendered menu appears on your left wrist when you look at it. It provides:

- **Asset toggles** — show/hide Splat, Mesh, Point Cloud, CAD, Flight Path
- **Locomotion mode** — switch between Teleport and Smooth movement
- **Exit VR** — return to desktop view

### VR annotations

3D annotation markers appear as sprites in VR space, scaled 2× larger than desktop markers. Point a controller at a marker and pull the trigger to show a text card popup that billboards toward you.

### Performance

VR automatically adjusts rendering for performance:
- Splat budget: 2M splats (PC headsets) vs 500K (standalone, future)
- Framebuffer scale: 50% of native resolution
- Max standard deviation reduced for cheaper splat rendering

## Object Optimization Profiles

The Optimization section in the editor provides size-aware presets that configure both HD (web-optimized) and SD (mobile proxy) mesh settings in one step.

### Profiles

| Profile | Best for | HD Target Faces | SD Target Faces |
|---------|----------|-----------------|-----------------|
| **Small** | Jewelry, shoes, pottery | 300K | 50K |
| **Medium** | Furniture, busts, sculptures | 500K | 100K |
| **Large** | Monuments, room interiors | 1M | 250K |
| **Massive** | Full buildings, complexes | 2M | 500K |
| **Custom** | Manual configuration | User-defined | User-defined |

### How to use

1. Open the **Optimization** section in the editor controls panel
2. Select an **Object Profile** from the dropdown — HD and SD fields auto-populate
3. Under **Web Optimization**, click **Optimize** to decimate the mesh to the HD target
4. Under **SD Proxy**, click **Generate SD Proxy** to create a mobile-friendly version
5. The selected profile is saved in the archive and restored when the archive is reloaded

The **Custom** profile unlocks manual target face count and ratio inputs for both tiers. See the [Mesh Performance Guide](reference/MESH_PERFORMANCE_GUIDE.md) for detailed face count budgets by device and object size.

## Post-Processing Effects

The editor includes optional post-processing effects accessible from the Scene Settings panel:

- **SSAO** (Screen Space Ambient Occlusion) — adds depth perception to mesh surfaces via the `SSAOPass`
- **Bloom** — HDR glow effect via `UnrealBloomPass` for emissive and bright surfaces
- **Vignette** — corner darkening with adjustable falloff
- **Chromatic Aberration** — subtle RGB channel separation
- **Film Grain** — noise overlay for cinematic feel

Effects are combined in a custom uber-shader and are opt-in. They apply to meshes and point clouds but not to Gaussian splats (Spark.js uses a custom shader incompatible with the post-processing pipeline).

## Recording

Capture video and GIF recordings of the 3D scene:

- **Turntable** — automated 360-degree spin recording
- **Walkthrough** — records the guided walkthrough playback
- **Annotation Tour** — flies through each annotation sequentially
- **Free** — manual camera recording with start/stop controls

Recordings are captured as WebM via the MediaRecorder API, then uploaded to the server-side FFmpeg pipeline for transcoding to MP4 and GIF. An inline trim UI with start/end scrubber handles allows adjusting the clip before upload.

## Scene Settings

- **Grid** — Toggle a reference grid
- **Background color** — Choose from presets (dark blue, near black, grays, light gray) or pick a custom color. Per-asset-type background overrides available (splat, model, point cloud)
- **Background image** — Load a background image from file or URL; clears when switching to environment-as-background
- **Lighting** — Adjust ambient, hemisphere, and two directional lights (affects models and point clouds only)
- **Tone mapping** — 6 modes: None (default), Linear, Reinhard, Cineon, ACESFilmic, AgX. Exposure slider (0.1–3.0). Default is None for neutral rendering; opt-in to cinematic looks
- **HDR environment maps (IBL)** — 3 built-in presets (Outdoor, Studio, Sunset) plus load from `.hdr` file or URL. Provides image-based lighting for realistic reflections and ambient light
- **Environment as background** — Toggle to display the HDR environment map as a skybox behind the scene (mutually exclusive with solid color and background image)
- **Shadows** — Toggle shadow casting with VSM (Variance Shadow Maps, 2048px). Automatically creates a shadow catcher ground plane with adjustable opacity (0.05–1.0). Auto-enabled in kiosk mode

## Screenshots

- **Capture Screenshot** — Captures a 1024x1024 JPEG of the current viewport. Screenshots appear as thumbnails below the button with a red X to delete
- **Set Archive Preview Image** — Opens a viewfinder overlay showing the square crop region. Capture from the viewfinder to override the automatic preview generated during archive export
- **Archive export** — All captured screenshots are bundled into the archive's `/screenshots/` directory on export

## Camera Constraints

The editor includes camera constraint controls for locking orbit behavior in kiosk mode:

- **Lock Orbit** — Prevent camera rotation
- **Lock Pan** — Prevent camera panning
- **Lock Zoom** — Prevent camera zoom
- **Max Height** — Set a maximum camera elevation angle

Constraints are saved in the archive manifest and applied automatically when the archive is loaded in kiosk mode.

## Asset-Specific Settings

**Splat**: Scale, position, rotation

**Model**: Scale, opacity, wireframe toggle, position, rotation

**Point Cloud**: Scale, point size, opacity, position, rotation

## Transform Controls

- **Rotation pivot** — Toggle between rotating around the object's own center vs. the world origin
- **Scale lock** — When enabled, scaling adjusts all three axes proportionally
- **Center at origin** — Button that snaps the object's position to the world origin

## Metadata

The metadata sidebar (press `M` or click the Metadata toolbar button) provides Dublin Core-compatible fields for documenting the scene:

- **Tags** — Appear as chips in the kiosk viewer below the project description
- **Coordinates** — Has an interactive **map picker**: clicking it opens an OpenStreetMap modal where you can click to place a pin or search by name; coordinates are filled in automatically
- **Metadata completeness profile** — A selector (Basic / Standard / Archival) controls which metadata tabs and fields are visible. Basic shows essential fields only; Archival shows all preservation fields

Metadata is saved in archives and displayed read-only in the kiosk viewer.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `W` | Translate mode |
| `E` | Rotate mode |
| `R` | Scale mode |
| `A` | Toggle annotation placement mode |
| `M` | Toggle metadata sidebar |
| `F` | Toggle fly camera mode |
| `Escape` | Deselect object / exit fly mode / close popups |

## Toolbar

The left-side toolbar provides quick access to:

| Button | Action |
|--------|--------|
| Toggle Controls (hamburger icon) | Show/hide the controls panel |
| Metadata | Open the metadata sidebar for viewing or editing |
| Annotate | Enter annotation placement mode |
| Toggle Annotations | Show/hide annotation markers (visible when annotations exist) |
| Fly Camera | Switch to first-person fly camera |
| Auto-Rotate | Toggle turntable auto-rotation (disabled by default in main app) |
| Load Full Resolution | Swap LOD proxy mesh for the full-resolution version (appears only when a proxy mesh is loaded) |
| Export Archive | Export the current scene as a .ddim archive |
| Fullscreen | Toggle browser fullscreen mode |
| Reset Orbit Center | Reset the orbit pivot point to the bounding box center of loaded meshes/point clouds |
| Cross-Section | Toggle cross-section clipping plane tool |
| Measurement | Toggle point-to-point distance measurement tool |
| Walkthrough | Open the walkthrough editor/player panel |
| Enter VR | Enter WebXR VR mode (visible only when WebXR is available) |
