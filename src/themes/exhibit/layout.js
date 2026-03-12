/**
 * Exhibit Layout — institutional kiosk layout module for the exhibit theme.
 *
 * No ES imports — receives ALL dependencies via the `deps` object passed to
 * setup(). Self-registers on window.__KIOSK_LAYOUTS__ for kiosk bootstrap
 * discovery (same pattern as editorial / gallery).
 *
 * Design: museum kiosk. Persistent bottom toolbar with labeled icon buttons.
 * Structured wall-label plaque. Full-screen info as bottom-sheet with card grid.
 * Attract mode after 60 s of inactivity: auto-orbit + annotation slideshow.
 */

// ---- Private helpers ----

function formatDate(raw, style) {
    if (!raw) return raw;
    var d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    if (style === 'medium') {
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function hasValue(val) {
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') {
        return Object.keys(val).filter(function (k) { return !k.startsWith('_'); }).some(function (k) { return hasValue(val[k]); });
    }
    return true;
}

function createDetailEl(prefix, label, value) {
    var el = document.createElement('div');
    el.className = prefix;
    el.innerHTML = '<span class="exhibit-detail-label">' + label + '</span><span class="exhibit-detail-value">' + value + '</span>';
    return el;
}

function createDetail(label, value) { return createDetailEl('exhibit-detail', label, value); }

// ---- Attract mode state ----

var ATTRACT_TIMEOUT = 60000;
var ANNOTATION_DWELL = 8000;
var _attractTimer = null;
var _attractActive = false;
var _attractCycleTimer = null;
var _attractCycleIndex = 0;
var _savedAutoRotate = false;

// References set during setup
var _attractToolbar = null;
var _attractAnnoStrip = null;
var _attractPlaque = null;
var _attractControls = null;
var _attractAnnotationSystem = null;
var _attractAnnotations = [];
var _attractShowPopup = null;
var _attractHidePopup = null;
var _attractHideLine = null;
var _attractSetPopupId = null;
var _attractState = null;

function resetAttractTimer() {
    clearTimeout(_attractTimer);
    if (_attractActive) exitAttractMode();
    _attractTimer = setTimeout(enterAttractMode, ATTRACT_TIMEOUT);
}

function enterAttractMode() {
    _attractActive = true;

    // Enable auto-rotate
    if (_attractControls) {
        _savedAutoRotate = _attractControls.autoRotate;
        _attractControls.autoRotate = true;
        _attractControls.autoRotateSpeed = 0.4;
    }

    // Fade out chrome
    if (_attractToolbar) _attractToolbar.classList.add('exhibit-attract');
    if (_attractAnnoStrip) _attractAnnoStrip.classList.add('exhibit-attract');
    if (_attractPlaque) _attractPlaque.classList.add('exhibit-attract');

    // Close info overlay if open
    var infoOverlay = document.querySelector('.exhibit-info-overlay');
    if (infoOverlay) infoOverlay.classList.remove('open');

    // Start annotation slideshow
    if (_attractAnnotations.length > 0 && _attractAnnotationSystem) {
        _attractCycleIndex = 0;
        cycleAnnotation();
    }
}

function exitAttractMode() {
    _attractActive = false;

    // Restore auto-rotate
    if (_attractControls) {
        _attractControls.autoRotate = _savedAutoRotate;
    }

    // Restore chrome
    if (_attractToolbar) _attractToolbar.classList.remove('exhibit-attract');
    if (_attractAnnoStrip) _attractAnnoStrip.classList.remove('exhibit-attract');
    if (_attractPlaque) _attractPlaque.classList.remove('exhibit-attract');

    // Stop annotation cycling
    clearTimeout(_attractCycleTimer);
    if (_attractHidePopup) _attractHidePopup();
    if (_attractHideLine) _attractHideLine();
    if (_attractSetPopupId) _attractSetPopupId(null);
    if (_attractAnnotationSystem) _attractAnnotationSystem.selectedAnnotation = null;
    document.querySelectorAll('.annotation-marker.selected').forEach(function (m) { m.classList.remove('selected'); });
}

function cycleAnnotation() {
    if (!_attractActive || _attractAnnotations.length === 0) return;
    var anno = _attractAnnotations[_attractCycleIndex];

    // Go to annotation
    if (_attractAnnotationSystem && _attractAnnotationSystem.goToAnnotation) {
        _attractAnnotationSystem.goToAnnotation(anno.id);
    }
    if (_attractShowPopup && _attractState) {
        var popupId = _attractShowPopup(anno, _attractState.imageAssets);
        if (_attractSetPopupId) _attractSetPopupId(popupId);
    }

    // Highlight strip button
    var stripBtns = document.querySelectorAll('.exhibit-anno-btn');
    stripBtns.forEach(function (btn, i) {
        btn.classList.toggle('active', i === _attractCycleIndex);
    });

    _attractCycleIndex = (_attractCycleIndex + 1) % _attractAnnotations.length;
    _attractCycleTimer = setTimeout(cycleAnnotation, ANNOTATION_DWELL);
}

function initAttractListeners() {
    ['mousemove', 'mousedown', 'keydown', 'wheel'].forEach(function (evt) {
        document.addEventListener(evt, resetAttractTimer);
    });
    ['touchstart', 'touchmove'].forEach(function (evt) {
        document.addEventListener(evt, resetAttractTimer, { passive: true });
    });
    // Start the initial timer
    _attractTimer = setTimeout(enterAttractMode, ATTRACT_TIMEOUT);
}

// ---- Info overlay builder ----

function createInfoOverlay(manifest, deps) {
    var escapeHtml = deps.escapeHtml;
    var parseMarkdown = deps.parseMarkdown;
    var resolveAssetRefs = deps.resolveAssetRefs;
    var state = deps.state;
    var annotationSystem = deps.annotationSystem;
    var modelGroup = deps.modelGroup;

    var metadataProfile = deps.metadataProfile || 'archival';
    var shouldShow = function (title) {
        var tiers = deps.EDITORIAL_SECTION_TIERS;
        var tier = tiers && tiers[title];
        if (!tier || !deps.isTierVisible) return true;
        return deps.isTierVisible(tier, metadataProfile);
    };

    var overlay = document.createElement('div');
    overlay.className = 'exhibit-info-overlay';

    // --- Sticky close header bar ---
    var headerBar = document.createElement('div');
    headerBar.className = 'exhibit-info-header-bar';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'exhibit-info-close';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>Close</span>';
    closeBtn.addEventListener('click', function () { overlay.classList.remove('open'); });
    headerBar.appendChild(closeBtn);
    overlay.appendChild(headerBar);

    var contentCol = document.createElement('div');
    contentCol.className = 'exhibit-info-content';

    // --- Hero image ---
    var imageAssets = state.imageAssets || {};
    var desc = (manifest && manifest.description) || (manifest && manifest.project && manifest.project.description) || '';
    var stripSrc = null;
    var assetKeys = Object.keys(imageAssets);
    if (assetKeys.length > 0) {
        stripSrc = imageAssets['preview.jpg'] || imageAssets['preview.png'] || imageAssets[assetKeys[0]];
    }
    if (!stripSrc && desc) {
        var tmp = document.createElement('div');
        tmp.innerHTML = parseMarkdown(resolveAssetRefs(desc, imageAssets));
        var firstImg = tmp.querySelector('img');
        if (firstImg) stripSrc = firstImg.src;
    }

    if (stripSrc) {
        var hero = document.createElement('div');
        hero.className = 'exhibit-info-hero';
        var img = document.createElement('img');
        img.src = stripSrc;
        img.alt = '';
        img.draggable = false;
        hero.appendChild(img);
        contentCol.appendChild(hero);
    }

    // --- Title + byline ---
    var title = (manifest && manifest.title) || (manifest && manifest.project && manifest.project.title) || '';
    var location = (manifest && manifest.location) || '';
    var rawDate = (manifest && manifest.date) || (manifest && manifest.provenance && manifest.provenance.capture_date) || '';
    var date = formatDate(rawDate, 'medium') || rawDate;
    var metaParts = [location, date].filter(Boolean);

    var titleEl = document.createElement('h2');
    titleEl.className = 'exhibit-info-title';
    titleEl.textContent = title;
    contentCol.appendChild(titleEl);

    var titleBar = document.createElement('div');
    titleBar.className = 'exhibit-info-title-bar';
    contentCol.appendChild(titleBar);

    if (metaParts.length > 0) {
        var byline = document.createElement('p');
        byline.className = 'exhibit-info-byline';
        byline.textContent = metaParts.join(' \u00B7 ');
        contentCol.appendChild(byline);
    }

    // Model stats
    if (modelGroup && modelGroup.children.length > 0) {
        var vertexCount = 0;
        var textureSet = new Set();
        var maxTexRes = 0;
        modelGroup.traverse(function (child) {
            if (child.isMesh && child.geometry) {
                var geo = child.geometry;
                if (geo.attributes.position) vertexCount += geo.attributes.position.count;
                var mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(function (m) {
                    if (m) {
                        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(function (t) {
                            var tex = m[t];
                            if (tex && !textureSet.has(tex)) {
                                textureSet.add(tex);
                                var texImg = tex.image;
                                if (texImg && texImg.width) maxTexRes = Math.max(maxTexRes, texImg.width, texImg.height);
                            }
                        });
                    }
                });
            }
        });
        if (vertexCount > 0) {
            var statParts = [];
            var fmt = function (n) { return n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M' : n.toLocaleString(); };
            statParts.push('<strong>' + fmt(vertexCount) + '</strong> vertices');
            if (textureSet.size > 0) statParts.push('<strong>' + textureSet.size + '</strong> textures @ ' + maxTexRes + '\u00B2');
            var annoCount = annotationSystem ? annotationSystem.getAnnotations().length : 0;
            if (annoCount > 0) statParts.push('<strong>' + annoCount + '</strong> annotations');
            var statsEl = document.createElement('div');
            statsEl.className = 'exhibit-info-model-stats';
            statsEl.innerHTML = statParts.join(' \u00B7 ');
            contentCol.appendChild(statsEl);
        }
    }

    // --- Description ---
    if (desc) {
        var descEl = document.createElement('div');
        descEl.className = 'exhibit-info-description';
        descEl.innerHTML = parseMarkdown(resolveAssetRefs(desc, imageAssets));
        if (stripSrc) {
            var descFirstImg = descEl.querySelector('img');
            if (descFirstImg) {
                var parent = descFirstImg.parentElement;
                descFirstImg.remove();
                if (parent && parent.tagName === 'P' && parent.textContent.trim() === '') parent.remove();
            }
        }
        contentCol.appendChild(descEl);
    }

    // --- Card grid ---
    var gridEl = document.createElement('div');
    gridEl.className = 'exhibit-info-grid';
    var cardsAdded = 0;

    // Helper to create a card
    function addCard(eyebrow, buildFn) {
        var card = document.createElement('div');
        card.className = 'exhibit-info-card';
        var eyebrowEl = document.createElement('div');
        eyebrowEl.className = 'exhibit-info-card-eyebrow';
        eyebrowEl.textContent = eyebrow;
        card.appendChild(eyebrowEl);
        buildFn(card);
        if (card.children.length > 1) { // eyebrow + at least one content element
            gridEl.appendChild(card);
            cardsAdded++;
        }
    }

    // Card: The Subject
    var ar = manifest && manifest.archival_record;
    if (ar && hasValue(ar) && shouldShow('The Subject')) {
        addCard('Subject', function (card) {
            var grid = document.createElement('div');
            grid.className = 'exhibit-detail-grid';
            var creation = ar.creation || {};
            var phys = ar.physical_description || {};
            if (creation.creator) grid.appendChild(createDetail('Creator', escapeHtml(creation.creator)));
            var creationDate = creation.date || creation.date_created;
            if (creationDate) grid.appendChild(createDetail('Date', escapeHtml(String(creationDate))));
            if (creation.period) grid.appendChild(createDetail('Period', escapeHtml(creation.period)));
            if (creation.place) grid.appendChild(createDetail('Place', escapeHtml(creation.place)));
            if (creation.culture) grid.appendChild(createDetail('Culture', escapeHtml(creation.culture)));
            if (phys.medium) grid.appendChild(createDetail('Medium', escapeHtml(phys.medium)));
            if (phys.dimensions) {
                var dim = phys.dimensions;
                var dimStr = typeof dim === 'object'
                    ? [dim.height, dim.width, dim.depth].filter(Boolean).join(' \u00D7 ') || JSON.stringify(dim)
                    : String(dim);
                grid.appendChild(createDetail('Dimensions', escapeHtml(dimStr)));
            }
            if (phys.condition) grid.appendChild(createDetail('Condition', escapeHtml(phys.condition)));
            if (grid.children.length > 0) card.appendChild(grid);

            // Location
            var subjLoc = (ar.coverage && ar.coverage.spatial && (ar.coverage.spatial.place || ar.coverage.spatial.location_name)) || (manifest && manifest.location);
            if (subjLoc) {
                var locLabeled = document.createElement('div');
                locLabeled.className = 'exhibit-prose-labeled';
                var locLabel = document.createElement('div');
                locLabel.className = 'exhibit-prose-sub-label';
                locLabel.textContent = 'Location';
                locLabeled.appendChild(locLabel);
                var locName = document.createElement('div');
                locName.className = 'exhibit-location-name';
                locName.textContent = subjLoc;
                locLabeled.appendChild(locName);
                card.appendChild(locLabeled);
            }

            // Historical context
            if (ar.context && ar.context.description) {
                var proseLabeled = document.createElement('div');
                proseLabeled.className = 'exhibit-prose-labeled';
                var subLabel = document.createElement('div');
                subLabel.className = 'exhibit-prose-sub-label';
                subLabel.textContent = 'Historical Context';
                proseLabeled.appendChild(subLabel);
                var proseBlock = document.createElement('div');
                proseBlock.className = 'exhibit-prose-block';
                proseBlock.innerHTML = parseMarkdown(ar.context.description);
                proseLabeled.appendChild(proseBlock);
                card.appendChild(proseLabeled);
            }

            // Provenance
            if (ar.provenance) {
                var provLabeled = document.createElement('div');
                provLabeled.className = 'exhibit-prose-labeled';
                var provLabel = document.createElement('div');
                provLabel.className = 'exhibit-prose-sub-label';
                provLabel.textContent = 'Provenance';
                provLabeled.appendChild(provLabel);
                var provBlock = document.createElement('div');
                provBlock.className = 'exhibit-prose-block';
                provBlock.innerHTML = parseMarkdown(ar.provenance);
                provLabeled.appendChild(provBlock);
                card.appendChild(provLabeled);
            }
        });
    }

    // Card: Quality & Capture
    var qm = manifest && manifest.quality_metrics;
    var prov = manifest && manifest.provenance;
    var hasQuality = qm && hasValue(qm);
    var hasCapture = prov && (prov.capture_device || prov.device_serial);
    var operator = (manifest && manifest.creator) || (prov && prov.operator);
    if ((hasQuality || hasCapture || operator) && shouldShow('Quality & Capture')) {
        addCard('Quality & Capture', function (card) {
            if (operator) {
                var creditLine = document.createElement('div');
                creditLine.className = 'exhibit-credit-line';
                creditLine.innerHTML = '<span class="org">' + escapeHtml(operator) + '</span>';
                card.appendChild(creditLine);
            }
            var grid = document.createElement('div');
            grid.className = 'exhibit-detail-grid';
            if (qm) {
                if (qm.tier) grid.appendChild(createDetail('Tier', escapeHtml(String(qm.tier))));
                if (qm.accuracy_grade) grid.appendChild(createDetail('Accuracy', escapeHtml('Grade ' + qm.accuracy_grade)));
                if (qm.capture_resolution && qm.capture_resolution.value != null) {
                    var cr = qm.capture_resolution;
                    grid.appendChild(createDetail('Resolution', escapeHtml(cr.value + (cr.unit || '') + ' GSD')));
                }
                if (qm.alignment_error && qm.alignment_error.value != null) {
                    var ae = qm.alignment_error;
                    grid.appendChild(createDetail('Alignment', escapeHtml(ae.value + (ae.unit || '') + ' RMSE')));
                }
                if (qm.scale_verification) grid.appendChild(createDetail('Scale Check', escapeHtml(qm.scale_verification)));
            }
            if (prov && prov.capture_device) grid.appendChild(createDetail('Device', escapeHtml(prov.capture_device)));
            if (prov && prov.device_serial) grid.appendChild(createDetail('Serial', escapeHtml(prov.device_serial)));
            if (grid.children.length > 0) card.appendChild(grid);

            // Secondary quality data
            if (qm && hasValue(qm.data_quality)) {
                var secGrid = document.createElement('div');
                secGrid.className = 'exhibit-detail-grid';
                secGrid.style.marginTop = '12px';
                Object.keys(qm.data_quality).forEach(function (k) {
                    secGrid.appendChild(createDetail(
                        escapeHtml(k.replace(/_/g, ' ')),
                        escapeHtml(String(qm.data_quality[k]))
                    ));
                });
                card.appendChild(secGrid);
            }

            // Processing software
            if (prov) {
                var hasSoftware = Array.isArray(prov.processing_software) && prov.processing_software.length > 0;
                if (hasSoftware) {
                    var swLine = document.createElement('div');
                    swLine.className = 'exhibit-software-line';
                    swLine.style.marginTop = '12px';
                    var names = prov.processing_software.map(function (sw) {
                        return typeof sw === 'object' ? ((sw.name || '') + (sw.version ? ' ' + sw.version : '')).trim() : sw;
                    }).filter(Boolean);
                    swLine.innerHTML = '<strong>Software</strong> ' + escapeHtml(names.join(' \u00B7 '));
                    card.appendChild(swLine);
                }
                if (prov.processing_notes) {
                    var notesBlock = document.createElement('div');
                    notesBlock.className = 'exhibit-prose-block';
                    notesBlock.style.marginTop = '8px';
                    notesBlock.innerHTML = parseMarkdown(prov.processing_notes);
                    card.appendChild(notesBlock);
                }
            }
        });
    }

    // Card: Data Assets
    var entries = manifest && manifest.data_entries;
    if (entries && !Array.isArray(entries) && typeof entries === 'object') {
        entries = Object.values(entries).filter(function (e) { return e && typeof e === 'object'; });
    }
    if (Array.isArray(entries) && entries.length > 0 && shouldShow('Data Assets')) {
        addCard('Data Assets', function (card) {
            entries.forEach(function (entry) {
                var item = document.createElement('div');
                item.className = 'exhibit-asset-item';

                var headerEl = document.createElement('div');
                headerEl.className = 'exhibit-asset-header';
                if (entry.role) {
                    var roleEl = document.createElement('span');
                    roleEl.className = 'exhibit-asset-role';
                    roleEl.textContent = entry.role;
                    headerEl.appendChild(roleEl);
                }
                var nameEl = document.createElement('span');
                nameEl.className = 'exhibit-asset-filename';
                nameEl.textContent = entry.file_name || entry.filename || '';
                headerEl.appendChild(nameEl);
                item.appendChild(headerEl);

                var metaChips = [];
                if (entry.file_size) metaChips.push(entry.file_size);
                if (entry.splat_count) metaChips.push(Number(entry.splat_count).toLocaleString() + ' splats');
                if (entry.polygon_count) metaChips.push(Number(entry.polygon_count).toLocaleString() + ' polygons');
                if (entry.vertex_count) metaChips.push(Number(entry.vertex_count).toLocaleString() + ' vertices');
                if (metaChips.length > 0) {
                    var metaRow = document.createElement('div');
                    metaRow.className = 'exhibit-asset-meta';
                    metaChips.forEach(function (chip) {
                        var chipEl = document.createElement('span');
                        chipEl.className = 'exhibit-asset-meta-chip';
                        chipEl.textContent = chip;
                        metaRow.appendChild(chipEl);
                    });
                    item.appendChild(metaRow);
                }
                card.appendChild(item);
            });
        });
    }

    // Card: Technical Details
    if (shouldShow('Technical Details')) {
        var hasTech = ar || (manifest && manifest.material_standard) || (manifest && manifest.preservation) || (manifest && manifest.integrity);
        if (hasTech) {
            addCard('Technical', function (card) {
                var grid = document.createElement('div');
                grid.className = 'exhibit-detail-grid';

                if (ar && ar.standard) grid.appendChild(createDetail('Standard', escapeHtml(ar.standard)));
                var copyrightVal = ar && ar.rights && (ar.rights.holder || ar.rights.copyright_status);
                if (copyrightVal) grid.appendChild(createDetail('Copyright', escapeHtml(copyrightVal)));
                var matStd = manifest && manifest.material_standard;
                if (matStd) {
                    if (matStd.workflow) grid.appendChild(createDetail('Material', escapeHtml(matStd.workflow)));
                    if (matStd.color_space) grid.appendChild(createDetail('Color Space', escapeHtml(matStd.color_space)));
                    var normalVal = matStd.normal_convention || matStd.normal_space;
                    if (normalVal) grid.appendChild(createDetail('Normal', escapeHtml(normalVal)));
                }
                var pres = manifest && manifest.preservation;
                if (pres && pres.rendering_requirements) grid.appendChild(createDetail('Rendering', escapeHtml(pres.rendering_requirements)));
                if (grid.children.length > 0) card.appendChild(grid);

                // Significant properties
                if (pres && pres.significant_properties && pres.significant_properties.length > 0) {
                    var subHead = document.createElement('div');
                    subHead.className = 'exhibit-tech-sub-header';
                    subHead.textContent = 'Significant Properties';
                    card.appendChild(subHead);
                    var propsRow = document.createElement('div');
                    propsRow.className = 'exhibit-sig-props';
                    pres.significant_properties.forEach(function (prop) {
                        var chip = document.createElement('span');
                        chip.className = 'exhibit-sig-prop';
                        chip.textContent = prop;
                        propsRow.appendChild(chip);
                    });
                    card.appendChild(propsRow);
                }

                // Integrity hashes
                var integ = manifest && manifest.integrity;
                var hashEntries = [];
                if (integ && Array.isArray(integ.checksums) && integ.checksums.length > 0) {
                    hashEntries = integ.checksums.map(function (cs) { return { file: cs.file || '', hash: cs.hash || cs.value || '' }; });
                } else if (integ && integ.assets && typeof integ.assets === 'object') {
                    hashEntries = Object.entries(integ.assets).map(function (pair) { return { file: pair[0], hash: String(pair[1]) }; });
                }
                if (hashEntries.length > 0) {
                    var hashHead = document.createElement('div');
                    hashHead.className = 'exhibit-tech-sub-header';
                    hashHead.textContent = 'Integrity \u2014 ' + escapeHtml((integ && integ.algorithm) || 'SHA-256');
                    card.appendChild(hashHead);
                    var hashList = document.createElement('ul');
                    hashList.className = 'exhibit-hash-list';
                    hashEntries.forEach(function (entry) {
                        var li = document.createElement('li');
                        var truncated = entry.hash.length > 16 ? entry.hash.slice(0, 8) + '...' + entry.hash.slice(-8) : entry.hash;
                        li.innerHTML = '<span>' + escapeHtml(entry.file) + '</span> ' + escapeHtml(truncated);
                        hashList.appendChild(li);
                    });
                    card.appendChild(hashList);
                }

                // Dates
                var creationDateVal = manifest && (manifest._creation_date || (manifest._meta && manifest._meta.created));
                var modifiedDate = manifest && (manifest._last_modified || (manifest._meta && manifest._meta.modified));
                if (creationDateVal || modifiedDate) {
                    var datesGrid = document.createElement('div');
                    datesGrid.className = 'exhibit-detail-grid';
                    datesGrid.style.marginTop = '12px';
                    if (creationDateVal) datesGrid.appendChild(createDetail('Created', escapeHtml(String(creationDateVal))));
                    if (modifiedDate) datesGrid.appendChild(createDetail('Last Modified', escapeHtml(String(modifiedDate))));
                    card.appendChild(datesGrid);
                }
            });
        }
    }

    // Card: Tags
    var tags = (manifest && manifest.tags) || (manifest && manifest.project && manifest.project.tags) || [];
    if (tags.length > 0 && shouldShow('Tags')) {
        addCard('Tags', function (card) {
            var tagsRow = document.createElement('div');
            tagsRow.className = 'exhibit-info-tags';
            tags.forEach(function (tag) {
                var chip = document.createElement('span');
                chip.className = 'exhibit-tag-chip';
                chip.textContent = tag;
                tagsRow.appendChild(chip);
            });
            card.appendChild(tagsRow);
        });
    }

    if (cardsAdded > 0) {
        contentCol.appendChild(gridEl);
    }

    // --- License footer ---
    var license = (manifest && manifest.license) || (manifest && manifest.project && manifest.project.license) ||
                  (ar && ar.rights && (ar.rights.license || ar.rights.statement)) || '';
    if (license) {
        var licenseEl = document.createElement('div');
        licenseEl.className = 'exhibit-info-license';
        licenseEl.textContent = license;
        contentCol.appendChild(licenseEl);
    }

    overlay.appendChild(contentCol);
    return overlay;
}

// ---- Walkthrough state ----

var _wtStripEl = null;
var _wtSteps = null;
var _wtConnectors = null;
var _wtCard = null;
var _wtCardTimer = null;
var _wtPrev = null;
var _wtNext = null;
var _walkthroughActive = false;

// ---- Cleanup — remove all DOM elements created by setup() ----

var EXHIBIT_ROOT_CLASSES = [
    'exhibit-plaque',
    'exhibit-toolbar',
    'exhibit-info-overlay',
    'exhibit-anno-strip',
    'exhibit-wt-card',
    'exhibit-wt-strip',
    'exhibit-wt-prev',
    'exhibit-wt-next'
];

function cleanup() {
    var viewerContainer = document.getElementById('viewer-container') || document.body;
    EXHIBIT_ROOT_CLASSES.forEach(function(cls) {
        viewerContainer.querySelectorAll('.' + cls).forEach(function(el) { el.remove(); });
    });
    if (_attractTimer) { clearTimeout(_attractTimer); _attractTimer = null; }
    if (_attractCycleTimer) { clearTimeout(_attractCycleTimer); _attractCycleTimer = null; }
    _attractActive = false;
    _walkthroughActive = false;
    _wtStripEl = null;
    _wtSteps = null;
    _wtConnectors = null;
    _wtCard = null;
    if (_wtCardTimer) { clearTimeout(_wtCardTimer); _wtCardTimer = null; }
    _wtPrev = null;
    _wtNext = null;
}

// ---- Main setup ----

function setup(manifest, deps) {
    var Logger = deps.Logger;
    var escapeHtml = deps.escapeHtml;
    var sceneManager = deps.sceneManager;
    var state = deps.state;
    var annotationSystem = deps.annotationSystem;
    var setDisplayMode = deps.setDisplayMode;
    var createDisplayModeDeps = deps.createDisplayModeDeps;
    var triggerLazyLoad = deps.triggerLazyLoad;
    var showAnnotationPopup = deps.showAnnotationPopup;
    var hideAnnotationPopup = deps.hideAnnotationPopup;
    var hideAnnotationLine = deps.hideAnnotationLine;
    var getCurrentPopupId = deps.getCurrentPopupId;
    var setCurrentPopupId = deps.setCurrentPopupId;

    var log = Logger.getLogger('exhibit-layout');
    log.info('Setting up exhibit layout');

    // Remove any previously-created exhibit layout elements (re-entry safe)
    cleanup();

    var viewerContainer = document.getElementById('viewer-container') || document.body;

    // Set scene background from theme metadata.
    // Skip if the archive manifest declares its own background override — the
    // kiosk loader applies that override after setup() returns.
    var hasArchiveBgOverride = manifest && manifest.viewer_settings &&
        (manifest.viewer_settings.splat_background_color ||
         manifest.viewer_settings.mesh_background_color ||
         manifest.viewer_settings.background_color);
    if (!hasArchiveBgOverride) {
        var themeMeta = (window.APP_CONFIG || {})._themeMeta;
        var sceneBg = (themeMeta && themeMeta.sceneBg) ||
            getComputedStyle(document.body).getPropertyValue('--kiosk-scene-bg').trim() ||
            '#11304e';
        sceneManager.setBackgroundColor(sceneBg);
    }

    // --- 1. Title Plaque ---
    var title = (manifest && manifest.title) || (manifest && manifest.project && manifest.project.title) ||
                (manifest && manifest.archival_record && manifest.archival_record.title) || '';
    var location = (manifest && manifest.location) || (manifest && manifest.provenance && manifest.provenance.location) ||
                   (manifest && manifest.archival_record && manifest.archival_record.creation && manifest.archival_record.creation.place) || '';
    var rawDate = (manifest && manifest.date) || (manifest && manifest.provenance && manifest.provenance.capture_date) ||
                  (manifest && manifest.archival_record && manifest.archival_record.creation && manifest.archival_record.creation.date) || '';
    var date = formatDate(rawDate, 'medium') || rawDate;
    var creator = (manifest && manifest.creator) || (manifest && manifest.provenance && manifest.provenance.operator) ||
                  (manifest && manifest.archival_record && manifest.archival_record.creation && manifest.archival_record.creation.creator) || '';

    var plaque = document.createElement('div');
    plaque.className = 'exhibit-plaque splash';

    var plaqueTitle = document.createElement('h1');
    plaqueTitle.className = 'exhibit-plaque-title';
    plaqueTitle.textContent = title;
    plaque.appendChild(plaqueTitle);

    var plaqueRule = document.createElement('div');
    plaqueRule.className = 'exhibit-plaque-rule';
    plaque.appendChild(plaqueRule);

    var plaqueFields = document.createElement('dl');
    plaqueFields.className = 'exhibit-plaque-fields';

    var fieldData = [];
    if (creator) fieldData.push({ label: 'Artist', value: creator });
    if (date) fieldData.push({ label: 'Date', value: date });
    if (location) fieldData.push({ label: 'Location', value: location });

    fieldData.forEach(function (f) {
        var field = document.createElement('div');
        field.className = 'exhibit-plaque-field';
        field.innerHTML = '<dt>' + escapeHtml(f.label) + '</dt><dd>' + escapeHtml(f.value) + '</dd>';
        plaqueFields.appendChild(field);
    });

    plaque.appendChild(plaqueFields);
    viewerContainer.appendChild(plaque);

    // Splash → plaque transition: collapse after 3s or first interaction
    var splashCollapsed = false;
    function collapseSplash() {
        if (splashCollapsed) return;
        splashCollapsed = true;
        plaque.classList.remove('splash');
    }
    setTimeout(collapseSplash, 3000);
    document.addEventListener('mousedown', collapseSplash, { once: true });
    document.addEventListener('touchstart', collapseSplash, { once: true, passive: true });
    document.addEventListener('keydown', collapseSplash, { once: true });

    // --- 2. Bottom Toolbar ---
    var toolbar = document.createElement('div');
    toolbar.className = 'exhibit-toolbar';

    // SVG icon templates
    var ICONS = {
        model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5"/><path d="M12 12v9"/><path d="M12 12L4 7.5"/></svg>',
        splat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity="0.4"/><circle cx="12" cy="12" r="10" opacity="0.2"/></svg>',
        cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="8" r="1.5"/><circle cx="12" cy="6" r="1.5"/><circle cx="18" cy="9" r="1.5"/><circle cx="8" cy="14" r="1.5"/><circle cx="15" cy="13" r="1.5"/><circle cx="10" cy="19" r="1.5"/><circle cx="17" cy="18" r="1.5"/></svg>',
        both: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" opacity="0.5"/><circle cx="8" cy="10" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="12" cy="15" r="1"/></svg>',
        annotation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        fullscreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
    };

    function createToolBtn(icon, label, extraClass) {
        var btn = document.createElement('button');
        btn.className = 'exhibit-tool-btn' + (extraClass ? ' ' + extraClass : '');
        btn.innerHTML = icon + '<span class="exhibit-tool-label">' + label + '</span>';
        return btn;
    }

    // View mode group
    var viewGroup = document.createElement('div');
    viewGroup.className = 'exhibit-toolbar-group';

    var contentInfo = state.archiveLoader ? state.archiveLoader.getContentInfo() : null;
    var types = [];
    if (contentInfo) {
        if (contentInfo.hasMesh) types.push({ mode: 'model', label: 'Model', icon: ICONS.model });
        if (contentInfo.hasSplat) types.push({ mode: 'splat', label: 'Splat', icon: ICONS.splat });
        if (contentInfo.hasPointcloud) types.push({ mode: 'pointcloud', label: 'Cloud', icon: ICONS.cloud });
    }
    if (types.length >= 2) {
        types.push({ mode: 'both', label: 'Both', icon: ICONS.both });
    }

    types.forEach(function (t) {
        var btn = createToolBtn(t.icon, t.label, 'exhibit-view-btn');
        btn.dataset.mode = t.mode;
        if (state.displayMode === t.mode) btn.classList.add('active');
        btn.addEventListener('click', function () {
            state.displayMode = t.mode;
            setDisplayMode(t.mode, createDisplayModeDeps());
            triggerLazyLoad(t.mode);
            if (deps.applyBackgroundForMode) deps.applyBackgroundForMode(t.mode);
            toolbar.querySelectorAll('.exhibit-view-btn').forEach(function (b) {
                b.classList.toggle('active', b.dataset.mode === t.mode);
            });
        });
        viewGroup.appendChild(btn);
    });

    if (types.length > 0) {
        toolbar.appendChild(viewGroup);
        var sep1 = document.createElement('div');
        sep1.className = 'exhibit-toolbar-sep';
        toolbar.appendChild(sep1);
    }

    // Quality group
    if (deps.hasAnyProxy || deps.hasSplat || deps.hasMesh) {
        var qualityGroup = document.createElement('div');
        qualityGroup.className = 'exhibit-toolbar-group';

        var sdBtn = createToolBtn('', 'SD');
        sdBtn.dataset.tier = 'sd';
        sdBtn.querySelector('.exhibit-tool-label').style.fontSize = '0.72rem';
        if (deps.qualityResolved === 'sd') sdBtn.classList.add('active');

        var hdBtn = createToolBtn('', 'HD');
        hdBtn.dataset.tier = 'hd';
        hdBtn.querySelector('.exhibit-tool-label').style.fontSize = '0.72rem';
        if (deps.qualityResolved === 'hd') hdBtn.classList.add('active');

        [sdBtn, hdBtn].forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (deps.switchQualityTier) deps.switchQualityTier(btn.dataset.tier);
                [sdBtn, hdBtn].forEach(function (b) {
                    b.classList.toggle('active', b.dataset.tier === btn.dataset.tier);
                });
            });
        });

        qualityGroup.appendChild(sdBtn);
        qualityGroup.appendChild(hdBtn);
        toolbar.appendChild(qualityGroup);

        var sep2 = document.createElement('div');
        sep2.className = 'exhibit-toolbar-sep';
        toolbar.appendChild(sep2);
    }

    // Actions group
    var actionsGroup = document.createElement('div');
    actionsGroup.className = 'exhibit-toolbar-group';

    // Annotation toggle
    var annotations = annotationSystem ? annotationSystem.getAnnotations() : [];
    var markersVisible = true;

    if (annotations.length > 0) {
        var annoBtn = createToolBtn(ICONS.annotation, 'Markers');
        annoBtn.addEventListener('click', function () {
            markersVisible = !markersVisible;
            var container = document.getElementById('annotation-markers');
            if (container) container.style.display = markersVisible ? '' : 'none';
            annoBtn.classList.toggle('off', !markersVisible);
            if (!markersVisible && getCurrentPopupId()) {
                hideAnnotationPopup();
                hideAnnotationLine();
                setCurrentPopupId(null);
                annotationSystem.selectedAnnotation = null;
                document.querySelectorAll('.annotation-marker.selected').forEach(function (m) { m.classList.remove('selected'); });
            }
        });
        actionsGroup.appendChild(annoBtn);
    }

    // Info button
    var infoOverlay = createInfoOverlay(manifest, deps);
    viewerContainer.appendChild(infoOverlay);

    var infoBtn = createToolBtn(ICONS.info, 'Info');
    infoBtn.addEventListener('click', function () {
        infoOverlay.classList.toggle('open');
    });
    actionsGroup.appendChild(infoBtn);

    // Fullscreen
    if (document.fullscreenEnabled) {
        var fsBtn = createToolBtn(ICONS.fullscreen, 'Expand');
        fsBtn.addEventListener('click', function () {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });
        actionsGroup.appendChild(fsBtn);
    }

    toolbar.appendChild(actionsGroup);
    viewerContainer.appendChild(toolbar);

    // --- 3. Annotation strip ---
    var annoStrip = null;
    if (annotations.length > 0) {
        annoStrip = document.createElement('div');
        annoStrip.className = 'exhibit-anno-strip';

        annotations.forEach(function (anno, i) {
            var btn = document.createElement('button');
            btn.className = 'exhibit-anno-btn';
            btn.dataset.annoId = anno.id;
            btn.innerHTML =
                '<span class="exhibit-anno-num">' + String(i + 1).padStart(2, '0') + '</span>' +
                '<span class="exhibit-anno-title">' + escapeHtml(anno.title || '') + '</span>';
            btn.addEventListener('click', function () {
                if (annotationSystem && annotationSystem.goToAnnotation) {
                    annotationSystem.goToAnnotation(anno.id);
                }
                var popupId = showAnnotationPopup(anno, state.imageAssets);
                setCurrentPopupId(popupId);

                // Highlight this button
                annoStrip.querySelectorAll('.exhibit-anno-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset.annoId === anno.id);
                });
            });
            annoStrip.appendChild(btn);
        });

        viewerContainer.appendChild(annoStrip);
    }

    // --- 4. Walkthrough stop card (created now, shown during walkthrough) ---
    _wtCard = document.createElement('div');
    _wtCard.className = 'exhibit-wt-card';
    _wtCard.innerHTML =
        '<div class="exhibit-wt-card-number"></div>' +
        '<h3 class="exhibit-wt-card-title"></h3>' +
        '<p class="exhibit-wt-card-desc"></p>';
    viewerContainer.appendChild(_wtCard);

    // --- 5. ESC closes info overlay ---
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && infoOverlay.classList.contains('open')) {
            infoOverlay.classList.remove('open');
        }
    });

    // --- 6. Attract mode setup ---
    _attractToolbar = toolbar;
    _attractAnnoStrip = annoStrip;
    _attractPlaque = plaque;
    _attractControls = sceneManager.controls;
    _attractAnnotationSystem = annotationSystem;
    _attractAnnotations = annotations;
    _attractShowPopup = showAnnotationPopup;
    _attractHidePopup = hideAnnotationPopup;
    _attractHideLine = hideAnnotationLine;
    _attractSetPopupId = setCurrentPopupId;
    _attractState = state;
    initAttractListeners();

    // --- Staggered annotation marker entrance ---
    setTimeout(function () {
        var markers = document.querySelectorAll('.annotation-marker');
        markers.forEach(function (marker, i) {
            marker.style.animationDelay = (0.1 + i * 0.06) + 's';
        });
    }, 300);

    log.info('Exhibit layout ready');
}

// ---- Loading screen ----

function initLoadingScreen(container) {
    container.innerHTML =
        '<div class="exhibit-loading-center">' +
        '    <div class="exhibit-loading-eyebrow">Loading</div>' +
        '    <div class="exhibit-loading-spinner"></div>' +
        '    <div class="exhibit-loading-rule"></div>' +
        '    <p id="loading-text">Preparing exhibit\u2026</p>' +
        '</div>' +
        '<div class="exhibit-loading-bottom">' +
        '    <div id="loading-progress-container" class="hidden">' +
        '        <div id="loading-progress-bar"></div>' +
        '    </div>' +
        '    <p id="loading-progress-text" class="hidden">0%</p>' +
        '</div>';
}

// ---- Click gate ----

function initClickGate(container) {
    container.innerHTML =
        '<div class="exhibit-gate-backdrop">' +
        '    <img id="kiosk-gate-poster" alt="" />' +
        '    <div class="exhibit-gate-overlay"></div>' +
        '</div>' +
        '<div class="exhibit-gate-content">' +
        '    <h2 id="kiosk-gate-title"></h2>' +
        '    <div class="exhibit-gate-rule"></div>' +
        '    <p id="kiosk-gate-types"></p>' +
        '    <button id="kiosk-gate-play" type="button" class="exhibit-gate-play" aria-label="Load 3D viewer">' +
        '        <span>Explore</span>' +
        '        <svg viewBox="0 0 24 24" width="16" height="16" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
        '    </button>' +
        '</div>';
}

// ---- File picker ----

function initFilePicker(container) {
    container.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;">' +
        '    <div class="kiosk-picker-box" id="kiosk-drop-zone" style="text-align:center;max-width:400px;padding:40px 32px;">' +
        '        <div class="exhibit-loading-eyebrow" style="margin-bottom:16px;">Open File</div>' +
        '        <h1 style="font-family:var(--kiosk-font-display);font-size:1.4rem;font-weight:400;color:rgba(var(--kiosk-text-heading-rgb),0.95);margin:0 0 8px;">Vitrine3D</h1>' +
        '        <div style="width:48px;height:2px;background:var(--kiosk-accent);margin:0 auto 16px;"></div>' +
        '        <p class="kiosk-picker-formats">Models, splats, point clouds, and 3D archives</p>' +
        '        <button id="kiosk-picker-btn" type="button">Browse Files</button>' +
        '        <p class="kiosk-picker-prompt">or drag and drop here</p>' +
        '    </div>' +
        '</div>' +
        '<input type="file" id="kiosk-picker-input" accept=".ddim,.a3z,.a3d,.glb,.gltf,.obj,.stl,.ply,.splat,.ksplat,.spz,.sog,.e57" multiple style="display:none">';
}

// ---- Layout module hooks ----

function onAnnotationSelect(annotationId) {
    // Highlight corresponding strip button
    var strip = document.querySelector('.exhibit-anno-strip');
    if (strip) {
        strip.querySelectorAll('.exhibit-anno-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.annoId === annotationId);
        });
    }
}

function onAnnotationDeselect() {
    var strip = document.querySelector('.exhibit-anno-strip');
    if (strip) {
        strip.querySelectorAll('.exhibit-anno-btn').forEach(function (btn) {
            btn.classList.remove('active');
        });
    }
}

function onViewModeChange(mode) {
    document.querySelectorAll('.exhibit-view-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

function onKeyboardShortcut(key) {
    if (key === 'i' || key === 'm') {
        var overlay = document.querySelector('.exhibit-info-overlay');
        if (overlay) {
            overlay.classList.toggle('open');
            return true;
        }
    }
    return false;
}

function onWalkthroughStart(walkthrough) {
    _walkthroughActive = true;

    // Hide annotation strip, show walkthrough strip instead
    var annoStrip = document.querySelector('.exhibit-anno-strip');
    if (annoStrip) annoStrip.style.display = 'none';

    var viewerContainer = document.getElementById('viewer-container') || document.body;

    // Build step strip
    var stops = walkthrough.stops || [];
    _wtStripEl = document.createElement('div');
    _wtStripEl.className = 'exhibit-wt-strip';

    _wtSteps = [];
    _wtConnectors = [];

    stops.forEach(function (stop, i) {
        if (i > 0) {
            var connector = document.createElement('div');
            connector.className = 'exhibit-wt-connector';
            _wtStripEl.appendChild(connector);
            _wtConnectors.push(connector);
        }

        var step = document.createElement('button');
        step.className = 'exhibit-wt-step';
        step.dataset.stop = String(i);
        step.innerHTML =
            '<span class="exhibit-wt-step-num">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<span class="exhibit-wt-step-title">' + (stop.title ? stop.title : '') + '</span>';

        step.addEventListener('click', function () {
            var event = new CustomEvent('gallery-walkthrough-jump', { detail: { index: i } });
            document.dispatchEvent(event);
        });

        _wtStripEl.appendChild(step);
        _wtSteps.push(step);
    });

    viewerContainer.appendChild(_wtStripEl);

    // Flanking prev/next arrows
    _wtPrev = document.createElement('button');
    _wtPrev.className = 'exhibit-wt-prev';
    _wtPrev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    _wtPrev.addEventListener('click', function () {
        document.dispatchEvent(new CustomEvent('gallery-walkthrough-jump', { detail: { direction: 'prev' } }));
    });
    viewerContainer.appendChild(_wtPrev);

    _wtNext = document.createElement('button');
    _wtNext.className = 'exhibit-wt-next';
    _wtNext.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    _wtNext.addEventListener('click', function () {
        document.dispatchEvent(new CustomEvent('gallery-walkthrough-jump', { detail: { direction: 'next' } }));
    });
    viewerContainer.appendChild(_wtNext);
}

function onWalkthroughStopChange(stopIndex, stop) {
    // Update step strip
    if (_wtSteps) {
        _wtSteps.forEach(function (step, i) {
            step.classList.toggle('active', i === stopIndex);
            if (i <= stopIndex) step.classList.add('visited');
        });
    }

    // Fill connectors up to current stop
    if (_wtConnectors) {
        _wtConnectors.forEach(function (conn, i) {
            conn.classList.toggle('filled', i < stopIndex);
        });
    }

    // Show stop card
    if (_wtCard && stop) {
        _wtCard.classList.remove('visible');
        clearTimeout(_wtCardTimer);

        setTimeout(function () {
            var numberEl = _wtCard.querySelector('.exhibit-wt-card-number');
            var titleEl = _wtCard.querySelector('.exhibit-wt-card-title');
            var descEl = _wtCard.querySelector('.exhibit-wt-card-desc');

            if (numberEl) numberEl.textContent = 'Stop ' + (stopIndex + 1) + ' of ' + (_wtSteps ? _wtSteps.length : '');
            if (titleEl) titleEl.textContent = stop.title || '';
            if (descEl) descEl.textContent = stop.description || '';

            if (stop.title || stop.description) {
                _wtCard.classList.add('visible');
                var dismissTime = (stop.dwell_time && stop.dwell_time > 0) ? Math.min(stop.dwell_time, 8000) : 6000;
                _wtCardTimer = setTimeout(function () {
                    _wtCard.classList.remove('visible');
                }, dismissTime);
            }
        }, 100);
    }
}

function onWalkthroughEnd() {
    _walkthroughActive = false;

    // Remove walkthrough elements
    if (_wtStripEl && _wtStripEl.parentNode) _wtStripEl.remove();
    if (_wtPrev && _wtPrev.parentNode) _wtPrev.remove();
    if (_wtNext && _wtNext.parentNode) _wtNext.remove();

    _wtStripEl = null;
    _wtSteps = null;
    _wtConnectors = null;

    // Hide stop card
    if (_wtCard) {
        _wtCard.classList.remove('visible');
        clearTimeout(_wtCardTimer);
    }

    // Restore annotation strip
    var annoStrip = document.querySelector('.exhibit-anno-strip');
    if (annoStrip) annoStrip.style.display = '';
}

// ---- Self-register for kiosk discovery ----
if (!window.__KIOSK_LAYOUTS__) window.__KIOSK_LAYOUTS__ = {};
window.__KIOSK_LAYOUTS__['exhibit'] = {
    setup: setup,
    cleanup: cleanup,
    initLoadingScreen: initLoadingScreen,
    initClickGate: initClickGate,
    initFilePicker: initFilePicker,
    onAnnotationSelect: onAnnotationSelect,
    onAnnotationDeselect: onAnnotationDeselect,
    onViewModeChange: onViewModeChange,
    onKeyboardShortcut: onKeyboardShortcut,
    onWalkthroughStart: onWalkthroughStart,
    onWalkthroughStopChange: onWalkthroughStopChange,
    onWalkthroughEnd: onWalkthroughEnd,
    hasOwnInfoPanel: true,
    hasOwnQualityToggle: true
};
