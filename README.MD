# Gaussian Splat & Mesh Viewer

A simple web-based viewer for comparing Gaussian splat files (PLY/Splat) with traditional 3D models (glTF/OBJ).

## Features

- Load and display Gaussian splat files (.ply, .splat, .ksplat)
- Load and display 3D models (.glb, .gltf, .obj)
- Toggle between viewing: Splat only, Model only, or Both overlaid
- Adjustable scale and opacity for both splat and model
- Wireframe mode for models
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

1. **Load a Gaussian Splat**: Click "Choose PLY/Splat File" and select a .ply, .splat, or .ksplat file
2. **Load a 3D Model**: Click "Choose glTF/OBJ File" and select a .glb, .gltf, or .obj file
3. **Toggle Display Mode**: Use the Splat/Model/Both buttons to switch views
4. **Adjust Settings**: Use sliders to modify scale and opacity
5. **Camera Controls**:
   - Left click + drag: Rotate
   - Right click + drag: Pan
   - Scroll: Zoom
   - "Reset Camera": Return to default view
   - "Fit to View": Auto-frame the loaded content

## Supported Formats

### Gaussian Splats
- `.ply` - Standard PLY format with Gaussian splat data
- `.splat` - Compressed splat format
- `.ksplat` - Compressed splat format

### 3D Models
- `.glb` - Binary glTF
- `.gltf` - glTF with external resources
- `.obj` - Wavefront OBJ (optionally with .mtl materials)

## Technologies Used

- [Three.js](https://threejs.org/) - 3D rendering
- [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) - Gaussian splat rendering
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
