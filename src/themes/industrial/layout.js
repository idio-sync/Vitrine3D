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

var _deps = null;
var _activeTool = null;
var _toggles = { matcap: false, texture: true, wireframe: false, trackball: true, toolbar: true, annotations: true };

// Light widget drag state
var _lightDragging = false;
var _lightAzimuth = Math.PI / 4;
var _lightElevation = Math.PI / 4;

// DOM references
var _menubar = null;
var _toolbar = null;
var _statusBar = null;
var _sectionControls = null;
var _lightWidget = null;
var _trackballOverlay = null;

// Menu system state
var _openMenu = null;            // 'file' | 'view' | 'render' | 'tools' | 'help' | null
var _renderMode = 'solid';       // 'solid' | 'wireframe' | 'matcap'
var _cameraMode = 'perspective'; // 'perspective' | 'orthographic'
var _orthoCam = null;            // cached OrthographicCamera instance
var _perspCam = null;            // cached PerspectiveCamera reference
var _menuCloseListener = null;   // document mousedown listener reference
var _manifest = null;            // archive manifest (stored in setup())

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
    fitView: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="12" height="12" rx="1"/><path d="M2 7V3h4M14 2h4v4M18 13v4h-4M6 18H2v-4"/></svg>'
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
        if (_sectionControls) _sectionControls.classList.add('visible');
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
        if (_sectionControls) _sectionControls.classList.remove('visible');
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
        if (_toggles[name]) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
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
    var renderer = _deps && _deps.sceneManager ? _deps.sceneManager.renderer : null;
    if (!renderer) return;
    renderer.domElement.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'screenshot-' + Date.now() + '.png';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }, 'image/png');
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

// ---- Section controls ----

function wireSliceControls() {
    if (!_sectionControls) return;

    var axisButtons = _sectionControls.querySelectorAll('.ind-section-axis-btn');
    var slider = _sectionControls.querySelector('.ind-section-slider');
    var flipBtn = _sectionControls.querySelector('.ind-section-flip-btn');

    axisButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            axisButtons.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var axis = btn.getAttribute('data-axis');
            if (_deps.crossSection) {
                _deps.crossSection.setAxis(axis);
                if (slider) slider.value = 50;
            }
        });
    });

    if (slider) {
        slider.addEventListener('input', function () {
            if (!_deps.crossSection) return;
            var activeAxis = _sectionControls.querySelector('.ind-section-axis-btn.active');
            var axis = activeAxis ? activeAxis.getAttribute('data-axis') : 'y';
            var t = parseFloat(slider.value) / 100;
            _deps.crossSection.setPositionAlongAxis(axis, t);
        });
    }

    if (flipBtn) {
        flipBtn.addEventListener('click', function () {
            if (_deps.crossSection) _deps.crossSection.flip();
        });
    }
}

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
    dropdown.appendChild(ddItem('Reset View', '', function() { fitCamera(); }));
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
            var OrthoCls = (window.THREE && window.THREE.OrthographicCamera) || null;
            if (!OrthoCls) {
                console.warn('[industrial] THREE not in global scope, orthographic not available');
                return;
            }
            _orthoCam = new OrthoCls(-frustW/2, frustW/2, frustH/2, -frustH/2, 0.01, 10000);
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
    if (_viewMenuItems.toolbar) _viewMenuItems.toolbar.classList.toggle('checked', _toggles.toolbar);
}

function buildViewMenu(dropdown) {
    dropdown.appendChild(ddItem('Fit to View', 'F', function() { fitCamera(); }));
    dropdown.appendChild(ddSep());

    [['Front','+z'],['Back','-z'],['Left','+x'],['Right','-x'],['Top','+y'],['Bottom','-y']].forEach(function(p) {
        dropdown.appendChild(ddItem(p[0], '', function() { setCameraPreset(p[1]); }));
    });

    dropdown.appendChild(ddSep());

    var orthoItem = ddItem('Perspective / Orthographic', '', function() { toggleOrthographic(); });
    _viewMenuItems.ortho = orthoItem;
    dropdown.appendChild(orthoItem);

    dropdown.appendChild(ddSep());

    var trackballItem = ddItem('Show Trackball', '', function() {
        _toggles.trackball = !_toggles.trackball;
        if (_trackballOverlay) _trackballOverlay.classList.toggle('hidden', !_toggles.trackball);
        updateViewMenuChecks();
    });
    trackballItem.classList.add('checked');
    _viewMenuItems.trackball = trackballItem;
    dropdown.appendChild(trackballItem);

    var toolbarItem = ddItem('Show Toolbar', '', function() {
        _toggles.toolbar = !_toggles.toolbar;
        if (_toolbar) _toolbar.classList.toggle('hidden', !_toggles.toolbar);
        updateViewMenuChecks();
    });
    toolbarItem.classList.add('checked');
    _viewMenuItems.toolbar = toolbarItem;
    dropdown.appendChild(toolbarItem);
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

    var matcapItem = ddItem('Matcap', 'M', function() { setRenderMode('matcap'); });
    _renderMenuItems.matcap = matcapItem;

    dropdown.appendChild(solidItem);
    dropdown.appendChild(wireItem);
    dropdown.appendChild(matcapItem);
    dropdown.appendChild(ddSep());

    var texItem = ddItem('Texture On/Off', 'T', function() {
        _toggles.texture = !_toggles.texture;
        if (_deps && _deps.updateModelTextures) _deps.updateModelTextures(_deps.modelGroup, _toggles.texture);
        updateRenderMenuChecks();
        syncToolbarRenderButtons();
    });
    texItem.classList.add('checked');
    _renderMenuItems.texture = texItem;
    dropdown.appendChild(texItem);

    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('Lighting', 'L', function() { toggleTool('light'); }));
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
    { key: 'M',      desc: 'Toggle Matcap' },
    { key: 'L',      desc: 'Lighting Widget' },
    { key: 'P',      desc: 'Take Screenshot' },
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

    var name = (_manifest && _manifest.title) || 'Vitrine3D Industrial Viewer';
    var version = (_manifest && _manifest.version) || '\u2014';
    body.innerHTML = '<strong>' + name + '</strong><br>Theme: Industrial (MeshLab Workbench)<br>Version: ' + version;

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

        var dropdown = createEl('div', 'ind-dropdown');
        dropdown.dataset.menuFor = def.id;
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
    inspGroup.appendChild(createToolBtn('slice', 'Section Plane [1]', ICONS.slice));
    inspGroup.appendChild(createToolBtn('measure', 'Measure [2]', ICONS.measure));
    inspGroup.appendChild(createToolBtn('annotate', 'Annotate [3]', ICONS.annotate));
    toolbar.appendChild(inspGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // Display toggles group
    var dispGroup = createEl('div', 'ind-toolbar-group');
    dispGroup.appendChild(createToggleBtn('matcap', 'Matcap [M]', ICONS.matcap));
    dispGroup.appendChild(createToggleBtn('texture', 'Texture [T]', ICONS.texture));
    dispGroup.appendChild(createToggleBtn('wireframe', 'Wireframe [W]', ICONS.wireframe));
    toolbar.appendChild(dispGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // Utility group
    var utilGroup = createEl('div', 'ind-toolbar-group');
    utilGroup.appendChild(createToolBtn('light', 'Light Direction [L]', ICONS.light));
    utilGroup.appendChild(createActionBtn('screenshot', 'Screenshot [P]', ICONS.screenshot));
    utilGroup.appendChild(createActionBtn('fitview', 'Fit to View [F]', ICONS.fitView));
    toolbar.appendChild(utilGroup);

    return toolbar;
}

function createToolBtn(tool, tooltip, icon) {
    var btn = createEl('button', 'ind-tool-btn', icon);
    btn.setAttribute('data-tool', tool);
    btn.setAttribute('data-tooltip', tooltip);
    btn.addEventListener('click', function () { toggleTool(tool); });
    return btn;
}

function createToggleBtn(toggle, tooltip, icon) {
    var btn = createEl('button', 'ind-tool-btn', icon);
    btn.setAttribute('data-toggle', toggle);
    btn.setAttribute('data-tooltip', tooltip);
    if (_toggles[toggle]) btn.classList.add('active');
    btn.addEventListener('click', function () { toggleDisplay(toggle); });
    return btn;
}

function createActionBtn(action, tooltip, icon) {
    var btn = createEl('button', 'ind-tool-btn', icon);
    btn.setAttribute('data-action', action);
    btn.setAttribute('data-tooltip', tooltip);
    btn.addEventListener('click', function () {
        if (action === 'screenshot') doScreenshot();
        else if (action === 'fitview') fitCamera();
    });
    return btn;
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

    // Right-aligned measurement readout
    var measureField = createEl('span', 'ind-status-right');
    measureField.id = 'ind-status-measure';
    bar.appendChild(measureField);

    return bar;
}

function createStatusField(id, value) {
    var el = createEl('span', 'ind-status-field', value || '\u2014');
    el.id = id;
    return el;
}

function createSectionControls() {
    var panel = createEl('div', 'ind-section-controls');

    var yBtn = createEl('button', 'ind-section-axis-btn active', 'Y');
    yBtn.setAttribute('data-axis', 'y');
    var xBtn = createEl('button', 'ind-section-axis-btn', 'X');
    xBtn.setAttribute('data-axis', 'x');
    var zBtn = createEl('button', 'ind-section-axis-btn', 'Z');
    zBtn.setAttribute('data-axis', 'z');

    panel.appendChild(yBtn);
    panel.appendChild(xBtn);
    panel.appendChild(zBtn);

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ind-section-slider';
    slider.min = '0';
    slider.max = '100';
    slider.value = '50';
    panel.appendChild(slider);

    var flipBtn = createEl('button', 'ind-section-flip-btn', ICONS.flip);
    flipBtn.setAttribute('data-tooltip', 'Flip');
    panel.appendChild(flipBtn);

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

// ---- setup ----

function setup(manifest, deps) {
    _manifest = manifest;
    _deps = deps;

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

    // Create section controls
    _sectionControls = createSectionControls();
    document.body.appendChild(_sectionControls);
    wireSliceControls();

    // Create light widget
    _lightWidget = createLightWidget();
    document.body.appendChild(_lightWidget);

    // Create trackball overlay
    _trackballOverlay = createTrackballOverlay();
    document.body.appendChild(_trackballOverlay);

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

    // Hide trackball during drag for cleaner viewport
    var viewerContainer = document.getElementById('viewer-container');
    if (viewerContainer) {
        viewerContainer.addEventListener('mousedown', function () {
            if (_trackballOverlay) _trackballOverlay.style.opacity = '0.3';
        });
        document.addEventListener('mouseup', function () {
            if (_trackballOverlay) _trackballOverlay.style.opacity = '';
        });
    }

    // Register keyboard shortcuts in capture phase
    window.addEventListener('keydown', function (e) {
        var activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
        if (e.ctrlKey || e.metaKey) return;

        var key = e.key.toLowerCase();
        var handled = false;

        switch (key) {
            case '1': toggleTool('slice'); handled = true; break;
            case '2': toggleTool('measure'); handled = true; break;
            case '3': toggleTool('annotate'); handled = true; break;
            case 't': toggleDisplay('texture'); handled = true; break;
            case 'm': toggleDisplay('matcap'); handled = true; break;
            case 'w': toggleDisplay('wireframe'); handled = true; break;
            case 'l': toggleTool('light'); handled = true; break;
            case 'p': doScreenshot(); handled = true; break;
            case 'f': fitCamera(); handled = true; break;
        }

        if (handled) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);
}

// ---- initLoadingScreen ----

function initLoadingScreen(container) {
    var inner = container.querySelector('#loading-inner') || container;
    inner.innerHTML = '';

    var center = document.createElement('div');
    center.className = 'ind-loading-center';

    var text = document.createElement('div');
    text.id = 'loading-text';
    text.textContent = 'Loading mesh\u2026';
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
        case 'm': toggleDisplay('matcap'); return true;
        case 't': toggleDisplay('texture'); return true;
        case 'w': toggleDisplay('wireframe'); return true;
        case 'l': toggleTool('light'); return true;
        case 'p': doScreenshot(); return true;
        case 'escape': deactivateAllTools(); return true;
        case 'f': fitCamera(); return true;
        default: return false;
    }
}

// ---- Self-register for kiosk discovery ----
if (!window.__KIOSK_LAYOUTS__) window.__KIOSK_LAYOUTS__ = {};
window.__KIOSK_LAYOUTS__['industrial'] = {
    setup: setup,
    initLoadingScreen: initLoadingScreen,
    onKeyboardShortcut: onKeyboardShortcut,
    hasOwnInfoPanel: true,
    hasOwnQualityToggle: true
};
