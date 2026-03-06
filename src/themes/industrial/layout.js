/**
 * Industrial Layout — CAD-workbench kiosk layout module for the industrial theme.
 *
 * No ES imports — receives ALL dependencies via the `deps` object passed to
 * setup(). Self-registers on window.__KIOSK_LAYOUTS__ for kiosk bootstrap
 * discovery (same pattern as editorial / gallery / exhibit).
 *
 * Design: CAD workbench viewer. Top toolbar with grouped icon buttons
 * (inspection / display / utility). Bottom status bar with monospace metadata.
 * Orbit-only navigation (no pan). Keyboard shortcuts for all tools.
 */

// ---- Module-scope state ----

var _deps = null;
var _activeTool = null;
var _toggles = { matcap: false, texture: true, wireframe: false };

// Light widget drag state
var _lightDragging = false;
var _lightAzimuth = Math.PI / 4;
var _lightElevation = Math.PI / 4;

// DOM references
var _toolbar = null;
var _statusBar = null;
var _sectionControls = null;
var _lightWidget = null;

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
    flip: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3v14M6 7l4-4 4 4M6 13l4 4 4-4"/></svg>'
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

function createEl(tag, className, innerHTML) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML) el.innerHTML = innerHTML;
    return el;
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
            // Compute center from model group position (avoids THREE import).
            // crossSection.start() accepts any object with x/y/z.
            var center = { x: 0, y: 0, z: 0 };
            if (_deps.modelGroup && _deps.modelGroup.children.length > 0) {
                // Use the first mesh's geometry bounding sphere if available
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
    // Map azimuth/elevation to a 2D position within the widget (0-100%)
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
                // Reset slider to middle
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

// ---- DOM creation ----

function createToolbar() {
    var toolbar = createEl('div', 'ind-toolbar');

    // Inspection tools group
    var inspGroup = createEl('div', 'ind-toolbar-group');
    inspGroup.appendChild(createToolBtn('slice', 'Section Plane (1)', ICONS.slice));
    inspGroup.appendChild(createToolBtn('measure', 'Measure (2)', ICONS.measure));
    inspGroup.appendChild(createToolBtn('annotate', 'Annotate (3)', ICONS.annotate));
    toolbar.appendChild(inspGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // Display toggles group
    var dispGroup = createEl('div', 'ind-toolbar-group');
    dispGroup.appendChild(createToggleBtn('matcap', 'Matcap (M)', ICONS.matcap));
    dispGroup.appendChild(createToggleBtn('texture', 'Texture (T)', ICONS.texture));
    dispGroup.appendChild(createToggleBtn('wireframe', 'Wireframe (W)', ICONS.wireframe));
    toolbar.appendChild(dispGroup);

    toolbar.appendChild(createEl('div', 'ind-toolbar-sep'));

    // Utility group
    var utilGroup = createEl('div', 'ind-toolbar-group');
    utilGroup.appendChild(createToolBtn('light', 'Light Direction (L)', ICONS.light));
    utilGroup.appendChild(createActionBtn('screenshot', 'Screenshot (P)', ICONS.screenshot));
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
    // Set initial active state
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
    });
    return btn;
}

function createStatusBar(manifest) {
    var bar = createEl('div', 'ind-status-bar');

    // Filename
    var filename = (manifest && manifest.title) ||
        (manifest && manifest.assets && manifest.assets[0] && manifest.assets[0].filename) ||
        null;

    bar.appendChild(createStatusField('ind-status-filename', filename));
    bar.appendChild(createEl('span', 'ind-status-sep', '|'));

    // Vertices (computed after DOM insertion)
    bar.appendChild(createStatusField('ind-status-vertices', null));
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
    bar.appendChild(createEl('span', 'ind-status-sep', '|'));

    // Date
    var date = (manifest && manifest.date) ||
        (manifest && manifest.metadata && manifest.metadata.date) ||
        null;
    bar.appendChild(createStatusField('ind-status-date', date));

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

// ---- setup ----

function setup(manifest, deps) {
    _deps = deps;

    // Lock orbit-only navigation
    var controls = deps.sceneManager ? deps.sceneManager.controls : null;
    if (controls) {
        controls.enablePan = false;
        if (controls.mouseButtons) {
            controls.mouseButtons.RIGHT = null;
        }
    }

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

    // Update initial light indicator position
    updateLightIndicator();

    // Populate vertex count (after models are loaded)
    var vertCount = countVertices(deps.modelGroup) + countVertices(deps.pointcloudGroup);
    var vertEl = document.getElementById('ind-status-vertices');
    if (vertEl && vertCount > 0) {
        vertEl.textContent = formatNumber(vertCount) + ' verts';
    }

    // Set texture toggle button active by default (texture starts on)
    var texBtn = _toolbar.querySelector('[data-toggle="texture"]');
    if (texBtn) texBtn.classList.add('active');

    // Register keyboard shortcuts in capture phase so they fire before
    // kiosk-main's default handlers (which bind 1/2/3 to view-mode switching).
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
    text.textContent = 'Loading...';
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
