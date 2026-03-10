/**
 * Industrial Layout — MeshLab-style CAD workbench kiosk layout module.
 *
 * No ES imports — receives ALL dependencies via the `deps` object passed to
 * setup(). Self-registers on window.__KIOSK_LAYOUTS__ for kiosk bootstrap
 * discovery (same pattern as editorial / gallery / exhibit).
 *
 * Design: MeshLab workbench. Menu bar at top, toolbar below with raised
 * Qt-style icon buttons, trackball overlay in viewport, bottom status bar
 * with vertex/face counts. Orbit-only navigation.
 */

// ---- Module-scope state ----

var THREE = null;           // Set from deps.THREE in setup()
var _deps = null;
var _activeTool = null;
var _toggles = { matcap: false, texture: true, wireframe: false, trackball: false, toolbar: true, annotations: true, grid: false, autorotate: true };

// Light widget drag state
var _lightDragging = false;
var _lightAzimuth = Math.PI / 4;
var _lightElevation = Math.PI / 4;

// DOM references
var _menubar = null;
var _toolbar = null;
var _statusBar = null;
var _lightWidget = null;
var _trackballOverlay = null;

// Walkthrough state
var _wtControls = null;         // walkthrough controls container in status bar
var _wtDots = null;             // dot container
var _wtTitleEl = null;          // stop title element
var _wtTotalStops = 0;

// Event listener refs for teardown
var _keydownHandler = null;
var _dropDragoverHandler = null;
var _dropDragleaveHandler = null;
var _dropDropHandler = null;

// Menu system state
var _openMenu = null;            // 'file' | 'view' | 'render' | 'tools' | 'help' | null
var _renderMode = 'solid';       // 'solid' | 'wireframe' | 'matcap'
var _cameraMode = 'perspective'; // 'perspective' | 'orthographic'
var _orthoCam = null;            // cached OrthographicCamera instance
var _perspCam = null;            // cached PerspectiveCamera reference
var _menuCloseListener = null;   // document mousedown listener reference
var _manifest = null;            // archive manifest (stored in setup())

// New UI references
var _panel = null;               // right info panel element
var _panelOpen = true;           // panel visible by default
var _panelToggleBtn = null;      // toolbar panel toggle button
var _modeBtns = null;            // { model, splat, pointcloud } toolbar buttons
var _viewToggles = null;         // { grid, autorotate, fly } toolbar buttons
var _qualityBtns = null;         // { sd, hd } toolbar buttons
var _bboxHelper = null;          // THREE.Box3Helper instance
var _bboxBtn = null;             // toolbar bounding box button
var _dropZone = null;            // P2 drag-and-drop empty state overlay
var _selectedLayerKey = null;    // currently selected layer asset key
var _coordRaycaster = null;      // raycaster for coordinate readout
var _coordMouseMoveHandler = null;
var _viewCubeCanvas = null;
var _viewCubeRenderer = null;
var _viewCubeScene = null;
var _viewCubeCamera = null;
var _viewCubeRafId = null;
var _normalsHelpers = [];        // ArrowHelper instances for normals viz

// FPS counter state
var _fpsLast = 0;
var _fpsFrames = 0;
var _fpsEl = null;
var _fpsRafId = null;

// ---- SVG Icons ----

var ICONS = {
    slice: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="14" height="14" rx="1"/><line x1="1" y1="10" x2="19" y2="10"/></svg>',
    measure: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="17" x2="17" y2="3"/><line x1="3" y1="17" x2="3" y2="12"/><line x1="3" y1="17" x2="8" y2="17"/><line x1="17" y1="3" x2="17" y2="8"/><line x1="17" y1="3" x2="12" y2="3"/></svg>',
    annotate: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2C7.24 2 5 4.24 5 7c0 4 5 11 5 11s5-7 5-11c0-2.76-2.24-5-5-5z"/><circle cx="10" cy="7" r="2"/></svg>',
    matcap: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><ellipse cx="8" cy="8" rx="3" ry="3" fill="currentColor" opacity="0.2"/></svg>',
    texture: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="16" height="16" rx="1"/><rect x="2" y="2" width="8" height="8" fill="currentColor" opacity="0.2"/><rect x="10" y="10" width="8" height="8" fill="currentColor" opacity="0.2"/></svg>',
    wireframe: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 14l6-10 6 10H4z"/><line x1="10" y1="4" x2="10" y2="14"/><line x1="7" y1="9" x2="13" y2="9"/></svg>',
    light: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="10" y1="16" x2="10" y2="18"/><line x1="2" y1="10" x2="4" y2="10"/><line x1="16" y1="10" x2="18" y2="10"/><line x1="4.34" y1="4.34" x2="5.76" y2="5.76"/><line x1="14.24" y1="14.24" x2="15.66" y2="15.66"/><line x1="4.34" y1="15.66" x2="5.76" y2="14.24"/><line x1="14.24" y1="5.76" x2="15.66" y2="4.34"/></svg>',
    screenshot: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="16" height="12" rx="1.5"/><circle cx="10" cy="11" r="3"/><path d="M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1"/></svg>',
    flip: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3v14M6 7l4-4 4 4M6 13l4 4 4-4"/></svg>',
    fitView: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="12" height="12" rx="1"/><path d="M2 7V3h4M14 2h4v4M18 13v4h-4M6 18H2v-4"/></svg>',
    grid: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h14M3 13h14M7 3v14M13 3v14"/></svg>',
    autoRotate: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 10a6 6 0 1 0 6-6"/><path d="M7 1l3 3-3 3"/></svg>',
    fly: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="1.5" fill="currentColor"/><line x1="10" y1="3" x2="10" y2="7"/><line x1="10" y1="13" x2="10" y2="17"/><line x1="3" y1="10" x2="7" y2="10"/><line x1="13" y1="10" x2="17" y2="10"/></svg>',
    panel: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="16" height="14" rx="1"/><line x1="13" y1="3" x2="13" y2="17"/></svg>',
    mesh: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3l7 4v6l-7 4-7-4V7z"/><path d="M10 3v14M3 7l7 4 7-4"/></svg>',
    splat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="1.5" fill="currentColor"/><circle cx="5" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7" r="1" fill="currentColor"/><circle cx="5" cy="13" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><circle cx="10" cy="4" r="0.75" fill="currentColor"/><circle cx="10" cy="16" r="0.75" fill="currentColor"/></svg>',
    cloud: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="13" r="1" fill="currentColor"/><circle cx="10" cy="11" r="1" fill="currentColor"/><circle cx="14" cy="13" r="1" fill="currentColor"/><circle cx="8" cy="15" r="1" fill="currentColor"/><circle cx="12" cy="15" r="1" fill="currentColor"/><circle cx="7" cy="9" r="0.75" fill="currentColor"/><circle cx="13" cy="9" r="0.75" fill="currentColor"/><circle cx="10" cy="7" r="0.75" fill="currentColor"/></svg>',
    bbox: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3l7 4v6l-7 4-7-4V7z"/><line x1="10" y1="3" x2="10" y2="17" stroke-dasharray="2 2"/><line x1="3" y1="7" x2="17" y2="7" stroke-dasharray="2 2"/></svg>',
    upload: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13V4M7 7l3-3 3 3"/><path d="M4 14v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg>'
};

// ---- Helpers ----

function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return null;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatNumber(n) {
    if (!n && n !== 0) return null;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

function countVertices(group) {
    var total = 0;
    if (!group) return total;
    group.traverse(function (child) {
        if (child.isMesh && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
            total += child.geometry.attributes.position.count;
        }
    });
    return total;
}

function countFaces(group) {
    var total = 0;
    if (!group) return total;
    group.traverse(function (child) {
        if (child.isMesh && child.geometry) {
            if (child.geometry.index) {
                total += child.geometry.index.count / 3;
            } else if (child.geometry.attributes && child.geometry.attributes.position) {
                total += child.geometry.attributes.position.count / 3;
            }
        }
    });
    return Math.floor(total);
}

function createEl(tag, className, innerHTML) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML) el.innerHTML = innerHTML;
    return el;
}

function closeAllMenus() {
    if (!_openMenu) return;
    var items = document.querySelectorAll('.ind-menu-item.open');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('open');
    _openMenu = null;
}

/** Create a dropdown menu item. hint is optional keyboard shortcut text. */
function ddItem(label, hint, action, extraClass) {
    var el = createEl('div', 'ind-dd-item' + (extraClass ? ' ' + extraClass : ''), label);
    if (hint) {
        var hintEl = createEl('span', 'ind-dd-hint', hint);
        el.appendChild(hintEl);
    }
    el.addEventListener('click', function(e) {
        e.stopPropagation();
        closeAllMenus();
        if (action) action();
    });
    return el;
}

/** Create a dropdown separator. */
function ddSep() {
    return createEl('div', 'ind-dd-sep');
}

// ---- Tool activation / deactivation ----

function activateTool(name) {
    if (_activeTool === name) {
        deactivateTool(name);
        return;
    }
    if (_activeTool) deactivateTool(_activeTool);
    _activeTool = name;

    // Mark button active
    var btn = _toolbar ? _toolbar.querySelector('[data-tool="' + name + '"]') : null;
    if (btn) btn.classList.add('active');

    if (name === 'slice') {
        if (_deps.crossSection) {
            if (_deps.setLocalClippingEnabled) _deps.setLocalClippingEnabled(true);
            var center = { x: 0, y: 0, z: 0 };
            if (_deps.modelGroup && _deps.modelGroup.children.length > 0) {
                _deps.modelGroup.traverse(function (child) {
                    if (child.isMesh && child.geometry) {
                        child.geometry.computeBoundingBox();
                        var bb = child.geometry.boundingBox;
                        if (bb) {
                            center.x = (bb.min.x + bb.max.x) / 2;
                            center.y = (bb.min.y + bb.max.y) / 2;
                            center.z = (bb.min.z + bb.max.z) / 2;
                        }
                    }
                });
            }
            _deps.crossSection.start(center);
        }
        if (_panel && _panel._crossSectionEl) _panel._crossSectionEl.style.display = '';
    } else if (name === 'measure') {
        if (_deps.measurementSystem) _deps.measurementSystem.setMeasureMode(true);
    } else if (name === 'annotate') {
        if (_deps.annotationSystem) _deps.annotationSystem.enablePlacementMode();
    } else if (name === 'light') {
        if (_lightWidget) _lightWidget.classList.add('visible');
    }
}

function deactivateTool(name) {
    if (!name) return;

    var btn = _toolbar ? _toolbar.querySelector('[data-tool="' + name + '"]') : null;
    if (btn) btn.classList.remove('active');

    if (name === 'slice') {
        if (_deps.crossSection) _deps.crossSection.stop();
        if (_deps.setLocalClippingEnabled) _deps.setLocalClippingEnabled(false);
        if (_panel && _panel._crossSectionEl) _panel._crossSectionEl.style.display = 'none';
    } else if (name === 'measure') {
        if (_deps.measurementSystem) _deps.measurementSystem.setMeasureMode(false);
    } else if (name === 'annotate') {
        if (_deps.annotationSystem) _deps.annotationSystem.disablePlacementMode();
    } else if (name === 'light') {
        if (_lightWidget) _lightWidget.classList.remove('visible');
    }

    if (_activeTool === name) _activeTool = null;
}

function deactivateAllTools() {
    if (_activeTool) deactivateTool(_activeTool);
}

function updateQualityButtons() {
    if (!_qualityBtns || !_deps) return;
    var tier = (_deps.state && _deps.state.qualityResolved) || 'hd';
    _qualityBtns.sd.classList.toggle('active', tier === 'sd');
    _qualityBtns.hd.classList.toggle('active', tier === 'hd');
}

function toggleInfoPanel() {
    _panelOpen = !_panelOpen;
    if (_panel) _panel.classList.toggle('hidden', !_panelOpen);
    document.body.classList.toggle('ind-panel-open', _panelOpen);
}

function updateModeButtons(mode) {
    if (!_modeBtns) return;
    var m = mode || (_deps && _deps.state && _deps.state.displayMode) || 'model';
    Object.keys(_modeBtns).forEach(function(k) {
        _modeBtns[k].classList.toggle('active', k === m);
    });
}

function updateModeButtonVisibility() {
    if (!_modeBtns || !_deps) return;
    var hasModel = (_deps.modelGroup && _deps.modelGroup.children.length > 0) || _deps.hasMesh;
    var hasSplat = _deps.hasSplat || false;
    var hasPointcloud = (_deps.pointcloudGroup && _deps.pointcloudGroup.children.length > 0);

    if (_modeBtns.model) _modeBtns.model.style.display = hasModel ? '' : 'none';
    if (_modeBtns.splat) _modeBtns.splat.style.display = hasSplat ? '' : 'none';
    if (_modeBtns.pointcloud) _modeBtns.pointcloud.style.display = hasPointcloud ? '' : 'none';

    // Hide mode group + preceding separator if no buttons visible
    var modeGroup = _modeBtns.model ? _modeBtns.model.parentElement : null;
    if (modeGroup) {
        var anyVisible = hasModel || hasSplat || hasPointcloud;
        modeGroup.style.display = anyVisible ? '' : 'none';
        var prevSep = modeGroup.previousElementSibling;
        if (prevSep && prevSep.classList.contains('ind-toolbar-sep')) {
            prevSep.style.display = anyVisible ? '' : 'none';
        }
    }
}

function startFpsCounter() {
    stopFpsCounter();
    _fpsEl = document.getElementById('ind-status-fps');
    function tick(now) {
        if (!_fpsEl || !_fpsEl.isConnected) { _fpsRafId = null; return; }
        _fpsFrames++;
        var elapsed = now - _fpsLast;
        if (elapsed >= 1000) {
            var fps = Math.round(_fpsFrames * 1000 / elapsed);
            _fpsFrames = 0;
            _fpsLast = now;
            _fpsEl.textContent = fps + ' fps';
        }
        _fpsRafId = requestAnimationFrame(tick);
    }
    _fpsRafId = requestAnimationFrame(function(now) {
        _fpsLast = now;
        _fpsRafId = requestAnimationFrame(tick);
    });
}

function stopFpsCounter() {
    if (_fpsRafId != null) { cancelAnimationFrame(_fpsRafId); _fpsRafId = null; }
}

function toggleTool(name) {
    if (_activeTool === name) {
        deactivateTool(name);
    } else {
        activateTool(name);
    }
}

// ---- Display toggles ----

function toggleDisplay(name) {
    _toggles[name] = !_toggles[name];

    var btn = _toolbar ? _toolbar.querySelector('[data-toggle="' + name + '"]') : null;
    if (btn) {
        btn.classList.toggle('active', _toggles[name]);
        btn.setAttribute('aria-pressed', String(_toggles[name]));
    }

    if (name === 'matcap' && _deps.updateModelMatcap) {
        _deps.updateModelMatcap(_deps.modelGroup, _toggles.matcap, 'clay');
    } else if (name === 'texture' && _deps.updateModelTextures) {
        _deps.updateModelTextures(_deps.modelGroup, _toggles.texture);
    } else if (name === 'wireframe' && _deps.updateModelWireframe) {
        _deps.updateModelWireframe(_deps.modelGroup, _toggles.wireframe);
    }

    // Sync _renderMode so the Render menu radio stays consistent
    if (name === 'wireframe') {
        _renderMode = _toggles.wireframe ? 'wireframe' : 'solid';
    } else if (name === 'matcap') {
        _renderMode = _toggles.matcap ? 'matcap' : 'solid';
    }
    if (typeof updateRenderMenuChecks === 'function') updateRenderMenuChecks();
}

// ---- Screenshot ----

function doScreenshot() {
    var sm = _deps && _deps.sceneManager;
    if (!sm || !sm.renderer) return;
    var renderer = sm.renderer;
    // Force a render so the drawing buffer has content
    var mode = (_deps.state && _deps.state.displayMode) || 'model';
    sm.render(mode, _deps.sparkRenderer || null, _deps.modelGroup || null, _deps.pointcloudGroup || null, null);

    var srcCanvas = renderer.domElement;

    // Composite annotation markers onto the screenshot
    var markers = document.querySelectorAll('.annotation-marker');
    var visibleMarkers = [];
    markers.forEach(function(marker) {
        if (marker.style.display !== 'none' && !marker.classList.contains('hidden')) {
            visibleMarkers.push(marker);
        }
    });

    if (visibleMarkers.length === 0) {
        // No markers — direct download
        srcCanvas.toBlob(function(blob) {
            if (!blob) return;
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'screenshot-' + Date.now() + '.png';
            a.click();
            setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
        }, 'image/png');
        return;
    }

    // Composite markers onto a 2D canvas
    var composite = document.createElement('canvas');
    composite.width = srcCanvas.width;
    composite.height = srcCanvas.height;
    var ctx = composite.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);

    var srcRect = srcCanvas.getBoundingClientRect();
    var scaleX = srcCanvas.width / srcRect.width;
    var scaleY = srcCanvas.height / srcRect.height;

    visibleMarkers.forEach(function(marker) {
        var mr = marker.getBoundingClientRect();
        var cx = (mr.left + mr.width / 2 - srcRect.left) * scaleX;
        var cy = (mr.top + mr.height / 2 - srcRect.top) * scaleY;
        var r = (mr.width / 2) * scaleX;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 140, 0, 0.85)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        var label = marker.textContent && marker.textContent.trim();
        if (label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold ' + Math.round(r * 1.2) + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, cx, cy);
        }
    });

    composite.toBlob(function(blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'screenshot-' + Date.now() + '.png';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }, 'image/png');
}

// ---- Coordinate readout ----

function startCoordReadout() {
    if (!_deps || !_deps.sceneManager) return;
    _coordRaycaster = new THREE.Raycaster();
    var canvas = _deps.sceneManager.renderer.domElement;
    _coordMouseMoveHandler = function(e) {
        var rect = canvas.getBoundingClientRect();
        var nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        var ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
        _coordRaycaster.setFromCamera({ x: nx, y: ny }, _deps.sceneManager.camera);
        var targets = [_deps.modelGroup, _deps.pointcloudGroup].filter(Boolean);
        var hits = _coordRaycaster.intersectObjects(targets, true);
        var el = document.getElementById('ind-status-coords');
        if (!el) return;
        if (hits.length > 0) {
            var p = hits[0].point;
            el.textContent = 'X: ' + p.x.toFixed(3) + '  Y: ' + p.y.toFixed(3) + '  Z: ' + p.z.toFixed(3);
        } else {
            el.textContent = 'X: \u2014  Y: \u2014  Z: \u2014';
        }
    };
    canvas.addEventListener('mousemove', _coordMouseMoveHandler);
}

// ---- View presets ----

function applyViewPreset(axis) {
    setCameraPreset(axis);
    if (_cameraMode !== 'orthographic') toggleOrthographic();
}

function setIsoView() {
    if (!_deps || !_deps.sceneManager) return;
    var camera = _deps.sceneManager.camera;
    var controls = _deps.sceneManager.controls;
    var target = controls.target;
    var dist = camera.position.distanceTo(target);
    var d = dist / Math.sqrt(3);
    camera.position.set(target.x + d, target.y + d, target.z + d);
    camera.lookAt(target);
    if (controls.update) controls.update();
}

// ---- View cube ----

function createViewCube() {
    _viewCubeCanvas = document.createElement('canvas');
    _viewCubeCanvas.width = 120;
    _viewCubeCanvas.height = 120;
    _viewCubeCanvas.className = 'ind-view-cube';
    document.body.appendChild(_viewCubeCanvas);

    _viewCubeRenderer = new THREE.WebGLRenderer({ canvas: _viewCubeCanvas, alpha: true, antialias: true });
    _viewCubeRenderer.setSize(120, 120);
    _viewCubeRenderer.setClearColor(0x000000, 0);

    _viewCubeScene = new THREE.Scene();
    _viewCubeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    _viewCubeCamera.position.set(0, 0, 3);

    // Wireframe box
    var boxGeo = new THREE.BoxGeometry(1, 1, 1);
    var edges = new THREE.EdgesGeometry(boxGeo);
    var lineMat = new THREE.LineBasicMaterial({ color: 0x888888 });
    _viewCubeScene.add(new THREE.LineSegments(edges, lineMat));

    // Colored face planes with canvas-rendered labels
    var faceData = [
        { label: 'RIGHT', color: 0xcc4444, dir: [1,0,0],  rot: [0, -Math.PI/2, 0] },
        { label: 'LEFT',  color: 0xcc4444, dir: [-1,0,0], rot: [0,  Math.PI/2, 0] },
        { label: 'TOP',   color: 0x44cc44, dir: [0,1,0],  rot: [-Math.PI/2, 0, 0] },
        { label: 'BTM',   color: 0x44cc44, dir: [0,-1,0], rot: [ Math.PI/2, 0, 0] },
        { label: 'FRONT', color: 0x4488cc, dir: [0,0,1],  rot: [0, 0, 0] },
        { label: 'BACK',  color: 0x4488cc, dir: [0,0,-1], rot: [0, Math.PI, 0] }
    ];
    faceData.forEach(function(f) {
        var planeGeo = new THREE.PlaneGeometry(0.9, 0.9);
        var tc = document.createElement('canvas');
        tc.width = 64; tc.height = 64;
        var ctx2d = tc.getContext('2d');
        ctx2d.fillStyle = '#' + f.color.toString(16).padStart(6, '0') + '44';
        ctx2d.fillRect(0, 0, 64, 64);
        ctx2d.fillStyle = '#ffffff';
        ctx2d.font = 'bold 11px sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.textBaseline = 'middle';
        ctx2d.fillText(f.label, 32, 32);
        var tex = new THREE.CanvasTexture(tc);
        var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
        var mesh = new THREE.Mesh(planeGeo, mat);
        mesh.position.set(f.dir[0]*0.5, f.dir[1]*0.5, f.dir[2]*0.5);
        mesh.rotation.set(f.rot[0], f.rot[1], f.rot[2]);
        mesh.userData.viewPreset = f.label;
        _viewCubeScene.add(mesh);
    });

    // Animate: mirror main camera quaternion
    function animateCube() {
        _viewCubeRafId = requestAnimationFrame(animateCube);
        var mainCam = _deps && _deps.sceneManager && _deps.sceneManager.camera;
        if (mainCam) {
            _viewCubeCamera.quaternion.copy(mainCam.quaternion);
        }
        _viewCubeRenderer.render(_viewCubeScene, _viewCubeCamera);
    }
    animateCube();

    // Click: raycast against face planes to trigger view preset
    var cubeRaycaster = new THREE.Raycaster();
    _viewCubeCanvas.addEventListener('click', function(e) {
        var rect = _viewCubeCanvas.getBoundingClientRect();
        var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        var ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        cubeRaycaster.setFromCamera({ x: nx, y: ny }, _viewCubeCamera);
        var hits = cubeRaycaster.intersectObjects(_viewCubeScene.children, false);
        if (hits.length > 0 && hits[0].object.userData.viewPreset) {
            var label = hits[0].object.userData.viewPreset;
            var presetMap = { 'TOP': '+y', 'BTM': '-y', 'FRONT': '+z', 'BACK': '-z', 'RIGHT': '-x', 'LEFT': '+x' };
            var axis = presetMap[label];
            if (axis) applyViewPreset(axis);
        }
    });
}

// ---- Normals visualization ----

function toggleNormals() {
    if (!_deps || !_deps.sceneManager || !_deps.modelGroup) return;
    var scene = _deps.sceneManager.scene;

    if (_normalsHelpers.length > 0) {
        // Remove existing
        _normalsHelpers.forEach(function(h) { scene.remove(h); h.dispose(); });
        _normalsHelpers = [];
        return false;
    }

    // Add normal arrows — sample every Nth face, cap at 5000
    var arrows = [];
    _deps.modelGroup.traverse(function(child) {
        if (!child.isMesh || !child.geometry) return;
        var geo = child.geometry;
        var pos = geo.attributes.position;
        if (!pos) return;
        geo.computeVertexNormals();
        var norm = geo.attributes.normal;
        if (!norm) return;

        var idx = geo.index;
        var faceCount = idx ? idx.count / 3 : pos.count / 3;
        var step = Math.max(1, Math.ceil(faceCount / 5000));

        for (var f = 0; f < faceCount; f += step) {
            if (arrows.length >= 5000) break;
            var i0 = idx ? idx.getX(f * 3) : f * 3;
            var cx = pos.getX(i0);
            var cy = pos.getY(i0);
            var cz = pos.getZ(i0);
            var nx = norm.getX(i0);
            var ny = norm.getY(i0);
            var nz = norm.getZ(i0);

            var origin = new THREE.Vector3(cx, cy, cz).applyMatrix4(child.matrixWorld);
            var dir = new THREE.Vector3(nx, ny, nz).transformDirection(child.matrixWorld).normalize();
            var arrow = new THREE.ArrowHelper(dir, origin, 0.02, 0x00ff00, 0.005, 0.005);
            scene.add(arrow);
            arrows.push(arrow);
        }
    });
    _normalsHelpers = arrows;
    return true;
}

// ---- Fit camera ----

function fitCamera() {
    if (_deps && _deps.resetOrbitCenter) _deps.resetOrbitCenter();
}

// ---- Light widget helpers ----

function updateLightPosition() {
    if (!_deps || !_deps.sceneManager) return;
    var light = _deps.sceneManager.directionalLight1;
    if (!light) return;
    var r = 5;
    light.position.set(
        r * Math.sin(_lightElevation) * Math.cos(_lightAzimuth),
        r * Math.cos(_lightElevation),
        r * Math.sin(_lightElevation) * Math.sin(_lightAzimuth)
    );
}

function updateLightIndicator() {
    var indicator = _lightWidget ? _lightWidget.querySelector('.ind-light-indicator') : null;
    if (!indicator) return;
    var nx = (((_lightAzimuth / Math.PI) * 0.5 + 0.5) % 1) * 100;
    var ny = (_lightElevation / Math.PI) * 100;
    indicator.style.left = nx + '%';
    indicator.style.top = ny + '%';
}

function onLightMouseDown(e) {
    e.preventDefault();
    _lightDragging = true;
    document.addEventListener('mousemove', onLightMouseMove);
    document.addEventListener('mouseup', onLightMouseUp);
}

function onLightMouseMove(e) {
    if (!_lightDragging) return;
    _lightAzimuth += e.movementX * 0.02;
    _lightElevation = Math.max(0.1, Math.min(Math.PI - 0.1, _lightElevation + e.movementY * 0.02));
    updateLightPosition();
    updateLightIndicator();
}

function onLightMouseUp() {
    _lightDragging = false;
    document.removeEventListener('mousemove', onLightMouseMove);
    document.removeEventListener('mouseup', onLightMouseUp);
}

// (Section controls are now built inside the info panel — see buildCrossSectionPanel)

// ---- Menu builders ----

// -- File Menu --

function buildFileMenu(dropdown) {
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.ddim,.a3d,.a3z,.glb,.gltf,.obj,.stl,.e57,.ply,.splat,.sog,.ksplat,.spz,.step,.stp,.iges,.igs,.csv,.kml,.kmz,.srt';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function() {
        var file = fileInput.files && fileInput.files[0];
        if (file && _deps && _deps.loadFile) _deps.loadFile(file);
        fileInput.value = '';
    });
    document.body.appendChild(fileInput);

    dropdown.appendChild(ddItem('Open File\u2026', '', function() { fileInput.click(); }));
    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('Take Screenshot', 'P', function() { doScreenshot(); }));
    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('Reset Scene', '', function() {
        if (window.confirm('Reload and reset the scene?')) window.location.reload();
    }));
}

// -- View Menu --

var _viewMenuItems = {};

function setCameraPreset(axis) {
    if (!_deps || !_deps.sceneManager) return;
    var camera = _deps.sceneManager.camera;
    var controls = _deps.sceneManager.controls;
    if (!camera || !controls) return;

    var target = controls.target;
    var dist = camera.position.distanceTo(target);

    var offsets = {
        '+z': [0, 0,  dist],
        '-z': [0, 0, -dist],
        '+x': [ dist, 0, 0],
        '-x': [-dist, 0, 0],
        '+y': [0,  dist, 0],
        '-y': [0, -dist, 0]
    };
    var o = offsets[axis] || [0, 0, dist];
    camera.position.set(target.x + o[0], target.y + o[1], target.z + o[2]);
    camera.lookAt(target);
    if (controls.update) controls.update();
}

function toggleOrthographic() {
    if (!_deps || !_deps.sceneManager) return;
    var sm = _deps.sceneManager;
    var camera = sm.camera;
    var controls = sm.controls;
    var renderer = sm.renderer;
    if (!camera || !controls || !renderer) return;

    var w = renderer.domElement.clientWidth || 800;
    var h = renderer.domElement.clientHeight || 600;
    var aspect = w / h;
    var dist = camera.position.distanceTo(controls.target);

    if (_cameraMode === 'perspective') {
        _perspCam = camera;
        var fovRad = (camera.fov || 45) * Math.PI / 180;
        var frustH = 2 * Math.tan(fovRad / 2) * dist;
        var frustW = frustH * aspect;

        if (!_orthoCam) {
            if (!THREE || !THREE.OrthographicCamera) {
                console.warn('[industrial] THREE not available, orthographic not supported');
                return;
            }
            _orthoCam = new THREE.OrthographicCamera(-frustW/2, frustW/2, frustH/2, -frustH/2, 0.01, 10000);
        }
        _orthoCam.position.copy(camera.position);
        _orthoCam.quaternion.copy(camera.quaternion);
        _orthoCam.updateProjectionMatrix();
        sm.camera = _orthoCam;
        controls.object = _orthoCam;
        _cameraMode = 'orthographic';
    } else {
        if (_perspCam) {
            _perspCam.position.copy(sm.camera.position);
            _perspCam.quaternion.copy(sm.camera.quaternion);
            sm.camera = _perspCam;
            controls.object = _perspCam;
        }
        _cameraMode = 'perspective';
    }
    updateViewMenuChecks();
}

function updateViewMenuChecks() {
    if (_viewMenuItems.ortho) _viewMenuItems.ortho.classList.toggle('checked', _cameraMode === 'orthographic');
    if (_viewMenuItems.trackball) _viewMenuItems.trackball.classList.toggle('checked', _toggles.trackball);
}

function buildViewMenu(dropdown) {
    dropdown.appendChild(ddItem('Fit to View', 'F', function() { fitCamera(); }));
    dropdown.appendChild(ddSep());

    [['Front','+z'],['Back','-z'],['Left','+x'],['Right','-x'],['Top','+y'],['Bottom','-y']].forEach(function(p) {
        dropdown.appendChild(ddItem(p[0], '', function() { setCameraPreset(p[1]); }));
    });

    dropdown.appendChild(ddSep());

    var orthoItem = ddItem('Toggle Orthographic', '', function() { toggleOrthographic(); });
    _viewMenuItems.ortho = orthoItem;
    dropdown.appendChild(orthoItem);

    dropdown.appendChild(ddSep());

    var trackballItem = ddItem('Show Orbit Guide', '', function() {
        _toggles.trackball = !_toggles.trackball;
        if (_trackballOverlay) _trackballOverlay.classList.toggle('hidden', !_toggles.trackball);
        updateViewMenuChecks();
    });
    _viewMenuItems.trackball = trackballItem;
    dropdown.appendChild(trackballItem);

    dropdown.appendChild(ddSep());

    // Orthographic view presets
    [['Top (Ortho)', '+y'], ['Front (Ortho)', '+z'], ['Right (Ortho)', '-x']].forEach(function(p) {
        dropdown.appendChild(ddItem(p[0], '', function() { applyViewPreset(p[1]); }));
    });
    dropdown.appendChild(ddItem('ISO', '', function() {
        if (_cameraMode === 'orthographic') toggleOrthographic();
        setIsoView();
    }));
}

// -- Render Menu --

var _renderMenuItems = {};

function updateRenderMenuChecks() {
    ['solid','wireframe','matcap'].forEach(function(mode) {
        if (_renderMenuItems[mode]) _renderMenuItems[mode].classList.toggle('radio-active', _renderMode === mode);
    });
    if (_renderMenuItems.texture) _renderMenuItems.texture.classList.toggle('checked', _toggles.texture);
}

function syncToolbarRenderButtons() {
    var btnW = _toolbar ? _toolbar.querySelector('[data-toggle="wireframe"]') : null;
    var btnM = _toolbar ? _toolbar.querySelector('[data-toggle="matcap"]') : null;
    var btnT = _toolbar ? _toolbar.querySelector('[data-toggle="texture"]') : null;
    if (btnW) btnW.classList.toggle('active', _toggles.wireframe);
    if (btnM) btnM.classList.toggle('active', _toggles.matcap);
    if (btnT) btnT.classList.toggle('active', _toggles.texture);
}

function buildRenderMenu(dropdown) {
    function setRenderMode(mode) {
        _renderMode = mode;
        if (!_deps) return;
        _toggles.wireframe = mode === 'wireframe';
        _toggles.matcap = mode === 'matcap';
        if (_deps.updateModelWireframe) _deps.updateModelWireframe(_deps.modelGroup, _toggles.wireframe);
        if (_deps.updateModelMatcap) _deps.updateModelMatcap(_deps.modelGroup, _toggles.matcap, 'clay');
        updateRenderMenuChecks();
        syncToolbarRenderButtons();
    }

    var solidItem = ddItem('Solid', '', function() { setRenderMode('solid'); });
    solidItem.classList.add('radio-active');
    _renderMenuItems.solid = solidItem;

    var wireItem = ddItem('Wireframe', 'W', function() { setRenderMode('wireframe'); });
    _renderMenuItems.wireframe = wireItem;

    var matcapItem = ddItem('Clay Material', 'M', function() { setRenderMode('matcap'); });
    _renderMenuItems.matcap = matcapItem;

    dropdown.appendChild(solidItem);
    dropdown.appendChild(wireItem);
    dropdown.appendChild(matcapItem);
    dropdown.appendChild(ddSep());

    var texItem = ddItem('Toggle Texture', 'T', function() {
        _toggles.texture = !_toggles.texture;
        if (_deps && _deps.updateModelTextures) _deps.updateModelTextures(_deps.modelGroup, _toggles.texture);
        updateRenderMenuChecks();
        syncToolbarRenderButtons();
    });
    texItem.classList.add('checked');
    _renderMenuItems.texture = texItem;
    dropdown.appendChild(texItem);

    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('Light Direction', 'L', function() { toggleTool('light'); }));

    dropdown.appendChild(ddSep());
    var normalsItem = ddItem('Show Normals', '', function() {
        var active = toggleNormals();
        normalsItem.classList.toggle('checked', active);
    });
    _renderMenuItems.normals = normalsItem;
    dropdown.appendChild(normalsItem);
}

// -- Tools Menu --

var _toolsMenuItems = {};

function updateToolsMenuChecks() {
    if (_toolsMenuItems.annotations) _toolsMenuItems.annotations.classList.toggle('checked', _toggles.annotations);
}

function buildToolsMenu(dropdown) {
    dropdown.appendChild(ddItem('Section Plane', '1', function() { activateTool('slice'); }));
    dropdown.appendChild(ddItem('Measure', '2', function() { activateTool('measure'); }));
    dropdown.appendChild(ddItem('Annotate', '3', function() { activateTool('annotate'); }));
    dropdown.appendChild(ddSep());

    var annoItem = ddItem('Show Annotations', '', function() {
        _toggles.annotations = !_toggles.annotations;
        if (_deps && _deps.annotationSystem) {
            if (typeof _deps.annotationSystem.setVisible === 'function') {
                _deps.annotationSystem.setVisible(_toggles.annotations);
            } else if (typeof _deps.annotationSystem.setMarkersVisible === 'function') {
                _deps.annotationSystem.setMarkersVisible(_toggles.annotations);
            }
        }
        updateToolsMenuChecks();
    });
    annoItem.classList.add('checked');
    _toolsMenuItems.annotations = annoItem;
    dropdown.appendChild(annoItem);
}

// -- Help Menu --

var SHORTCUTS = [
    { key: '1',      desc: 'Section Plane' },
    { key: '2',      desc: 'Measure' },
    { key: '3',      desc: 'Annotate' },
    { key: 'T',      desc: 'Toggle Texture' },
    { key: 'W',      desc: 'Toggle Wireframe' },
    { key: 'M',      desc: 'Toggle Clay Material' },
    { key: 'L',      desc: 'Light Direction' },
    { key: 'G',      desc: 'Toggle Grid' },
    { key: 'P',      desc: 'Take Screenshot' },
    { key: 'B',      desc: 'Toggle Bounds' },
    { key: 'F',      desc: 'Fit to View' },
    { key: 'Escape', desc: 'Deactivate Tool / Close Menu' }
];

function showShortcutsOverlay() {
    var overlay = createEl('div', 'ind-shortcuts-overlay');
    var panel = createEl('div', 'ind-shortcuts-panel');
    var title = createEl('div', 'ind-shortcuts-title', 'Keyboard Shortcuts');
    var table = createEl('div', 'ind-shortcuts-table');

    SHORTCUTS.forEach(function(s) {
        var row = createEl('div', 'ind-shortcuts-row');
        var key = createEl('span', 'ind-shortcuts-key', s.key);
        var desc = createEl('span', 'ind-shortcuts-desc', s.desc);
        row.appendChild(key);
        row.appendChild(desc);
        table.appendChild(row);
    });

    var closeBtn = createEl('button', 'ind-shortcuts-close', 'Close');

    function dismiss() { document.body.removeChild(overlay); }
    closeBtn.addEventListener('click', dismiss);
    overlay.addEventListener('mousedown', function(e) {
        if (e.target === overlay) dismiss();
    });

    var escHandler = function(e) {
        if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    panel.appendChild(title);
    panel.appendChild(table);
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}

function showAboutOverlay() {
    var overlay = createEl('div', 'ind-about-overlay');
    var panel = createEl('div', 'ind-about-panel');
    var title = createEl('div', 'ind-about-title', 'About');
    var body = createEl('div', 'ind-about-body');

    var esc = (_deps && _deps.escapeHtml) || function(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    var name = (_manifest && _manifest.title) || 'Vitrine3D Industrial Viewer';
    var version = (_manifest && _manifest.version) || '\u2014';
    body.innerHTML = '<strong>' + esc(name) + '</strong><br>Theme: Industrial (MeshLab Workbench)<br>Version: ' + esc(version);

    var closeBtn = createEl('button', 'ind-about-close', 'Close');
    function dismiss() { document.body.removeChild(overlay); }
    closeBtn.addEventListener('click', dismiss);
    overlay.addEventListener('mousedown', function(e) { if (e.target === overlay) dismiss(); });
    var escHandler = function(e) {
        if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}

function buildHelpMenu(dropdown) {
    dropdown.appendChild(ddItem('Keyboard Shortcuts', '', function() { showShortcutsOverlay(); }));
    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('About', '', function() { showAboutOverlay(); }));
}

// ---- DOM creation ----

function createMenuBar() {
    var bar = createEl('div', 'ind-menubar');
    bar.setAttribute('role', 'menubar');

    var menuDefs = [
        { id: 'file',   label: 'File' },
        { id: 'view',   label: 'View' },
        { id: 'render', label: 'Render' },
        { id: 'tools',  label: 'Tools' },
        { id: 'help',   label: 'Help' }
    ];

    menuDefs.forEach(function(def) {
        var item = createEl('div', 'ind-menu-item', def.label);
        item.dataset.menu = def.id;
        item.setAttribute('role', 'menuitem');
        item.setAttribute('aria-haspopup', 'true');
        item.setAttribute('tabindex', '0');

        var dropdown = createEl('div', 'ind-dropdown');
        dropdown.dataset.menuFor = def.id;
        dropdown.setAttribute('role', 'menu');
        item.appendChild(dropdown);

        if (def.id === 'file')   buildFileMenu(dropdown);
        if (def.id === 'view')   buildViewMenu(dropdown);
        if (def.id === 'render') buildRenderMenu(dropdown);
        if (def.id === 'tools')  buildToolsMenu(dropdown);
        if (def.id === 'help')   buildHelpMenu(dropdown);

        item.addEventListener('click', function(e) {
            e.stopPropagation();
            var isOpen = item.classList.contains('open');
            closeAllMenus();
            if (!isOpen) {
                item.classList.add('open');
                _openMenu = def.id;
            }
        });

        bar.appendChild(item);
    });

    // Close on outside click
    _menuCloseListener = function(e) {
        if (!e.target.closest('.ind-menu-item')) closeAllMenus();
    };
    document.addEventListener('click', _menuCloseListener);

    // Close on Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeAllMenus();
    });

    return bar;
}

function createToolbar() {
    var toolbar = createEl('div', 'ind-toolbar');

    // Inspection tools group
    var inspGroup = createEl('div', 'ind-toolbar-group');
    inspGroup.appendChild(createToolBtn('slice', 'Cross-Section [1]', ICONS.slice));
    inspGroup.appendChild(createToolBtn('measure', 'Measure Distance [2]', ICONS.measure));
    inspGroup.appendChild(createToolBtn('annotate', 'Add Annotation [3]', ICONS.annotate));
    toolbar.appendChild(inspGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // Render toggles group
    var dispGroup = createEl('div', 'ind-toolbar-group');
    dispGroup.appendChild(createToggleBtn('matcap', 'Clay Material [M]', ICONS.matcap));
    dispGroup.appendChild(createToggleBtn('texture', 'Texture [T]', ICONS.texture));
    dispGroup.appendChild(createToggleBtn('wireframe', 'Wireframe [W]', ICONS.wireframe));
    toolbar.appendChild(dispGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // Utility group
    var utilGroup = createEl('div', 'ind-toolbar-group');
    utilGroup.appendChild(createToolBtn('light', 'Light Direction [L]', ICONS.light));
    utilGroup.appendChild(createActionBtn('screenshot', 'Screenshot [P]', ICONS.screenshot));
    utilGroup.appendChild(createActionBtn('fitview', 'Fit to View [F]', ICONS.fitView));
    var bboxBtn = createEl('button', 'ind-tool-btn', ICONS.bbox);
    bboxBtn.setAttribute('data-toggle', 'bbox');
    bboxBtn.setAttribute('data-tooltip', 'Show Bounds [B]');
    bboxBtn.setAttribute('aria-label', 'Show Bounds');
    bboxBtn.addEventListener('click', toggleBoundingBox);
    _bboxBtn = bboxBtn;
    utilGroup.appendChild(bboxBtn);
    toolbar.appendChild(utilGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // Display mode segment (Mesh / Splat / Cloud)
    var modeGroup = createEl('div', 'ind-toolbar-group');
    var meshBtn = createEl('button', 'ind-tool-btn ind-mode-btn', ICONS.mesh + '<span>Mesh</span>');
    meshBtn.setAttribute('data-mode', 'model');
    meshBtn.setAttribute('data-tooltip', 'Show mesh');
    meshBtn.setAttribute('aria-label', 'Show mesh');
    var splatBtn = createEl('button', 'ind-tool-btn ind-mode-btn', ICONS.splat + '<span>Splat</span>');
    splatBtn.setAttribute('data-mode', 'splat');
    splatBtn.setAttribute('data-tooltip', 'Show splat');
    splatBtn.setAttribute('aria-label', 'Show splat');
    var cloudBtn = createEl('button', 'ind-tool-btn ind-mode-btn', ICONS.cloud + '<span>Cloud</span>');
    cloudBtn.setAttribute('data-mode', 'pointcloud');
    cloudBtn.setAttribute('data-tooltip', 'Show point cloud');
    cloudBtn.setAttribute('aria-label', 'Show point cloud');
    [meshBtn, splatBtn, cloudBtn].forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (_deps && _deps.setDisplayMode) {
                _deps.setDisplayMode(btn.getAttribute('data-mode'));
            }
        });
        modeGroup.appendChild(btn);
    });
    _modeBtns = { model: meshBtn, splat: splatBtn, pointcloud: cloudBtn };
    // Start hidden — shown when assets load via updateModeButtonVisibility()
    meshBtn.style.display = 'none';
    splatBtn.style.display = 'none';
    cloudBtn.style.display = 'none';
    toolbar.appendChild(modeGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // View helpers group
    var viewGroup = createEl('div', 'ind-toolbar-group');
    var gridBtn = createEl('button', 'ind-tool-btn', ICONS.grid);
    gridBtn.setAttribute('data-toggle', 'grid');
    gridBtn.setAttribute('data-tooltip', 'Toggle Grid [G]');
    gridBtn.setAttribute('aria-label', 'Toggle Grid');
    gridBtn.setAttribute('aria-pressed', 'false');
    gridBtn.addEventListener('click', function() {
        _toggles.grid = !_toggles.grid;
        gridBtn.classList.toggle('active', _toggles.grid);
        if (_deps && _deps.toggleGrid) _deps.toggleGrid(_toggles.grid);
    });
    var autoRotBtn = createEl('button', 'ind-tool-btn', ICONS.autoRotate);
    autoRotBtn.setAttribute('data-toggle', 'autorotate');
    autoRotBtn.setAttribute('data-tooltip', 'Auto-Rotate');
    autoRotBtn.setAttribute('aria-label', 'Auto-Rotate');
    autoRotBtn.setAttribute('aria-pressed', 'true');
    autoRotBtn.addEventListener('click', function() {
        _toggles.autorotate = !_toggles.autorotate;
        autoRotBtn.classList.toggle('active', _toggles.autorotate);
        if (_deps && _deps.setAutoRotate) _deps.setAutoRotate(_toggles.autorotate);
    });
    var flyBtn = createEl('button', 'ind-tool-btn', ICONS.fly);
    flyBtn.setAttribute('data-toggle', 'fly');
    flyBtn.setAttribute('data-tooltip', 'Fly Mode');
    flyBtn.setAttribute('aria-label', 'Fly Mode');
    flyBtn.setAttribute('aria-pressed', 'false');
    flyBtn.addEventListener('click', function() {
        if (_deps && _deps.toggleFlyMode) _deps.toggleFlyMode();
        // State is read from deps.getFlyModeActive after the toggle
        setTimeout(function() {
            var active = _deps && _deps.getFlyModeActive ? _deps.getFlyModeActive() : false;
            flyBtn.classList.toggle('active', active);
        }, 0);
    });
    _viewToggles = { grid: gridBtn, autorotate: autoRotBtn, fly: flyBtn };
    viewGroup.appendChild(gridBtn);
    viewGroup.appendChild(autoRotBtn);
    viewGroup.appendChild(flyBtn);
    toolbar.appendChild(viewGroup);

    // Push HD/SD and panel toggle to the right
    var spacer = createEl('div', 'ind-toolbar-spacer');
    toolbar.appendChild(spacer);

    // HD / SD quality toggle
    var qualityGroup = createEl('div', 'ind-toolbar-group');
    var sdBtn = createEl('button', 'ind-tool-btn ind-quality-btn', 'SD');
    sdBtn.setAttribute('data-tier', 'sd');
    sdBtn.setAttribute('data-tooltip', 'Standard Definition');
    sdBtn.setAttribute('aria-label', 'Standard Definition');
    var hdBtn = createEl('button', 'ind-tool-btn ind-quality-btn', 'HD');
    hdBtn.setAttribute('data-tier', 'hd');
    hdBtn.setAttribute('data-tooltip', 'High Definition');
    hdBtn.setAttribute('aria-label', 'High Definition');
    [sdBtn, hdBtn].forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (_deps && _deps.switchQualityTier) {
                _deps.switchQualityTier(btn.getAttribute('data-tier'));
                updateQualityButtons();
            }
        });
        qualityGroup.appendChild(btn);
    });
    _qualityBtns = { sd: sdBtn, hd: hdBtn };
    toolbar.appendChild(qualityGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // Info panel toggle
    var panelBtn = createEl('button', 'ind-tool-btn', ICONS.panel);
    panelBtn.setAttribute('data-toggle', 'panel');
    panelBtn.setAttribute('data-tooltip', 'Properties Panel');
    panelBtn.setAttribute('aria-label', 'Properties Panel');
    panelBtn.setAttribute('aria-pressed', 'true');
    panelBtn.classList.add('active'); // panel open by default
    panelBtn.addEventListener('click', function() {
        toggleInfoPanel();
        panelBtn.classList.toggle('active', _panelOpen);
    });
    _panelToggleBtn = panelBtn;
    toolbar.appendChild(panelBtn);

    return toolbar;
}

function createToolBtn(tool, tooltip, icon) {
    var btn = createEl('button', 'ind-tool-btn', icon);
    btn.setAttribute('data-tool', tool);
    btn.setAttribute('data-tooltip', tooltip);
    btn.setAttribute('aria-label', tooltip);
    btn.addEventListener('click', function () { toggleTool(tool); });
    return btn;
}

function createToggleBtn(toggle, tooltip, icon) {
    var btn = createEl('button', 'ind-tool-btn', icon);
    btn.setAttribute('data-toggle', toggle);
    btn.setAttribute('data-tooltip', tooltip);
    btn.setAttribute('aria-label', tooltip);
    btn.setAttribute('aria-pressed', String(!!_toggles[toggle]));
    if (_toggles[toggle]) btn.classList.add('active');
    btn.addEventListener('click', function () { toggleDisplay(toggle); });
    return btn;
}

function createActionBtn(action, tooltip, icon) {
    var btn = createEl('button', 'ind-tool-btn', icon);
    btn.setAttribute('data-action', action);
    btn.setAttribute('data-tooltip', tooltip);
    btn.setAttribute('aria-label', tooltip);
    btn.addEventListener('click', function () {
        if (action === 'screenshot') doScreenshot();
        else if (action === 'fitview') fitCamera();
    });
    return btn;
}

function toggleBoundingBox() {
    if (!THREE) return;
    var scene = _deps && _deps.sceneManager && _deps.sceneManager.scene;
    if (!scene) return;

    if (_bboxHelper) {
        scene.remove(_bboxHelper);
        _bboxHelper = null;
        if (_bboxBtn) _bboxBtn.classList.remove('active');
        return;
    }

    var box = new THREE.Box3();
    var hasContent = false;
    var groups = [_deps.modelGroup, _deps.pointcloudGroup];
    for (var gi = 0; gi < groups.length; gi++) {
        var grp = groups[gi];
        if (!grp) continue;
        grp.traverse(function(child) {
            if (child.isMesh && child.geometry) {
                child.geometry.computeBoundingBox();
                if (child.geometry.boundingBox) {
                    var wb = child.geometry.boundingBox.clone();
                    wb.applyMatrix4(child.matrixWorld);
                    box.union(wb);
                    hasContent = true;
                }
            }
        });
    }
    if (!hasContent || box.isEmpty()) return;

    _bboxHelper = new THREE.Box3Helper(box, 0x3874CB);
    scene.add(_bboxHelper);
    if (_bboxBtn) _bboxBtn.classList.add('active');
}

function createStatusBar(manifest) {
    var bar = createEl('div', 'ind-status-bar');

    // Filename
    var filename = (manifest && manifest.title) ||
        (manifest && manifest.assets && manifest.assets[0] && manifest.assets[0].filename) ||
        null;

    if (filename) {
        bar.appendChild(createStatusField('ind-status-filename', filename));
        bar.appendChild(createEl('span', 'ind-status-sep', '|'));
    }

    // Vertices (MeshLab style: "Vertices: 12.4K")
    var vertLabel = createEl('span', 'ind-status-label', 'Vertices:');
    var vertValue = createEl('span', 'ind-status-field');
    vertValue.id = 'ind-status-vertices';
    vertValue.textContent = '\u2014';
    bar.appendChild(vertLabel);
    bar.appendChild(document.createTextNode(' '));
    bar.appendChild(vertValue);

    bar.appendChild(createEl('span', 'ind-status-sep', '|'));

    // Faces (MeshLab style: "Faces: 24.8K")
    var faceLabel = createEl('span', 'ind-status-label', 'Faces:');
    var faceValue = createEl('span', 'ind-status-field');
    faceValue.id = 'ind-status-faces';
    faceValue.textContent = '\u2014';
    bar.appendChild(faceLabel);
    bar.appendChild(document.createTextNode(' '));
    bar.appendChild(faceValue);

    bar.appendChild(createEl('span', 'ind-status-sep', '|'));

    // File size
    var fileSize = null;
    if (manifest && manifest.assets) {
        var totalBytes = 0;
        for (var i = 0; i < manifest.assets.length; i++) {
            if (manifest.assets[i].size) totalBytes += manifest.assets[i].size;
        }
        if (totalBytes > 0) fileSize = formatFileSize(totalBytes);
    }
    bar.appendChild(createStatusField('ind-status-filesize', fileSize));

    // Right-aligned: coords | measurement readout | FPS
    var coordField = createEl('span', 'ind-status-field ind-status-coords');
    coordField.id = 'ind-status-coords';
    coordField.textContent = 'X: \u2014  Y: \u2014  Z: \u2014';
    bar.appendChild(coordField);
    bar.appendChild(createEl('span', 'ind-status-sep', '|'));

    var measureField = createEl('span', 'ind-status-right');
    measureField.id = 'ind-status-measure';
    bar.appendChild(measureField);

    bar.appendChild(createEl('span', 'ind-status-sep', '|'));

    var fpsField = createEl('span', 'ind-status-field ind-status-fps-field');
    fpsField.id = 'ind-status-fps';
    fpsField.textContent = '\u2014';
    bar.appendChild(fpsField);

    return bar;
}

function createStatusField(id, value) {
    var el = createEl('span', 'ind-status-field', value || '\u2014');
    el.id = id;
    return el;
}

// (Old floating createSectionControls removed — now in side panel)

// ---- Drop Zone Overlay (P2) ----

function createDropZone() {
    var el = createEl('div', 'ind-drop-zone');
    var inner = createEl('div', 'ind-drop-zone-inner');
    inner.innerHTML = ICONS.upload +
        '<div class="ind-drop-zone-text">Drop a file to view</div>' +
        '<div class="ind-drop-zone-hint">.ddim &nbsp; .glb &nbsp; .splat &nbsp; .ply &nbsp; .e57</div>';
    el.appendChild(inner);

    el.addEventListener('dragover', function(e) {
        e.preventDefault();
        el.classList.add('drag-active');
    });
    el.addEventListener('dragleave', function(e) {
        if (!el.contains(e.relatedTarget)) el.classList.remove('drag-active');
    });
    el.addEventListener('drop', function(e) {
        e.preventDefault();
        el.classList.remove('drag-active');
        if (e.dataTransfer && e.dataTransfer.files.length > 0 && _deps && _deps.loadFile) {
            el.style.display = 'none';
            _deps.loadFile(e.dataTransfer.files[0]);
        }
    });

    return el;
}

// ---- Info Panel ----

function createPanelSection(id, title, initiallyOpen) {
    var section = createEl('div', 'ind-panel-section');
    section.id = id;

    var header = createEl('div', 'ind-panel-section-header');
    var arrow = createEl('span', 'ind-panel-arrow', initiallyOpen !== false ? '▼' : '▶');
    var label = createEl('span', 'ind-panel-section-label', title);
    header.appendChild(arrow);
    header.appendChild(label);

    var body = createEl('div', 'ind-panel-section-body');
    if (initiallyOpen === false) body.classList.add('collapsed');

    header.addEventListener('click', function() {
        var collapsed = body.classList.toggle('collapsed');
        arrow.textContent = collapsed ? '▶' : '▼';
    });

    section.appendChild(header);
    section.appendChild(body);
    return { section: section, body: body, label: label };
}

function setAssetVisible(role, asset, visible) {
    if (!_deps) return;
    if (role === 'splat' && _deps.sparkRenderer) {
        if (_deps.sparkRenderer.visible !== undefined) _deps.sparkRenderer.visible = visible;
    } else if (role === 'mesh' || role === 'cad') {
        if (_deps.modelGroup) _deps.modelGroup.visible = visible;
    } else if (role === 'pointcloud') {
        if (_deps.pointcloudGroup) _deps.pointcloudGroup.visible = visible;
    } else if (role === 'flightpath' && _deps.flightPathManager) {
        _deps.flightPathManager.setVisible(visible);
    }
}

function buildSubMeshList(container, group) {
    var found = 0;
    group.traverse(function(child) {
        if (!child.isMesh) return;
        var childItem = createEl('div', 'ind-layer-item ind-layer-child');
        var childBadge = createEl('span', 'ind-layer-badge ind-badge-mesh', 'M');
        var childName = child.name || ('mesh_' + found);
        var childNameEl = createEl('span', 'ind-layer-name', childName);

        var childEye = createEl('button', 'ind-layer-eye active', '\u{1F441}');
        childEye.setAttribute('aria-label', 'Toggle visibility');
        childEye.style.cssText = 'margin-left:auto; background:none; border:none; cursor:pointer; padding:0 4px; font-size:13px;';
        childEye.addEventListener('click', function(e) {
            e.stopPropagation();
            child.visible = childEye.classList.toggle('active');
        });

        childItem.appendChild(childBadge);
        childItem.appendChild(childNameEl);
        childItem.appendChild(childEye);
        container.appendChild(childItem);
        found++;
    });
    if (found === 0) {
        container.appendChild(createEl('div', 'ind-panel-empty', 'No sub-meshes'));
    }
}

function buildLayersSection(body, manifest) {
    body.innerHTML = '';
    var assets = manifest && manifest.assets ? manifest.assets : [];
    var added = 0;

    // Map asset roles/types to what's visually meaningful
    var typeInfo = {
        splat:      { label: 'Splat',  badge: 'S', cls: 'ind-badge-splat' },
        mesh:       { label: 'Mesh',   badge: 'M', cls: 'ind-badge-mesh' },
        pointcloud: { label: 'Cloud',  badge: 'C', cls: 'ind-badge-cloud' },
        flightpath: { label: 'Flight', badge: 'F', cls: 'ind-badge-flight' },
        cad:        { label: 'CAD',    badge: 'D', cls: 'ind-badge-mesh' }
    };

    assets.forEach(function(asset) {
        var role = asset.role || 'mesh';
        var info = typeInfo[role] || typeInfo.mesh;
        var name = asset.filename || asset.key || role;
        // Strip path prefix
        name = name.replace(/^assets\//, '').replace(/\.\w+$/, '');

        var item = createEl('div', 'ind-layer-item');
        item.setAttribute('data-asset-key', asset.key || role);
        item.style.cursor = 'pointer';
        var badge = createEl('span', 'ind-layer-badge ' + info.cls, info.badge);
        var nameEl = createEl('span', 'ind-layer-name', name);

        item.appendChild(badge);
        item.appendChild(nameEl);

        // Splat point budget slider
        if (role === 'splat' && _deps && _deps.getSplatBudget) {
            var sliderRow = createEl('div', 'ind-layer-slider-row');
            var budgetSlider = document.createElement('input');
            budgetSlider.type = 'range';
            budgetSlider.className = 'ind-budget-slider';
            budgetSlider.min = '100000';
            budgetSlider.max = '2000000';
            budgetSlider.step = '100000';
            budgetSlider.value = String(_deps.getSplatBudget());
            var budgetVal = createEl('span', 'ind-budget-val', formatNumber(parseInt(budgetSlider.value)));
            budgetSlider.addEventListener('input', function() {
                var v = parseInt(budgetSlider.value);
                if (_deps && _deps.setSplatBudget) _deps.setSplatBudget(v);
                budgetVal.textContent = formatNumber(v);
            });
            sliderRow.appendChild(createEl('span', 'ind-budget-label', 'Budget'));
            sliderRow.appendChild(budgetSlider);
            sliderRow.appendChild(budgetVal);
            item.appendChild(sliderRow);
        }

        // Vertex/face stats sub-line for meshes
        if (role === 'mesh' || role === 'cad') {
            var meshGroup = _deps && _deps.modelGroup;
            var verts = countVertices(meshGroup);
            var faces = countFaces(meshGroup);
            if (verts > 0 || faces > 0) {
                var stats = createEl('div', 'ind-layer-stats',
                    'V: ' + formatNumber(verts) + '  F: ' + formatNumber(faces));
                item.appendChild(stats);
            }
        }

        // Eye toggle — works for all asset types
        var eyeBtn = createEl('button', 'ind-layer-eye active', '\u{1F441}');
        eyeBtn.setAttribute('aria-label', 'Toggle visibility');
        eyeBtn.style.cssText = 'margin-left:auto; background:none; border:none; cursor:pointer; padding:0 4px; font-size:14px;';
        eyeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var visible = eyeBtn.classList.toggle('active');
            setAssetVisible(role, asset, visible);
        });
        item.appendChild(eyeBtn);

        // Size sub-line
        if (asset.size) {
            var sizeEl = createEl('div', 'ind-layer-stats', formatFileSize(asset.size));
            item.appendChild(sizeEl);
        }

        // Click-to-select handler
        item.addEventListener('click', function() {
            body.querySelectorAll('.ind-layer-item').forEach(function(el) {
                el.classList.remove('selected');
            });
            item.classList.add('selected');
            _selectedLayerKey = asset.key || role;
            // Refresh properties panel for this asset
            if (_panel && _panel._projBody) {
                buildPropertiesSection(_panel._projBody, _manifest, asset);
            }
        });

        // Expandable sub-mesh tree for mesh/cad assets
        if ((role === 'mesh' || role === 'cad') && _deps && _deps.modelGroup
                && _deps.modelGroup.children.length > 0) {
            var arrow = createEl('span', 'ind-layer-arrow', '\u25B6');
            item.insertBefore(arrow, badge);

            var childList = createEl('div', 'ind-layer-children');
            childList.style.display = 'none';

            var expanded = false;
            arrow.addEventListener('click', function(e) {
                e.stopPropagation();
                expanded = !expanded;
                childList.style.display = expanded ? '' : 'none';
                arrow.style.transform = expanded ? 'rotate(90deg)' : '';
                if (expanded && childList.childElementCount === 0) {
                    buildSubMeshList(childList, _deps.modelGroup);
                }
            });

            body.appendChild(item);
            body.appendChild(childList);
            added++;
            return; // skip the default body.appendChild(item) below
        }

        body.appendChild(item);
        added++;
    });

    if (added === 0) {
        body.appendChild(createEl('div', 'ind-panel-empty', 'No assets loaded'));
    }
}

function buildPropertiesSection(body, manifest, selectedAsset) {
    body.innerHTML = '';
    if (!manifest) {
        body.appendChild(createEl('div', 'ind-panel-empty', 'No project loaded'));
        return;
    }

    function addRow(labelText, valueText) {
        if (!valueText && valueText !== 0) return;
        var row = createEl('div', 'ind-prop-row');
        var lbl = createEl('span', 'ind-prop-label', labelText);
        var val = createEl('span', 'ind-prop-value', String(valueText));
        row.appendChild(lbl);
        row.appendChild(val);
        body.appendChild(row);
    }

    function addSection(title) {
        body.appendChild(createEl('div', 'ind-prop-sep'));
        body.appendChild(createEl('div', 'ind-prop-section-title', title));
    }

    // --- Project info (always from manifest) ---
    addRow('Title', manifest.title);
    addRow('Creator', manifest.creator || (manifest.metadata && manifest.metadata.creator));
    var dateVal = manifest.date_created || (manifest.metadata && manifest.metadata.date);
    if (dateVal) addRow('Date', String(dateVal).slice(0, 10));
    addRow('Format', manifest.format_version ? 'DDIM v' + manifest.format_version : null);

    // --- Geometry stats ---
    var assetRole = selectedAsset ? (selectedAsset.role || 'mesh') : null;
    var meshGroup = _deps && _deps.modelGroup;
    var showGeometry = selectedAsset ? (assetRole === 'mesh' || assetRole === 'cad') : true;
    if (showGeometry && meshGroup) {
        var verts = countVertices(meshGroup);
        var faces = countFaces(meshGroup);
        if (verts > 0 || faces > 0) {
            addSection('Geometry');
            if (verts > 0) addRow('Vertices', formatNumber(verts));
            if (faces > 0) addRow('Faces', formatNumber(faces));

            // Bounding box dimensions
            var bbox = new THREE.Box3();
            meshGroup.traverse(function(child) {
                if (child.isMesh && child.geometry) {
                    child.geometry.computeBoundingBox();
                    bbox.expandByObject(child);
                }
            });
            if (!bbox.isEmpty()) {
                var size = new THREE.Vector3();
                bbox.getSize(size);
                var units = (manifest.metadata && manifest.metadata.units) || 'm';
                addRow('Width',  size.x.toFixed(3) + ' ' + units);
                addRow('Height', size.y.toFixed(3) + ' ' + units);
                addRow('Depth',  size.z.toFixed(3) + ' ' + units);
            }
        }
    }
    // Point cloud geometry
    if ((!selectedAsset || assetRole === 'pointcloud') && _deps && _deps.pointcloudGroup) {
        var pcVerts = countVertices(_deps.pointcloudGroup);
        if (pcVerts > 0) {
            addSection('Geometry');
            addRow('Points', formatNumber(pcVerts));
        }
    }

    // --- Texture info ---
    if (showGeometry && meshGroup) {
        var textures = [];
        meshGroup.traverse(function(child) {
            if (child.isMesh && child.material) {
                var mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(function(mat) {
                    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(function(slot) {
                        if (mat[slot] && mat[slot].image && textures.indexOf(mat[slot]) === -1) {
                            textures.push(mat[slot]);
                        }
                    });
                });
            }
        });
        if (textures.length > 0) {
            addSection('Textures');
            addRow('Maps', String(textures.length));
            var firstImg = textures[0].image;
            if (firstImg && firstImg.width) {
                addRow('Resolution', firstImg.width + ' \u00d7 ' + firstImg.height);
            }
            var srcName = textures[0].name || (textures[0].image && textures[0].image.src) || '';
            var ext = srcName.split('.').pop().toUpperCase();
            if (ext === 'JPG' || ext === 'JPEG' || ext === 'PNG' || ext === 'WEBP' || ext === 'KTX2') {
                addRow('Format', ext === 'JPEG' ? 'JPG' : ext);
            }
        }
    }

    // --- File info ---
    var fileAsset = selectedAsset || (manifest.assets && manifest.assets.find(function(a) {
        return a.role === 'mesh' || a.role === 'cad';
    }));
    if (fileAsset) {
        addSection('File');
        if (fileAsset.size) addRow('Size', formatFileSize(fileAsset.size));
        var filename = fileAsset.filename || fileAsset.key || '';
        var extMatch = filename.match(/\.(\w+)$/);
        if (extMatch) addRow('Format', extMatch[1].toUpperCase());
        var compression = (fileAsset.extras && fileAsset.extras.compression) || null;
        if (compression) addRow('Compression', compression);
        var origName = fileAsset.original_filename || fileAsset.source_filename || null;
        if (origName) addRow('Source', origName.replace(/^.*[/\\]/, ''));
    }

    // --- Scan metadata ---
    var meta = manifest.metadata;
    if (meta) {
        var scanFields = [
            ['Accuracy',  meta.accuracy || meta.scan_accuracy],
            ['Device',    meta.device || meta.scanner || meta.instrument],
            ['Operator',  meta.operator || meta.surveyor],
            ['Scan Date', meta.scan_date || meta.acquisition_date]
        ];
        var hasScan = scanFields.some(function(f) { return !!f[1]; });
        if (hasScan) {
            addSection('Scan');
            scanFields.forEach(function(f) {
                if (f[1]) addRow(f[0], f[0] === 'Scan Date' ? String(f[1]).slice(0, 10) : String(f[1]));
            });
        }
    }

    // --- Description ---
    var desc = manifest.description || (manifest.metadata && manifest.metadata.description);
    if (desc) {
        body.appendChild(createEl('div', 'ind-prop-sep'));
        var descLabel = createEl('div', 'ind-prop-label', 'Description');
        body.appendChild(descLabel);
        var descText = createEl('div', 'ind-prop-desc', desc);
        body.appendChild(descText);
    }

    var tags = manifest.tags || (manifest.metadata && manifest.metadata.tags);
    if (tags && tags.length > 0) {
        body.appendChild(createEl('div', 'ind-prop-sep'));
        var tagRow = createEl('div', 'ind-tag-row');
        (Array.isArray(tags) ? tags : [tags]).forEach(function(t) {
            tagRow.appendChild(createEl('span', 'ind-tag', String(t)));
        });
        body.appendChild(tagRow);
    }
}

function buildAnnotationDetailForm(annotation, onSave, onCancel) {
    var form = createEl('div', 'ind-anno-form');

    // Title
    var titleLabel = createEl('label', 'ind-anno-form-label', 'Title');
    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'ind-anno-form-input';
    titleInput.value = annotation.title || '';
    titleInput.placeholder = 'Annotation title';
    form.appendChild(titleLabel);
    form.appendChild(titleInput);

    // Description
    var descLabel = createEl('label', 'ind-anno-form-label', 'Description');
    var descInput = document.createElement('textarea');
    descInput.className = 'ind-anno-form-textarea';
    descInput.value = annotation.body || '';
    descInput.placeholder = 'Description';
    descInput.rows = 2;
    form.appendChild(descLabel);
    form.appendChild(descInput);

    // Severity dropdown
    var sevLabel = createEl('label', 'ind-anno-form-label', 'Severity');
    var sevSelect = document.createElement('select');
    sevSelect.className = 'ind-anno-form-select';
    var sevOptions = [
        { value: '', label: '\u2014 None \u2014', color: '' },
        { value: 'low', label: '\u{1F7E2} Low', color: '#4caf50' },
        { value: 'medium', label: '\u{1F7E1} Medium', color: '#ff9800' },
        { value: 'high', label: '\u{1F7E0} High', color: '#f57c00' },
        { value: 'critical', label: '\u{1F534} Critical', color: '#f44336' }
    ];
    sevOptions.forEach(function(opt) {
        var option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (annotation.severity === opt.value || (!annotation.severity && opt.value === '')) {
            option.selected = true;
        }
        sevSelect.appendChild(option);
    });
    form.appendChild(sevLabel);
    form.appendChild(sevSelect);

    // Category dropdown
    var catLabel = createEl('label', 'ind-anno-form-label', 'Category');
    var catSelect = document.createElement('select');
    catSelect.className = 'ind-anno-form-select';
    var catOptions = [
        { value: '', label: '\u2014 None \u2014' },
        { value: 'surface_defect', label: 'Surface Defect' },
        { value: 'gap', label: 'Gap' },
        { value: 'missing_data', label: 'Missing Data' },
        { value: 'scan_artifact', label: 'Scan Artifact' },
        { value: 'dimensional_variance', label: 'Dimensional Variance' },
        { value: 'other', label: 'Other' }
    ];
    catOptions.forEach(function(opt) {
        var option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (annotation.category === opt.value || (!annotation.category && opt.value === '')) {
            option.selected = true;
        }
        catSelect.appendChild(option);
    });
    form.appendChild(catLabel);
    form.appendChild(catSelect);

    // Status toggle (Pass / Fail / Review)
    var statusLabel = createEl('label', 'ind-anno-form-label', 'Status');
    var statusRow = createEl('div', 'ind-anno-status-row');
    var currentStatus = annotation.status || '';
    ['pass', 'fail', 'review'].forEach(function(s) {
        var btn = createEl('button', 'ind-anno-status-btn' + (currentStatus === s ? ' active' : ''),
            s.charAt(0).toUpperCase() + s.slice(1));
        btn.setAttribute('data-status', s);
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            statusRow.querySelectorAll('.ind-anno-status-btn').forEach(function(b) { b.classList.remove('active'); });
            if (currentStatus === s) {
                currentStatus = '';
            } else {
                currentStatus = s;
                btn.classList.add('active');
            }
        });
        statusRow.appendChild(btn);
    });
    form.appendChild(statusLabel);
    form.appendChild(statusRow);

    // QA Notes
    var notesLabel = createEl('label', 'ind-anno-form-label', 'Notes');
    var notesInput = document.createElement('textarea');
    notesInput.className = 'ind-anno-form-textarea';
    notesInput.value = annotation.qa_notes || '';
    notesInput.placeholder = 'QA notes';
    notesInput.rows = 2;
    form.appendChild(notesLabel);
    form.appendChild(notesInput);

    // Buttons
    var btnRow = createEl('div', 'ind-anno-form-btns');
    var saveBtn = createEl('button', 'ind-tool-btn ind-anno-save-btn', 'Save');
    saveBtn.addEventListener('click', function(e) {
        e.preventDefault();
        onSave({
            title: titleInput.value,
            body: descInput.value,
            severity: sevSelect.value || undefined,
            category: catSelect.value || undefined,
            status: currentStatus || undefined,
            qa_notes: notesInput.value || undefined
        });
    });
    var cancelBtn = createEl('button', 'ind-tool-btn ind-anno-cancel-btn', 'Cancel');
    cancelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        onCancel();
    });
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    form.appendChild(btnRow);

    return form;
}

function exportAnnotationsCSV() {
    if (!_deps || !_deps.annotationSystem) return;
    var annotations = _deps.annotationSystem.getAnnotations();
    var rows = ['title,severity,category,status,notes,x,y,z'];
    if (annotations) {
        annotations.forEach(function(a) {
            var fields = [
                '"' + (a.title || '').replace(/"/g, '""') + '"',
                a.severity || '',
                a.category || '',
                a.status || '',
                '"' + (a.qa_notes || '').replace(/"/g, '""') + '"',
                a.position ? a.position.x.toFixed(4) : '',
                a.position ? a.position.y.toFixed(4) : '',
                a.position ? a.position.z.toFixed(4) : ''
            ];
            rows.push(fields.join(','));
        });
    }
    var csv = rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'defects.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function buildAnnotationsSection(body, manifest) {
    body.innerHTML = '';
    var annotations = _deps && _deps.annotationSystem ? _deps.annotationSystem.getAnnotations() : [];
    if (!annotations || annotations.length === 0) {
        body.appendChild(createEl('div', 'ind-panel-empty', 'No annotations'));
        return;
    }

    // Header with CSV export button
    var header = createEl('div', 'ind-anno-header');
    var count = createEl('span', 'ind-anno-count', annotations.length + ' annotation' + (annotations.length !== 1 ? 's' : ''));
    var csvBtn = createEl('button', 'ind-tool-btn ind-anno-csv-btn', 'Export CSV');
    csvBtn.setAttribute('data-tooltip', 'Export defect annotations as CSV');
    csvBtn.addEventListener('click', function(e) { e.stopPropagation(); exportAnnotationsCSV(); });
    header.appendChild(count);
    header.appendChild(csvBtn);
    body.appendChild(header);

    annotations.forEach(function(anno, i) {
        var item = createEl('div', 'ind-anno-item');
        item.setAttribute('data-anno-id', anno.id);
        var num = createEl('span', 'ind-anno-num', String(i + 1));
        var title = createEl('span', 'ind-anno-title', anno.title || ('Annotation ' + (i + 1)));

        // Severity dot indicator
        if (anno.severity) {
            var sevColors = { low: '#4caf50', medium: '#ff9800', high: '#f57c00', critical: '#f44336' };
            var dot = createEl('span', 'ind-anno-sev-dot');
            dot.style.background = sevColors[anno.severity] || '#888';
            dot.setAttribute('title', anno.severity);
            item.appendChild(dot);
        }

        item.appendChild(num);
        item.appendChild(title);

        // Status badge
        if (anno.status) {
            var statusCls = 'ind-anno-status-badge ind-anno-status-' + anno.status;
            var statusBadge = createEl('span', statusCls, anno.status.toUpperCase());
            item.appendChild(statusBadge);
        }

        // Delete button
        var delBtn = createEl('button', 'ind-anno-del-btn', '\u00d7');
        delBtn.setAttribute('title', 'Delete annotation');
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (_deps && _deps.annotationSystem) {
                _deps.annotationSystem.deleteAnnotation(anno.id);
                buildAnnotationsSection(body, manifest);
            }
        });
        item.appendChild(delBtn);

        item.addEventListener('click', function() {
            if (_deps && _deps.annotationSystem) {
                _deps.annotationSystem.goToAnnotation(anno.id);
            }
            // Show edit form in panel
            showAnnotationDetailPanel(body, anno, manifest);
        });
        body.appendChild(item);
    });
}

function showAnnotationDetailPanel(body, annotation, manifest) {
    body.innerHTML = '';
    var backBtn = createEl('button', 'ind-tool-btn ind-anno-back-btn', '\u25C0 Back to list');
    backBtn.addEventListener('click', function() {
        buildAnnotationsSection(body, manifest);
    });
    body.appendChild(backBtn);

    var form = buildAnnotationDetailForm(annotation, function onSave(updates) {
        if (_deps && _deps.annotationSystem) {
            _deps.annotationSystem.updateAnnotation(annotation.id, updates);
        }
        buildAnnotationsSection(body, manifest);
    }, function onCancel() {
        buildAnnotationsSection(body, manifest);
    });
    body.appendChild(form);
}

function buildCrossSectionPanel(body) {
    body.innerHTML = '';

    // Axis buttons row
    var axisRow = createEl('div', 'ind-xsec-axis-row');
    var axisLabel = createEl('span', 'ind-xsec-label', 'Axis');
    axisRow.appendChild(axisLabel);

    ['X', 'Y', 'Z'].forEach(function(axis) {
        var btn = createEl('button', 'ind-xsec-axis-btn' + (axis === 'Y' ? ' active' : ''), axis);
        btn.setAttribute('data-axis', axis.toLowerCase());
        btn.addEventListener('click', function() {
            axisRow.querySelectorAll('.ind-xsec-axis-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var a = axis.toLowerCase();
            if (_deps.crossSection) {
                _deps.crossSection.setAxis(a);
                // Sync slider to live position on the new axis
                var t = _deps.crossSection.getPositionAlongAxis(a);
                slider.value = String(Math.round(t * 100));
            }
        });
        axisRow.appendChild(btn);
    });

    var flipBtn = createEl('button', 'ind-xsec-flip-btn', ICONS.flip);
    flipBtn.setAttribute('data-tooltip', 'Flip direction');
    flipBtn.addEventListener('click', function() {
        if (_deps.crossSection) _deps.crossSection.flip();
    });
    axisRow.appendChild(flipBtn);
    body.appendChild(axisRow);

    // Position slider
    var sliderRow = createEl('div', 'ind-xsec-slider-row');
    var sliderLabel = createEl('span', 'ind-xsec-label', 'Position');
    sliderRow.appendChild(sliderLabel);

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ind-xsec-slider';
    slider.min = '0';
    slider.max = '100';
    slider.value = '50';
    slider.addEventListener('input', function() {
        if (!_deps.crossSection) return;
        var activeBtn = body.querySelector('.ind-xsec-axis-btn.active');
        var axis = activeBtn ? activeBtn.getAttribute('data-axis') : 'y';
        var t = parseFloat(slider.value) / 100;
        _deps.crossSection.setPositionAlongAxis(axis, t);
    });
    sliderRow.appendChild(slider);
    body.appendChild(sliderRow);

    // Mode toggle row (Translate / Rotate)
    var modeRow = createEl('div', 'ind-xsec-mode-row');
    var modeLabel = createEl('span', 'ind-xsec-label', 'Gizmo');
    modeRow.appendChild(modeLabel);

    var translateBtn = createEl('button', 'ind-xsec-mode-btn active', 'Translate');
    translateBtn.setAttribute('data-mode', 'translate');
    var rotateBtn = createEl('button', 'ind-xsec-mode-btn', 'Rotate');
    rotateBtn.setAttribute('data-mode', 'rotate');

    function setModeActive(mode) {
        translateBtn.classList.toggle('active', mode === 'translate');
        rotateBtn.classList.toggle('active', mode === 'rotate');
        if (_deps && _deps.crossSection) _deps.crossSection.setMode(mode);
    }
    translateBtn.addEventListener('click', function() { setModeActive('translate'); });
    rotateBtn.addEventListener('click', function() { setModeActive('rotate'); });

    modeRow.appendChild(translateBtn);
    modeRow.appendChild(rotateBtn);
    body.appendChild(modeRow);

    // Reset row
    var resetRow = createEl('div', 'ind-xsec-reset-row');
    var resetBtn = createEl('button', 'ind-tool-btn', 'Reset Plane');
    resetBtn.setAttribute('data-tooltip', 'Re-center plane on scene bounding box');
    resetBtn.addEventListener('click', function() {
        if (!_deps || !_deps.crossSection) return;
        var bbox = _deps.crossSection.getBBox();
        var center = new THREE.Vector3();
        bbox.getCenter(center);
        _deps.crossSection.reset(center);
        slider.value = '50';
    });
    resetRow.appendChild(resetBtn);
    body.appendChild(resetRow);

    // Hint text
    var hint = createEl('div', 'ind-xsec-hint', 'Press 1 or use the toolbar to toggle');
    body.appendChild(hint);
}

function buildMeasuresSection(body) {
    body.innerHTML = '';
    if (!_deps || !_deps.measurementSystem) {
        body.appendChild(createEl('div', 'ind-panel-empty', 'No measurements'));
        return;
    }
    var measurements = _deps.measurementSystem.getMeasurements();
    if (!measurements || measurements.length === 0) {
        body.appendChild(createEl('div', 'ind-panel-empty', 'No measurements'));
        return;
    }
    measurements.forEach(function(m, i) {
        var row = createEl('div', 'ind-measure-item');
        var numEl = createEl('span', 'ind-measure-num', String(i + 1));
        var distTextEl = m.labelEl ? m.labelEl.querySelector('.measure-label-text') : null;
        var unitEl = m.labelEl ? m.labelEl.querySelector('.measure-unit-btn') : null;
        var dist = distTextEl ? distTextEl.textContent : '\u2014';
        var unit = unitEl ? unitEl.textContent : '';
        var valEl = createEl('span', 'ind-measure-value', dist + (unit ? ' ' + unit : ''));
        row.appendChild(numEl);
        row.appendChild(valEl);
        body.appendChild(row);
    });
}

function updateAnnotationSectionHeader(sectionLabel) {
    var annotations = _deps && _deps.annotationSystem ? _deps.annotationSystem.getAnnotations() : [];
    var count = annotations ? annotations.length : 0;
    if (sectionLabel) sectionLabel.textContent = 'Annotations' + (count > 0 ? ' (' + count + ')' : '');
}

function createInfoPanel(manifest) {
    var panel = createEl('div', 'ind-panel');

    // Layers section
    var layers = createPanelSection('ind-panel-layers', 'Layers', true);
    buildLayersSection(layers.body, manifest);
    panel.appendChild(layers.section);

    // Project info section
    var proj = createPanelSection('ind-panel-project', 'Project', true);
    buildPropertiesSection(proj.body, manifest);
    panel.appendChild(proj.section);

    // Annotations section
    var annos = createPanelSection('ind-panel-annotations', 'Annotations', true);
    buildAnnotationsSection(annos.body, manifest);
    updateAnnotationSectionHeader(annos.label);
    panel.appendChild(annos.section);

    // Cross-Section section (hidden until slice tool activated)
    var xsec = createPanelSection('ind-panel-crosssection', 'Cross-Section', true);
    buildCrossSectionPanel(xsec.body);
    xsec.section.style.display = 'none';
    panel.appendChild(xsec.section);

    // Measurements section
    var measures = createPanelSection('ind-panel-measures', 'Measurements', false);
    buildMeasuresSection(measures.body);
    panel.appendChild(measures.section);

    // Store label refs for later updates
    panel._annoLabel = annos.label;
    panel._annosBody = annos.body;
    panel._projBody = proj.body;
    panel._layersBody = layers.body;
    panel._measuresBody = measures.body;
    panel._measuresLabel = measures.label;
    panel._crossSectionEl = xsec.section;

    return panel;
}

function createLightWidget() {
    var widget = createEl('div', 'ind-light-widget');
    var indicator = createEl('div', 'ind-light-indicator');
    widget.appendChild(indicator);

    widget.addEventListener('mousedown', onLightMouseDown);

    return widget;
}

function createTrackballOverlay() {
    var overlay = createEl('div', 'ind-trackball-overlay');
    var circle = createEl('div', 'ind-trackball-circle');
    overlay.appendChild(circle);
    return overlay;
}

// ---- Exported kiosk callbacks ----

function onAutoRotateChange(active) {
    _toggles.autorotate = active;
    if (_viewToggles && _viewToggles.autorotate) {
        _viewToggles.autorotate.classList.toggle('active', active);
    }
}

function onAssetLoaded() {
    if (!_panel || !_deps) return;
    // Show/hide mode buttons based on loaded asset types
    updateModeButtonVisibility();
    // Rebuild layers with updated asset info
    if (_panel._layersBody) buildLayersSection(_panel._layersBody, _manifest);
    // Refresh vertex/face status bar counts
    var vertCount = countVertices(_deps.modelGroup) + countVertices(_deps.pointcloudGroup);
    var faceCount = countFaces(_deps.modelGroup) + countFaces(_deps.pointcloudGroup);
    var vertEl = document.getElementById('ind-status-vertices');
    if (vertEl && vertCount > 0) vertEl.textContent = formatNumber(vertCount);
    var faceEl = document.getElementById('ind-status-faces');
    if (faceEl && faceCount > 0) faceEl.textContent = formatNumber(faceCount);
    // Hide drop zone
    if (_dropZone) _dropZone.style.display = 'none';
}

function onMeasurementChanged() {
    if (!_panel) return;
    if (_panel._measuresBody) buildMeasuresSection(_panel._measuresBody);
    if (_panel._measuresLabel) {
        var ms = _deps && _deps.measurementSystem ? _deps.measurementSystem.getMeasurements() : [];
        _panel._measuresLabel.textContent = 'Measurements' + (ms.length > 0 ? ' (' + ms.length + ')' : '');
        // Auto-expand section when first measurement added
        if (ms.length === 1) {
            var sec = document.getElementById('ind-panel-measures');
            if (sec) {
                var body = sec.querySelector('.ind-panel-section-body');
                var arrow = sec.querySelector('.ind-panel-arrow');
                if (body) body.classList.remove('collapsed');
                if (arrow) arrow.textContent = '\u25bc';
            }
        }
    }
}

function onAnnotationSelect(annotationId) {
    if (!_panel) return;
    var id = String(annotationId);

    // Highlight the matching item in the annotations list
    var items = _panel.querySelectorAll('.ind-anno-item');
    for (var i = 0; i < items.length; i++) {
        var match = items[i].getAttribute('data-anno-id') === id;
        items[i].classList.toggle('selected', match);
        if (match) items[i].scrollIntoView({ block: 'nearest' });
    }

    // Expand the annotations section if it's collapsed
    var annosSection = document.getElementById('ind-panel-annotations');
    if (annosSection) {
        var body = annosSection.querySelector('.ind-panel-section-body');
        var arrow = annosSection.querySelector('.ind-panel-arrow');
        if (body && body.classList.contains('collapsed')) {
            body.classList.remove('collapsed');
            if (arrow) arrow.textContent = '\u25BC';
        }
    }

    // Show annotation popup + detail form
    if (_deps && _deps.annotationSystem) {
        var annotations = _deps.annotationSystem.getAnnotations();
        var anno = annotations ? annotations.find(function(a) { return String(a.id) === id; }) : null;
        if (anno) {
            if (_deps.showAnnotationPopup) {
                var popupId = _deps.showAnnotationPopup(anno, _deps.state ? _deps.state.imageAssets : undefined);
                if (_deps.setCurrentPopupId) _deps.setCurrentPopupId(popupId);
            }
            // Show edit form in the annotations panel body
            if (annosSection) {
                var panelBody = annosSection.querySelector('.ind-panel-section-body');
                if (panelBody) showAnnotationDetailPanel(panelBody, anno, _manifest);
            }
        }
    }
}

function onAnnotationDeselect() {
    if (!_panel) return;
    _panel.querySelectorAll('.ind-anno-item.selected').forEach(function(el) {
        el.classList.remove('selected');
    });
    // Hide annotation popup
    if (_deps && _deps.hideAnnotationPopup) _deps.hideAnnotationPopup();
    if (_deps && _deps.hideAnnotationLine) _deps.hideAnnotationLine();
    if (_deps && _deps.setCurrentPopupId) _deps.setCurrentPopupId(null);
    // Restore annotations list (in case detail form was showing)
    var annosSection = document.getElementById('ind-panel-annotations');
    if (annosSection) {
        var body = annosSection.querySelector('.ind-panel-section-body');
        if (body) buildAnnotationsSection(body, _manifest);
    }
}

function onViewModeChange(mode) {
    updateModeButtons(mode);
}

// ---- setup ----

function setup(manifest, deps) {
    _manifest = manifest;
    _deps = deps;
    THREE = (deps && deps.THREE) || window.THREE;

    // Update window title
    if (manifest && manifest.title) {
        document.title = manifest.title + ' \u2014 Vitrine3D';
    } else if (!document.title || document.title === 'Vitrine3D') {
        document.title = 'Vitrine3D';
    }

    // Lock orbit-only navigation
    var controls = deps.sceneManager ? deps.sceneManager.controls : null;
    if (controls) {
        controls.enablePan = false;
        if (controls.mouseButtons) {
            controls.mouseButtons.RIGHT = null;
        }
    }

    // Create menu bar
    _menubar = createMenuBar();
    document.body.appendChild(_menubar);

    // Create toolbar
    _toolbar = createToolbar();
    document.body.appendChild(_toolbar);

    // Create status bar
    _statusBar = createStatusBar(manifest);
    document.body.appendChild(_statusBar);

    // Create light widget
    _lightWidget = createLightWidget();
    document.body.appendChild(_lightWidget);

    // Create trackball overlay (hidden by default, toggle via View > Show Orbit Guide)
    _trackballOverlay = createTrackballOverlay();
    _trackballOverlay.classList.add('hidden');
    document.body.appendChild(_trackballOverlay);

    // Create info panel
    _panel = createInfoPanel(manifest);
    document.body.appendChild(_panel);
    document.body.classList.add('ind-panel-open');

    // Create drop zone overlay (P2 — shown when no asset is loaded)
    var hasAssets = manifest && manifest.assets && manifest.assets.length > 0;
    _dropZone = createDropZone();
    document.body.appendChild(_dropZone);
    if (hasAssets) _dropZone.style.display = 'none';

    // Update initial light indicator position
    updateLightIndicator();

    // Populate vertex and face counts
    var vertCount = countVertices(deps.modelGroup) + countVertices(deps.pointcloudGroup);
    var faceCount = countFaces(deps.modelGroup) + countFaces(deps.pointcloudGroup);

    var vertEl = document.getElementById('ind-status-vertices');
    if (vertEl && vertCount > 0) {
        vertEl.textContent = formatNumber(vertCount);
    }
    var faceEl = document.getElementById('ind-status-faces');
    if (faceEl && faceCount > 0) {
        faceEl.textContent = formatNumber(faceCount);
    }

    // Set texture toggle button active by default (texture starts on)
    var texBtn = _toolbar.querySelector('[data-toggle="texture"]');
    if (texBtn) texBtn.classList.add('active');

    // Sync auto-rotate button with current state
    var autoRotateOn = deps.getAutoRotate ? deps.getAutoRotate() : true;
    _toggles.autorotate = autoRotateOn;
    if (_viewToggles && _viewToggles.autorotate) {
        _viewToggles.autorotate.classList.toggle('active', autoRotateOn);
    }

    // Sync quality buttons
    updateQualityButtons();

    // Sync display mode buttons with current state
    updateModeButtons(deps.state ? deps.state.displayMode : 'model');

    // Start FPS counter
    startFpsCounter();

    // Hide trackball during drag for cleaner viewport
    var viewerContainer = document.getElementById('viewer-container');
    if (viewerContainer) {
        viewerContainer.addEventListener('mousedown', function () {
            if (_trackballOverlay) _trackballOverlay.style.opacity = '0.3';
        });
        document.addEventListener('mouseup', function () {
            if (_trackballOverlay) _trackballOverlay.style.opacity = '';
        });
        // Show drop zone overlay on file drag-enter (before drop)
        document.addEventListener('dragenter', function(e) {
            if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).indexOf('Files') >= 0) {
                if (_dropZone && _dropZone.style.display !== 'none') {
                    _dropZone.classList.add('drag-active');
                }
            }
        });
        document.addEventListener('dragleave', function(e) {
            if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
                if (_dropZone) _dropZone.classList.remove('drag-active');
            }
        });
        document.addEventListener('drop', function() {
            if (_dropZone) _dropZone.classList.remove('drag-active');
        });
    }

    // Register keyboard shortcuts in capture phase
    _keydownHandler = function (e) {
        var activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
        if (e.ctrlKey || e.metaKey) return;

        var key = e.key.toLowerCase();
        var handled = false;

        switch (key) {
            case '1': toggleTool('slice'); handled = true; break;
            case '2': toggleTool('measure'); handled = true; break;
            case '3': toggleTool('annotate'); handled = true; break;
            case 'b': toggleBoundingBox(); handled = true; break;
            case 't': toggleDisplay('texture'); handled = true; break;
            case 'm': toggleDisplay('matcap'); handled = true; break;
            case 'w': toggleDisplay('wireframe'); handled = true; break;
            case 'l': toggleTool('light'); handled = true; break;
            case 'p': doScreenshot(); handled = true; break;
            case 'f': fitCamera(); handled = true; break;
            case 'g':
                _toggles.grid = !_toggles.grid;
                if (_viewToggles && _viewToggles.grid) _viewToggles.grid.classList.toggle('active', _toggles.grid);
                if (_deps && _deps.toggleGrid) _deps.toggleGrid(_toggles.grid);
                handled = true;
                break;
        }

        if (handled) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    };
    window.addEventListener('keydown', _keydownHandler, true);

    // Show/hide mode buttons based on initially loaded assets
    updateModeButtonVisibility();

    // Start coordinate readout and view cube
    startCoordReadout();
    createViewCube();
}

// ---- initLoadingScreen ----

function initLoadingScreen(container) {
    var inner = container.querySelector('#loading-inner') || container;
    inner.innerHTML = '';

    var center = document.createElement('div');
    center.className = 'ind-loading-center';

    var text = document.createElement('div');
    text.id = 'loading-text';
    text.textContent = 'Loading\u2026';
    center.appendChild(text);
    inner.appendChild(center);

    var bottom = document.createElement('div');
    bottom.className = 'ind-loading-bottom';
    bottom.innerHTML =
        '<div id="loading-progress-container">' +
        '    <div id="loading-progress-bar" style="width:0%"></div>' +
        '</div>' +
        '<div id="loading-progress-text"></div>';
    inner.appendChild(bottom);
}

// ---- onKeyboardShortcut ----

function onKeyboardShortcut(key) {
    switch (key) {
        case '1': toggleTool('slice'); return true;
        case '2': toggleTool('measure'); return true;
        case '3': toggleTool('annotate'); return true;
        case 'b': toggleBoundingBox(); return true;
        case 'm': toggleDisplay('matcap'); return true;
        case 't': toggleDisplay('texture'); return true;
        case 'w': toggleDisplay('wireframe'); return true;
        case 'l': toggleTool('light'); return true;
        case 'p': doScreenshot(); return true;
        case 'escape': deactivateAllTools(); return true;
        case 'f': fitCamera(); return true;
        case 'g':
            _toggles.grid = !_toggles.grid;
            if (_viewToggles && _viewToggles.grid) _viewToggles.grid.classList.toggle('active', _toggles.grid);
            if (_deps && _deps.toggleGrid) _deps.toggleGrid(_toggles.grid);
            return true;
        default: return false;
    }
}

// ---- Walkthrough callbacks ----

function onWalkthroughStart(walkthrough) {
    _wtTotalStops = walkthrough.stops.length;
    if (!_statusBar) return;

    _wtControls = createEl('div', 'ind-wt-controls');

    // Stop dots (visual progress — kiosk-main's player handles prev/next/click)
    _wtDots = createEl('div', 'ind-wt-dots');
    walkthrough.stops.forEach(function(_stop, i) {
        var dot = createEl('div', 'ind-wt-dot');
        dot.setAttribute('data-stop-index', String(i));
        _wtDots.appendChild(dot);
    });
    _wtControls.appendChild(_wtDots);

    // Stop title
    _wtTitleEl = createEl('span', 'ind-wt-title');
    _wtControls.appendChild(_wtTitleEl);

    _statusBar.appendChild(_wtControls);
}

function onWalkthroughStopChange(stopIndex, stop) {
    if (_wtDots) {
        _wtDots.querySelectorAll('.ind-wt-dot').forEach(function(d) {
            var idx = parseInt(d.getAttribute('data-stop-index'), 10);
            d.classList.toggle('visited', idx < stopIndex);
            d.classList.toggle('active', idx === stopIndex);
        });
    }
    if (_wtTitleEl) {
        _wtTitleEl.textContent = stop.title || ('Stop ' + (stopIndex + 1));
    }
}

function onWalkthroughEnd() {
    if (_wtControls) {
        _wtControls.remove();
        _wtControls = null;
    }
    _wtDots = null;
    _wtTitleEl = null;
    _wtTotalStops = 0;
}

// ---- Destroy / teardown ----

function destroy() {
    // Remove document-level keyboard listener
    if (_keydownHandler) {
        window.removeEventListener('keydown', _keydownHandler, true);
        _keydownHandler = null;
    }

    // Remove menu close listener
    if (_menuCloseListener) {
        document.removeEventListener('mousedown', _menuCloseListener);
        _menuCloseListener = null;
    }

    // Remove DOM elements created by setup
    if (_menubar && _menubar.parentNode) _menubar.parentNode.removeChild(_menubar);
    if (_toolbar && _toolbar.parentNode) _toolbar.parentNode.removeChild(_toolbar);
    if (_statusBar && _statusBar.parentNode) _statusBar.parentNode.removeChild(_statusBar);
    if (_lightWidget && _lightWidget.parentNode) _lightWidget.parentNode.removeChild(_lightWidget);
    if (_trackballOverlay && _trackballOverlay.parentNode) _trackballOverlay.parentNode.removeChild(_trackballOverlay);
    if (_panel && _panel.parentNode) _panel.parentNode.removeChild(_panel);
    if (_dropZone && _dropZone.parentNode) _dropZone.parentNode.removeChild(_dropZone);

    // Clean up walkthrough UI
    onWalkthroughEnd();

    // Remove panel-open body class
    document.body.classList.remove('ind-panel-open');

    // Clean up coordinate readout
    if (_coordMouseMoveHandler && _deps && _deps.sceneManager) {
        _deps.sceneManager.renderer.domElement.removeEventListener('mousemove', _coordMouseMoveHandler);
    }
    _coordMouseMoveHandler = null;
    _coordRaycaster = null;

    // Clean up view cube
    if (_viewCubeRafId) { cancelAnimationFrame(_viewCubeRafId); _viewCubeRafId = null; }
    if (_viewCubeRenderer) { _viewCubeRenderer.dispose(); _viewCubeRenderer = null; }
    if (_viewCubeCanvas && _viewCubeCanvas.parentNode) { _viewCubeCanvas.parentNode.removeChild(_viewCubeCanvas); }
    _viewCubeCanvas = null;
    _viewCubeScene = null;
    _viewCubeCamera = null;

    // Clean up normals helpers
    if (_normalsHelpers.length > 0 && _deps && _deps.sceneManager) {
        var scene = _deps.sceneManager.scene;
        _normalsHelpers.forEach(function(h) { scene.remove(h); h.dispose(); });
    }
    _normalsHelpers = [];

    // Reset module state
    _menubar = null;
    _toolbar = null;
    _statusBar = null;
    _lightWidget = null;
    _trackballOverlay = null;
    _panel = null;
    _dropZone = null;
    _deps = null;
    _manifest = null;
    _activeTool = null;
    _openMenu = null;
    _modeBtns = null;
    _viewToggles = null;
    _qualityBtns = null;
    _panelToggleBtn = null;
}

// ---- Self-register for kiosk discovery ----
if (!window.__KIOSK_LAYOUTS__) window.__KIOSK_LAYOUTS__ = {};
window.__KIOSK_LAYOUTS__['industrial'] = {
    setup: setup,
    initLoadingScreen: initLoadingScreen,
    onKeyboardShortcut: onKeyboardShortcut,
    onAnnotationSelect: onAnnotationSelect,
    onAnnotationDeselect: onAnnotationDeselect,
    onViewModeChange: onViewModeChange,
    onAutoRotateChange: onAutoRotateChange,
    onAssetLoaded: onAssetLoaded,
    onMeasurementChanged: onMeasurementChanged,
    onWalkthroughStart: onWalkthroughStart,
    onWalkthroughStopChange: onWalkthroughStopChange,
    onWalkthroughEnd: onWalkthroughEnd,
    destroy: destroy,
    hasOwnInfoPanel: true,
    hasOwnQualityToggle: true,
    handlesEmptyState: true
};
