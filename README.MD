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

### Using the included server script
```bash
npm install
npm start
```

## Usage

### Loading Files
1. **Load a Gaussian Splat**: Click "Choose Splat File" and select a .ply, .splat, .ksplat, .spz, or .sog file
2. **Load a 3D Model**: Click "Choose glTF/OBJ File" and select a .glb, .gltf, or .obj file

### Display Modes
- **Splat**: Show only the Gaussian splat
- **Model**: Show only the 3D model
- **Both**: Overlay both (useful for comparison)

### Transform Controls
1. Select which object to transform: **Splat** or **Model** (or None to disable)
2. Choose transform mode: **Move**, **Rotate**, or **Scale**
3. Drag the gizmo handles in the 3D view, or use the input fields in the panel

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
- Vanilla JavaScript (ES Modules)

## Browser Compatibility

Requires a modern browser with WebGL 2.0 support:
- Chrome 79+
- Firefox 72+
- Safari 15+
- Edge 79+

## Future Plans

- Docker containerization for easy deployment
- URL-based file loading
- Multiple splat/model comparison
- Animation playback for glTF models
