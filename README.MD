# Gaussian Splat & Mesh Viewer

A simple web-based viewer for comparing Gaussian splat files with traditional 3D models, powered by [Spark](https://sparkjs.dev/) and Three.js.

## Features

- Load and display Gaussian splat files (.ply, .splat, .ksplat, .spz, .sog)
- Load and display 3D models (.glb, .gltf, .obj)
- Toggle between viewing: Splat only, Model only, or Both overlaid
- **Transform controls** for individually positioning, rotating, and scaling each object
- **Save/Load alignment** to preserve your transforms as JSON
- Manual position and rotation input fields for precise alignment
- Wireframe mode and adjustable opacity for models
- Orbit camera controls (rotate, pan, zoom)
- FPS counter and mesh statistics

## Quick Start

### Using Python (simplest)
```bash
cd simple-splat-mesh-viewer
python3 -m http.server 8080
```
Then open http://localhost:8080 in your browser.

### Using Node.js
```bash
npx serve .
```

### Using Docker
```bash
# Build the image
docker build -t splat-mesh-viewer .

# Run with default settings
docker run -p 8080:80 splat-mesh-viewer

# Run with pre-loaded files and hidden controls
docker run -p 8080:80 \
  -e DEFAULT_SPLAT_URL="https://example.com/model.ply" \
  -e DEFAULT_MODEL_URL="https://example.com/model.glb" \
  -e SHOW_CONTROLS="false" \
  splat-mesh-viewer
```

## Docker Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_SPLAT_URL` | `""` | URL to a Gaussian splat file to load on startup |
| `DEFAULT_MODEL_URL` | `""` | URL to a 3D model file to load on startup |
| `SHOW_CONTROLS` | `true` | Show (`true`) or hide (`false`) the controls panel on startup |

### Example Docker Compose
```yaml
version: '3.8'
services:
  viewer:
    build: .
    ports:
      - "8080:80"
    environment:
      - DEFAULT_SPLAT_URL=https://sparkjs.dev/assets/splats/butterfly.spz
      - DEFAULT_MODEL_URL=
      - SHOW_CONTROLS=true
```

## URL Parameters

The viewer supports URL parameters for embedding with different configurations:

| Parameter | Values | Description |
|-----------|--------|-------------|
| `splat` | URL | Path or URL to splat file to load on startup |
| `model` | URL | Path or URL to model file to load on startup |
| `controls` | `full`, `minimal`, `none` | Control panel mode |
| `mode` | `splat`, `model`, `both`, `split` | Initial display mode |

### Control Modes

- **full** - All controls visible (default)
- **minimal** - Only the display mode toggle (Splat/Model/Both/Split buttons)
- **none** - No UI at all, just the viewer

### Example URLs

```
# Main instance with full controls
https://viewer.website.com

# Pre-loaded files with minimal UI
https://viewer.website.com?splat=/assets/scene.ply&model=/assets/model.glb&controls=minimal

# Split view comparison with no controls
https://viewer.website.com?splat=/assets/scene.ply&model=/assets/model.glb&controls=none&mode=split

# Start in model-only view
https://viewer.website.com?model=/assets/model.glb&mode=model
```

## Embedding

You can embed the viewer on other pages using an iframe:

```html
<iframe
  src="https://viewer.website.com?splat=/path/to/scene.ply&model=/path/to/model.glb&controls=minimal&mode=split"
  width="100%"
  height="600"
  frameborder="0"
  allow="fullscreen">
</iframe>
```

### CORS Considerations

If your viewer is hosted at `viewer.website.com` and your files are on `website.com`, you'll need to configure CORS headers on your file server to allow cross-origin requests:

```
Access-Control-Allow-Origin: https://viewer.website.com
```

Or for development:
```
Access-Control-Allow-Origin: *
```

## Usage

### Loading Files
1. **Load a Gaussian Splat**: Click "Choose Splat File" and select a .ply, .splat, .ksplat, .spz, or .sog file
2. **Load a 3D Model**: Click "Choose glTF/OBJ File" and select a .glb, .gltf, or .obj file

### Display Modes
- **Splat**: Show only the Gaussian splat
- **Model**: Show only the 3D model
- **Both**: Overlay both (useful for comparison)
- **Split**: Side-by-side view with splat on left, model on right (synced camera)

### Transform Controls
1. Select which object to transform: **Splat**, **Model**, **Both** (synchronized), or **None** to disable
2. Choose transform mode: **Move**, **Rotate**, or **Scale**
3. Drag the gizmo handles in the 3D view, or use the input fields in the panel

**Tip:** Select **Both** to move the splat and model together after aligning them.

**Keyboard shortcuts:**
- `W` - Move mode
- `E` - Rotate mode
- `R` - Scale mode
- `Escape` - Deselect

### Alignment
- **Save Alignment**: Downloads a JSON file with current transforms
- **Load Alignment**: Loads a previously saved alignment
- **Reset All**: Resets both objects to origin with default scale

### Camera Controls
- **Left click + drag**: Rotate view
- **Right click + drag**: Pan view
- **Scroll**: Zoom in/out
- **Reset Camera**: Return to default view
- **Fit to View**: Auto-frame the loaded content

### Toggle Controls Panel
Click the settings icon in the top-right corner of the viewer to show/hide the controls panel.

## Supported Formats

### Gaussian Splats (via Spark)
- `.ply` - Standard PLY format with Gaussian splat data
- `.splat` - Compressed splat format
- `.ksplat` - Compressed splat format
- `.spz` - Spark compressed format
- `.sog` - SOG format

### 3D Models (via Three.js)
- `.glb` - Binary glTF
- `.gltf` - glTF with external resources
- `.obj` - Wavefront OBJ (optionally with .mtl materials)

## Technologies Used

- [Spark](https://sparkjs.dev/) - Advanced 3D Gaussian Splatting renderer for Three.js
- [Three.js](https://threejs.org/) - 3D rendering and model loading
- [nginx](https://nginx.org/) - Web server (Docker)
- Vanilla JavaScript (ES Modules)

## Browser Compatibility

Requires a modern browser with WebGL 2.0 support:
- Chrome 79+
- Firefox 72+
- Safari 15+
- Edge 79+
