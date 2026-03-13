/**
 * Gallery Layout — cinematic full-bleed layout module for the gallery theme.
 *
 * No ES imports — receives ALL dependencies via the `deps` object passed to
 * setup(). Self-registers on window.__KIOSK_LAYOUTS__ for kiosk bootstrap
 * discovery (same pattern as editorial).
 *
 * Design: scene-first. All chrome auto-fades. Walkthrough gets letterbox bars
 * and chapter cards. Info is a full-screen overlay.
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

// ---- Auto-fade system ----

var _fadeElements = [];
var _fadeTimer = null;
var _walkthroughActive = false;
var FADE_DELAY = 4000;

function fadeIn() {
    _fadeElements.forEach(function (el) { el.style.opacity = '1'; });
    clearTimeout(_fadeTimer);
    _fadeTimer = setTimeout(function () {
        _fadeElements.forEach(function (el) { el.style.opacity = '0'; });
    }, FADE_DELAY);
}

function initAutoFade(elements) {
    _fadeElements = elements.filter(Boolean);
    document.addEventListener('mousemove', fadeIn);
    document.addEventListener('touchstart', fadeIn, { passive: true });
    // Initial fade after delay
    _fadeTimer = setTimeout(function () {
        _fadeElements.forEach(function (el) { el.style.opacity = '0'; });
    }, FADE_DELAY);
}

// ---- Collapsible section builder ----

function createCollapsible(title, openByDefault) {
    var section = document.createElement('div');
    section.className = 'gallery-collapsible' + (openByDefault ? ' open' : '');
    var header = document.createElement('div');
    header.className = 'gallery-collapsible-header';
    header.innerHTML = '<span class="gallery-collapsible-title">' + title + '</span><span class="gallery-collapsible-chevron">&#9654;</span>';
    header.addEventListener('click', function () { section.classList.toggle('open'); });
    section.appendChild(header);
    var content = document.createElement('div');
    content.className = 'gallery-collapsible-content';
    var inner = document.createElement('div');
    inner.className = 'gallery-collapsible-inner';
    content.appendChild(inner);
    section.appendChild(content);
    return { section: section, content: inner };
}

function createDetailEl(prefix, label, value) {
    var el = document.createElement('div');
    el.className = prefix + '-detail';
    el.innerHTML = '<span class="' + prefix + '-label">' + label + '</span><span class="' + prefix + '-value">' + value + '</span>';
    return el;
}

function createSubjectDetail(label, value) { return createDetailEl('gallery-subject', label, value); }
function createQualityDetail(label, value) { return createDetailEl('gallery-quality', label, value); }
function createTechDetail(label, value) { return createDetailEl('gallery-tech', label, value); }

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
    overlay.className = 'gallery-info-overlay';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'gallery-info-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () {
        overlay.classList.remove('open');
    });
    overlay.appendChild(closeBtn);

    var contentCol = document.createElement('div');
    contentCol.className = 'gallery-info-content';

    // --- Image strip ---
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
        var imageStrip = document.createElement('div');
        imageStrip.className = 'gallery-info-image-strip';
        var img = document.createElement('img');
        img.src = stripSrc;
        img.alt = '';
        img.draggable = false;
        imageStrip.appendChild(img);
        contentCol.appendChild(imageStrip);
    }

    // --- Header ---
    var headerSection = document.createElement('div');
    headerSection.className = 'gallery-info-header';

    var title = (manifest && manifest.title) || (manifest && manifest.project && manifest.project.title) || '';
    var location = (manifest && manifest.location) || '';
    var rawDate = (manifest && manifest.date) || (manifest && manifest.provenance && manifest.provenance.capture_date) || '';
    var date = formatDate(rawDate, 'medium') || rawDate;
    var metaParts = [location, date].filter(Boolean);

    var titleEl = document.createElement('h2');
    titleEl.className = 'gallery-info-title';
    titleEl.textContent = title;
    headerSection.appendChild(titleEl);

    var titleBar = document.createElement('div');
    titleBar.className = 'gallery-info-title-bar';
    headerSection.appendChild(titleBar);

    if (metaParts.length > 0) {
        var metaEl = document.createElement('div');
        metaEl.className = 'gallery-info-meta';
        metaEl.textContent = metaParts.join(' \u00B7 ');
        headerSection.appendChild(metaEl);
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
                                var img = tex.image;
                                if (img && img.width) maxTexRes = Math.max(maxTexRes, img.width, img.height);
                            }
                        });
                    }
                });
            }
        });
        if (vertexCount > 0) {
            var parts = [];
            var fmt = function (n) { return n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M' : n.toLocaleString(); };
            parts.push('<strong>' + fmt(vertexCount) + '</strong> vertices');
            if (textureSet.size > 0) parts.push('<strong>' + textureSet.size + '</strong> textures @ ' + maxTexRes + '\u00B2');
            var annoCount = annotationSystem ? annotationSystem.getAnnotations().length : 0;
            if (annoCount > 0) parts.push('<strong>' + annoCount + '</strong> annotations');

            var statsEl = document.createElement('div');
            statsEl.className = 'gallery-info-model-stats';
            statsEl.innerHTML = parts.join(' \u00B7 ');
            headerSection.appendChild(statsEl);
        }
    }

    contentCol.appendChild(headerSection);

    // --- Description ---
    if (desc) {
        var descEl = document.createElement('div');
        descEl.className = 'gallery-info-description';
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

    // --- Collapsible: The Subject ---
    var ar = manifest && manifest.archival_record;
    if (ar && hasValue(ar) && shouldShow('The Subject')) {
        var cs = createCollapsible('The Subject', false);
        var subjectGrid = document.createElement('div');
        subjectGrid.className = 'gallery-subject-grid';
        var creation = ar.creation || {};
        var phys = ar.physical_description || {};
        if (creation.creator) subjectGrid.appendChild(createSubjectDetail('Creator', escapeHtml(creation.creator)));
        var creationDate = creation.date || creation.date_created;
        if (creationDate) subjectGrid.appendChild(createSubjectDetail('Date', escapeHtml(String(creationDate))));
        if (creation.period) subjectGrid.appendChild(createSubjectDetail('Period', escapeHtml(creation.period)));
        if (creation.place) subjectGrid.appendChild(createSubjectDetail('Place', escapeHtml(creation.place)));
        if (creation.culture) subjectGrid.appendChild(createSubjectDetail('Culture', escapeHtml(creation.culture)));
        if (phys.medium) subjectGrid.appendChild(createSubjectDetail('Medium', escapeHtml(phys.medium)));
        if (phys.dimensions) {
            var d = phys.dimensions;
            var dimStr = typeof d === 'object'
                ? [d.height, d.width, d.depth].filter(Boolean).join(' \u00D7 ') || JSON.stringify(d)
                : String(d);
            subjectGrid.appendChild(createSubjectDetail('Dimensions', escapeHtml(dimStr)));
        }
        if (phys.condition) subjectGrid.appendChild(createSubjectDetail('Condition', escapeHtml(phys.condition)));
        if (subjectGrid.children.length > 0) cs.content.appendChild(subjectGrid);

        // Location
        var subjLocation = (ar.coverage && ar.coverage.spatial && (ar.coverage.spatial.place || ar.coverage.spatial.location_name)) || (manifest && manifest.location);
        if (subjLocation) {
            var locLabeled = document.createElement('div');
            locLabeled.className = 'gallery-prose-labeled';
            var locLabel = document.createElement('div');
            locLabel.className = 'gallery-prose-sub-label';
            locLabel.textContent = 'Location';
            locLabeled.appendChild(locLabel);
            var locName = document.createElement('div');
            locName.className = 'gallery-location-name';
            locName.textContent = subjLocation;
            locLabeled.appendChild(locName);
            cs.content.appendChild(locLabeled);
        }

        // Historical context
        if (ar.context && ar.context.description) {
            var proseLabeled = document.createElement('div');
            proseLabeled.className = 'gallery-prose-labeled';
            var subLabel = document.createElement('div');
            subLabel.className = 'gallery-prose-sub-label';
            subLabel.textContent = 'Historical Context';
            proseLabeled.appendChild(subLabel);
            var proseBlock = document.createElement('div');
            proseBlock.className = 'gallery-prose-block';
            proseBlock.innerHTML = parseMarkdown(ar.context.description);
            proseLabeled.appendChild(proseBlock);
            cs.content.appendChild(proseLabeled);
        }

        // Provenance
        if (ar.provenance) {
            var provLabeled = document.createElement('div');
            provLabeled.className = 'gallery-prose-labeled';
            var provLabel = document.createElement('div');
            provLabel.className = 'gallery-prose-sub-label';
            provLabel.textContent = 'Provenance';
            provLabeled.appendChild(provLabel);
            var provBlock = document.createElement('div');
            provBlock.className = 'gallery-prose-block';
            provBlock.innerHTML = parseMarkdown(ar.provenance);
            provLabeled.appendChild(provBlock);
            cs.content.appendChild(provLabeled);
        }

        contentCol.appendChild(cs.section);
    }

    // --- Collapsible: Quality & Capture ---
    var qm = manifest && manifest.quality_metrics;
    var prov = manifest && manifest.provenance;
    var hasQuality = qm && hasValue(qm);
    var hasCapture = prov && (prov.capture_device || prov.device_serial);
    var operator = (manifest && manifest.creator) || (prov && prov.operator);
    if ((hasQuality || hasCapture || operator) && shouldShow('Quality & Capture')) {
        var cq = createCollapsible('Quality & Capture', false);

        if (operator) {
            var creditLine = document.createElement('div');
            creditLine.className = 'gallery-info-credit-line';
            creditLine.innerHTML = '<span class="org">' + escapeHtml(operator) + '</span>';
            cq.content.appendChild(creditLine);
        }

        var qualityGrid = document.createElement('div');
        qualityGrid.className = 'gallery-quality-grid';
        if (qm) {
            if (qm.tier) qualityGrid.appendChild(createQualityDetail('Tier', escapeHtml(String(qm.tier))));
            if (qm.accuracy_grade) qualityGrid.appendChild(createQualityDetail('Accuracy', escapeHtml('Grade ' + qm.accuracy_grade)));
            if (qm.capture_resolution && qm.capture_resolution.value != null) {
                var cr = qm.capture_resolution;
                qualityGrid.appendChild(createQualityDetail('Resolution', escapeHtml(cr.value + (cr.unit || '') + ' GSD')));
            }
            if (qm.alignment_error && qm.alignment_error.value != null) {
                var ae = qm.alignment_error;
                qualityGrid.appendChild(createQualityDetail('Alignment', escapeHtml(ae.value + (ae.unit || '') + ' RMSE')));
            }
            if (qm.scale_verification) qualityGrid.appendChild(createQualityDetail('Scale Check', escapeHtml(qm.scale_verification)));
        }
        if (prov && prov.capture_device) qualityGrid.appendChild(createQualityDetail('Device', escapeHtml(prov.capture_device)));
        if (prov && prov.device_serial) {
            var serialEl = createQualityDetail('Serial', escapeHtml(prov.device_serial));
            var valSpan = serialEl.querySelector('.gallery-quality-value');
            if (valSpan) {
                valSpan.style.fontFamily = 'var(--kiosk-font-mono, monospace)';
                valSpan.style.fontSize = '0.68rem';
            }
            qualityGrid.appendChild(serialEl);
        }
        if (qualityGrid.children.length > 0) cq.content.appendChild(qualityGrid);

        // Secondary quality grid
        if (qm && hasValue(qm.data_quality)) {
            var secGrid = document.createElement('div');
            secGrid.className = 'gallery-quality-secondary';
            Object.keys(qm.data_quality).forEach(function (k) {
                secGrid.appendChild(createQualityDetail(
                    escapeHtml(k.replace(/_/g, ' ')),
                    escapeHtml(String(qm.data_quality[k]))
                ));
            });
            cq.content.appendChild(secGrid);
        }

        contentCol.appendChild(cq.section);
    }

    // --- Collapsible: Processing ---
    if (prov && shouldShow('Processing')) {
        var hasSoftware = Array.isArray(prov.processing_software) && prov.processing_software.length > 0;
        var hasNotes = !!prov.processing_notes;
        if (hasSoftware || hasNotes) {
            var cp = createCollapsible('Processing', false);

            if (hasSoftware) {
                var swLine = document.createElement('div');
                swLine.className = 'gallery-software-line';
                var names = prov.processing_software.map(function (sw) {
                    return typeof sw === 'object' ? ((sw.name || '') + (sw.version ? ' ' + sw.version : '')).trim() : sw;
                }).filter(Boolean);
                swLine.innerHTML = '<strong>Software</strong> ' + escapeHtml(names.join(' \u00B7 '));
                cp.content.appendChild(swLine);
            }

            if (hasNotes) {
                var notesBlock = document.createElement('div');
                notesBlock.className = 'gallery-prose-block';
                notesBlock.innerHTML = parseMarkdown(prov.processing_notes);
                cp.content.appendChild(notesBlock);
            }

            contentCol.appendChild(cp.section);
        }
    }

    // --- Collapsible: Data Assets ---
    var entries = manifest && manifest.data_entries;
    if (entries && !Array.isArray(entries) && typeof entries === 'object') {
        entries = Object.values(entries).filter(function (e) { return e && typeof e === 'object'; });
    }
    if (Array.isArray(entries) && entries.length > 0 && shouldShow('Data Assets')) {
        var ca = createCollapsible('Data Assets', false);

        entries.forEach(function (entry) {
            var item = document.createElement('div');
            item.className = 'gallery-asset-item';

            var headerEl = document.createElement('div');
            headerEl.className = 'gallery-asset-header';
            if (entry.role) {
                var roleEl = document.createElement('span');
                roleEl.className = 'gallery-asset-role';
                roleEl.textContent = entry.role;
                headerEl.appendChild(roleEl);
            }
            var nameEl = document.createElement('span');
            nameEl.className = 'gallery-asset-filename';
            nameEl.textContent = entry.file_name || entry.filename || '';
            headerEl.appendChild(nameEl);
            item.appendChild(headerEl);

            var entryCreator = entry.creator || entry.created_by;
            if (entryCreator) {
                var creatorEl = document.createElement('div');
                creatorEl.className = 'gallery-asset-creator';
                creatorEl.textContent = entryCreator;
                item.appendChild(creatorEl);
            }

            var metaChips = [];
            if (entry.file_size) metaChips.push(entry.file_size);
            if (entry.splat_count) metaChips.push(Number(entry.splat_count).toLocaleString() + ' splats');
            if (entry.polygon_count) metaChips.push(Number(entry.polygon_count).toLocaleString() + ' polygons');
            if (entry.vertex_count) metaChips.push(Number(entry.vertex_count).toLocaleString() + ' vertices');
            if (metaChips.length > 0) {
                var metaRow = document.createElement('div');
                metaRow.className = 'gallery-asset-meta';
                metaChips.forEach(function (chip) {
                    var chipEl = document.createElement('span');
                    chipEl.className = 'gallery-asset-meta-chip';
                    chipEl.textContent = chip;
                    metaRow.appendChild(chipEl);
                });
                item.appendChild(metaRow);
            }

            if (entry._source_notes) {
                var notesEl = document.createElement('div');
                notesEl.className = 'gallery-asset-notes';
                notesEl.textContent = entry._source_notes;
                item.appendChild(notesEl);
            }

            ca.content.appendChild(item);
        });

        contentCol.appendChild(ca.section);
    }

    // --- Collapsible: Technical Details ---
    if (shouldShow('Technical Details')) {
        var hasTech = ar || (manifest && manifest.material_standard) || (manifest && manifest.preservation) || (manifest && manifest.integrity);
        if (hasTech) {
            var ct = createCollapsible('Technical Details', false);
            var techGrid = document.createElement('div');
            techGrid.className = 'gallery-tech-grid';

            if (ar && ar.standard) techGrid.appendChild(createTechDetail('Standard', escapeHtml(ar.standard)));
            var copyrightVal = ar && ar.rights && (ar.rights.holder || ar.rights.copyright_status);
            if (copyrightVal) techGrid.appendChild(createTechDetail('Copyright', escapeHtml(copyrightVal)));
            var matStd = manifest && manifest.material_standard;
            if (matStd) {
                if (matStd.workflow) techGrid.appendChild(createTechDetail('Material', escapeHtml(matStd.workflow)));
                if (matStd.color_space) techGrid.appendChild(createTechDetail('Color Space', escapeHtml(matStd.color_space)));
                var normalVal = matStd.normal_convention || matStd.normal_space;
                if (normalVal) techGrid.appendChild(createTechDetail('Normal', escapeHtml(normalVal)));
            }
            var pres = manifest && manifest.preservation;
            if (pres && pres.rendering_requirements) techGrid.appendChild(createTechDetail('Rendering', escapeHtml(pres.rendering_requirements)));
            if (techGrid.children.length > 0) ct.content.appendChild(techGrid);

            // Significant properties
            if (pres && pres.significant_properties && pres.significant_properties.length > 0) {
                var subHead = document.createElement('div');
                subHead.className = 'gallery-tech-sub-header';
                subHead.textContent = 'Significant Properties';
                ct.content.appendChild(subHead);
                var propsRow = document.createElement('div');
                propsRow.className = 'gallery-sig-props';
                pres.significant_properties.forEach(function (prop) {
                    var chip = document.createElement('span');
                    chip.className = 'gallery-sig-prop';
                    chip.textContent = prop;
                    propsRow.appendChild(chip);
                });
                ct.content.appendChild(propsRow);
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
                hashHead.className = 'gallery-tech-sub-header';
                hashHead.textContent = 'Integrity \u2014 ' + escapeHtml((integ && integ.algorithm) || 'SHA-256');
                ct.content.appendChild(hashHead);
                var hashList = document.createElement('ul');
                hashList.className = 'gallery-hash-list';
                hashEntries.forEach(function (entry) {
                    var li = document.createElement('li');
                    var truncated = entry.hash.length > 16 ? entry.hash.slice(0, 8) + '...' + entry.hash.slice(-8) : entry.hash;
                    li.innerHTML = '<span>' + escapeHtml(entry.file) + '</span> ' + escapeHtml(truncated);
                    hashList.appendChild(li);
                });
                ct.content.appendChild(hashList);
            }

            // Dates
            var creationDateVal = manifest && (manifest._creation_date || (manifest._meta && manifest._meta.created));
            var modifiedDate = manifest && (manifest._last_modified || (manifest._meta && manifest._meta.modified));
            if (creationDateVal || modifiedDate) {
                var datesRow = document.createElement('div');
                datesRow.className = 'gallery-dates-row';
                if (creationDateVal) datesRow.appendChild(createTechDetail('Created', escapeHtml(String(creationDateVal))));
                if (modifiedDate) datesRow.appendChild(createTechDetail('Last Modified', escapeHtml(String(modifiedDate))));
                ct.content.appendChild(datesRow);
            }

            contentCol.appendChild(ct.section);
        }
    }

    // --- Collapsible: Tags ---
    var tags = (manifest && manifest.tags) || (manifest && manifest.project && manifest.project.tags) || [];
    if (tags.length > 0 && shouldShow('Tags')) {
        var cTags = createCollapsible('Tags', false);
        var tagsRow = document.createElement('div');
        tagsRow.className = 'gallery-info-tags';
        tags.forEach(function (tag) {
            var chip = document.createElement('span');
            chip.className = 'gallery-tag-chip';
            chip.textContent = tag;
            tagsRow.appendChild(chip);
        });
        cTags.content.appendChild(tagsRow);
        contentCol.appendChild(cTags.section);
    }

    // --- License footer ---
    var license = (manifest && manifest.license) || (manifest && manifest.project && manifest.project.license) ||
                  (ar && ar.rights && (ar.rights.license || ar.rights.statement)) || '';
    if (license) {
        var licenseEl = document.createElement('div');
        licenseEl.className = 'gallery-info-license';
        licenseEl.textContent = license;
        contentCol.appendChild(licenseEl);
    }

    overlay.appendChild(contentCol);
    return overlay;
}

// ---- Walkthrough state ----

var _timelineDots = null;
var _timelineDashes = null;
var _timelineEl = null;
var _chapterCard = null;
var _letterboxTop = null;
var _letterboxBottom = null;
var _chapterTimer = null;

// ---- Cleanup — remove all DOM elements created by setup() ----

var GALLERY_ROOT_CLASSES = [
    'gallery-title-card',
    'gallery-tool-pill',
    'gallery-letterbox-top',
    'gallery-letterbox-bottom',
    'gallery-chapter-card',
    'gallery-info-overlay',
    'gallery-timeline'
];

function cleanup() {
    var viewerContainer = document.getElementById('viewer-container') || document.body;
    GALLERY_ROOT_CLASSES.forEach(function(cls) {
        viewerContainer.querySelectorAll('.' + cls).forEach(function(el) { el.remove(); });
    });
    _fadeElements = [];
    if (_fadeTimer) { clearTimeout(_fadeTimer); _fadeTimer = null; }
    _walkthroughActive = false;
    _timelineDots = null;
    _timelineDashes = null;
    _timelineEl = null;
    _chapterCard = null;
    _letterboxTop = null;
    _letterboxBottom = null;
    if (_chapterTimer) { clearTimeout(_chapterTimer); _chapterTimer = null; }
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

    var log = Logger.getLogger('gallery-layout');
    log.info('Setting up gallery layout');

    // Remove any previously-created gallery layout elements (re-entry safe)
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
            '#1a1a2e';
        sceneManager.setBackgroundColor(sceneBg);
    }

    // --- 1. Title Card ---
    var titleCard = document.createElement('div');
    titleCard.className = 'gallery-title-card';

    var title = (manifest && manifest.title) || (manifest && manifest.project && manifest.project.title) ||
                (manifest && manifest.archival_record && manifest.archival_record.title) || '';
    var location = (manifest && manifest.location) || (manifest && manifest.provenance && manifest.provenance.location) ||
                   (manifest && manifest.archival_record && manifest.archival_record.creation && manifest.archival_record.creation.place) || '';
    var rawDate = (manifest && manifest.date) || (manifest && manifest.provenance && manifest.provenance.capture_date) ||
                  (manifest && manifest.archival_record && manifest.archival_record.creation && manifest.archival_record.creation.date) || '';
    var date = formatDate(rawDate, 'medium') || rawDate;
    var metaParts = [location, date].filter(Boolean);

    titleCard.innerHTML =
        '<h1>' + escapeHtml(title) + '</h1>' +
        '<div class="gallery-title-rule"></div>' +
        (metaParts.length > 0 ? '<span class="gallery-title-meta">' + escapeHtml(metaParts.join(' \u00B7 ')) + '</span>' : '');

    viewerContainer.appendChild(titleCard);

    // --- 2. Floating Tool Pill ---
    var pill = document.createElement('div');
    pill.className = 'gallery-tool-pill';

    // View mode buttons
    var contentInfo = state.archiveLoader ? state.archiveLoader.getContentInfo() : null;
    var types = [];
    if (contentInfo) {
        if (contentInfo.hasMesh) types.push({ mode: 'model', label: 'Model' });
        if (contentInfo.hasSplat) types.push({ mode: 'splat', label: 'Splat' });
        if (contentInfo.hasPointcloud) types.push({ mode: 'pointcloud', label: 'Cloud' });
    }
    if (types.length >= 2) {
        types.push({ mode: 'both', label: 'Both' });
    }

    types.forEach(function (t) {
        var btn = document.createElement('button');
        btn.className = 'gallery-pill-btn gallery-view-btn';
        btn.dataset.mode = t.mode;
        btn.textContent = t.label;
        if (state.displayMode === t.mode) btn.classList.add('active');
        btn.addEventListener('click', function () {
            state.displayMode = t.mode;
            setDisplayMode(t.mode, createDisplayModeDeps());
            triggerLazyLoad(t.mode);
            if (deps.applyBackgroundForMode) deps.applyBackgroundForMode(t.mode);
            pill.querySelectorAll('.gallery-view-btn').forEach(function (b) {
                b.classList.toggle('active', b.dataset.mode === t.mode);
            });
        });
        pill.appendChild(btn);
    });

    // Separator after view modes (if we have view modes)
    if (types.length > 0) {
        var sep1 = document.createElement('div');
        sep1.className = 'gallery-pill-sep';
        pill.appendChild(sep1);
    }

    // Quality toggle (SD / HD)
    if (deps.hasAnyProxy || deps.hasSplat || deps.hasMesh) {
        var sdBtn = document.createElement('button');
        sdBtn.className = 'gallery-pill-btn' + (deps.qualityResolved === 'sd' ? ' active' : '');
        sdBtn.dataset.tier = 'sd';
        sdBtn.textContent = 'SD';

        var hdBtn = document.createElement('button');
        hdBtn.className = 'gallery-pill-btn' + (deps.qualityResolved === 'hd' ? ' active' : '');
        hdBtn.dataset.tier = 'hd';
        hdBtn.textContent = 'HD';

        [sdBtn, hdBtn].forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (deps.switchQualityTier) deps.switchQualityTier(btn.dataset.tier);
                [sdBtn, hdBtn].forEach(function (b) {
                    b.classList.toggle('active', b.dataset.tier === btn.dataset.tier);
                });
            });
        });

        pill.appendChild(sdBtn);
        pill.appendChild(hdBtn);

        var sep2 = document.createElement('div');
        sep2.className = 'gallery-pill-sep';
        pill.appendChild(sep2);
    }

    // Annotation marker toggle
    var annotations = annotationSystem ? annotationSystem.getAnnotations() : [];
    var markersVisible = true;

    if (annotations.length > 0) {
        var annoBtn = document.createElement('button');
        annoBtn.className = 'gallery-pill-icon';
        annoBtn.title = 'Toggle annotations';
        annoBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
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
        pill.appendChild(annoBtn);
    }

    // Fullscreen
    if (document.fullscreenEnabled) {
        var fsBtn = document.createElement('button');
        fsBtn.className = 'gallery-pill-icon';
        fsBtn.title = 'Fullscreen';
        fsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
        fsBtn.addEventListener('click', function () {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });
        pill.appendChild(fsBtn);
    }

    // Info button
    var infoBtn = document.createElement('button');
    infoBtn.className = 'gallery-pill-icon';
    infoBtn.title = 'Info';
    infoBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

    viewerContainer.appendChild(pill);

    // --- 3. Letterbox bars (created now, activated during walkthrough) ---
    _letterboxTop = document.createElement('div');
    _letterboxTop.className = 'gallery-letterbox-top';
    viewerContainer.appendChild(_letterboxTop);

    _letterboxBottom = document.createElement('div');
    _letterboxBottom.className = 'gallery-letterbox-bottom';
    viewerContainer.appendChild(_letterboxBottom);

    // --- 4. Chapter card (created now, shown during walkthrough stops) ---
    _chapterCard = document.createElement('div');
    _chapterCard.className = 'gallery-chapter-card';
    _chapterCard.innerHTML =
        '<div class="gallery-chapter-number"></div>' +
        '<div class="gallery-chapter-title"></div>' +
        '<div class="gallery-chapter-desc"></div>';
    viewerContainer.appendChild(_chapterCard);

    // --- 5. Info overlay ---
    var infoOverlay = createInfoOverlay(manifest, deps);
    viewerContainer.appendChild(infoOverlay);

    infoBtn.addEventListener('click', function () {
        infoOverlay.classList.toggle('open');
    });
    pill.appendChild(infoBtn);

    // ESC closes info overlay
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && infoOverlay.classList.contains('open')) {
            infoOverlay.classList.remove('open');
        }
    });

    // --- 6. Auto-fade ---
    initAutoFade([titleCard, pill]);

    // --- Staggered annotation marker entrance ---
    setTimeout(function () {
        var markers = document.querySelectorAll('.annotation-marker');
        markers.forEach(function (marker, i) {
            marker.style.animationDelay = (0.1 + i * 0.06) + 's';
        });
    }, 300);

    log.info('Gallery layout ready');
}

// ---- Loading screen ----

function initLoadingScreen(container) {
    container.innerHTML =
        '<div class="gallery-loading-center">' +
        '    <div class="gallery-loading-spinner"></div>' +
        '    <div class="gallery-loading-rule"></div>' +
        '    <p id="loading-text">Loading\u2026</p>' +
        '</div>' +
        '<div class="gallery-loading-bottom">' +
        '    <div id="loading-progress-container" class="hidden">' +
        '        <div id="loading-progress-bar"></div>' +
        '    </div>' +
        '    <p id="loading-progress-text" class="hidden">0%</p>' +
        '</div>';
}

// ---- Click gate ----

function initClickGate(container) {
    container.innerHTML =
        '<div class="gallery-gate-backdrop">' +
        '    <img id="kiosk-gate-poster" alt="" />' +
        '    <div class="gallery-gate-overlay"></div>' +
        '</div>' +
        '<div class="gallery-gate-content">' +
        '    <button id="kiosk-gate-play" type="button" class="gallery-gate-play" aria-label="Load 3D viewer">' +
        '        <svg viewBox="0 0 24 24" width="32" height="32"><polygon points="6,3 20,12 6,21" /></svg>' +
        '    </button>' +
        '</div>' +
        '<div class="gallery-gate-info">' +
        '    <h2 id="kiosk-gate-title"></h2>' +
        '    <div class="gallery-gate-rule"></div>' +
        '    <p id="kiosk-gate-types"></p>' +
        '</div>';
}

// ---- File picker ----

function initFilePicker(container) {
    container.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;">' +
        '    <div class="kiosk-picker-box" id="kiosk-drop-zone" style="text-align:center;max-width:400px;padding:40px 32px;">' +
        '        <h1 style="font-family:var(--kiosk-font-display);font-size:1.4rem;font-weight:400;color:rgba(var(--kiosk-text-heading-rgb),0.95);margin:0 0 8px;">Vitrine3D</h1>' +
        '        <div style="width:48px;height:2px;background:var(--kiosk-accent);margin:0 auto 16px;"></div>' +
        '        <p class="kiosk-picker-formats">Models, splats, point clouds, and 3D archives</p>' +
        '        <button id="kiosk-picker-btn" type="button">Browse Files</button>' +
        '        <p class="kiosk-picker-prompt">or drag and drop here</p>' +
        '    </div>' +
        '</div>' +
        '<input type="file" id="kiosk-picker-input" accept=".ddim,.a3z,.a3d,.zip,.glb,.gltf,.obj,.stl,.ply,.splat,.ksplat,.spz,.sog,.e57" multiple style="display:none">';
}

// ---- Layout module hooks ----

function onAnnotationSelect(annotationId) {
    // Highlight in timeline if walkthrough is active
    if (_timelineDots) {
        // No direct annotation→timeline mapping, but clear any stale active state
    }
}

function onAnnotationDeselect() {
    // Nothing to do for gallery — popups managed by kiosk-main
}

function onViewModeChange(mode) {
    document.querySelectorAll('.gallery-view-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

function onKeyboardShortcut(key) {
    if (key === 'i' || key === 'm') {
        var overlay = document.querySelector('.gallery-info-overlay');
        if (overlay) {
            overlay.classList.toggle('open');
            return true;
        }
    }
    return false;
}

function onWalkthroughStart(walkthrough) {
    _walkthroughActive = true;

    // Show letterbox
    if (_letterboxTop) _letterboxTop.classList.add('active');
    if (_letterboxBottom) _letterboxBottom.classList.add('active');

    // Hide title card during walkthrough
    var titleCard = document.querySelector('.gallery-title-card');
    if (titleCard) titleCard.style.opacity = '0';

    // Build timeline
    var viewerContainer = document.getElementById('viewer-container') || document.body;
    _timelineEl = document.createElement('div');
    _timelineEl.className = 'gallery-timeline';

    _timelineDots = [];
    _timelineDashes = [];

    var stops = walkthrough.stops || [];
    stops.forEach(function (stop, i) {
        if (i > 0) {
            var dash = document.createElement('span');
            dash.className = 'gallery-timeline-dash';
            _timelineEl.appendChild(dash);
            _timelineDashes.push(dash);
        }

        var dot = document.createElement('button');
        dot.className = 'gallery-timeline-dot';
        dot.dataset.index = String(i);
        dot.textContent = String(i + 1).padStart(2, '0');

        // Tooltip
        if (stop.title) {
            var tooltip = document.createElement('span');
            tooltip.className = 'gallery-dot-tooltip';
            tooltip.textContent = stop.title;
            dot.appendChild(tooltip);
        }

        dot.addEventListener('click', function () {
            // The walkthrough engine handles jumping — dispatch a custom event
            // that kiosk-main picks up, or call goToStop if available
            var event = new CustomEvent('gallery-walkthrough-jump', { detail: { index: i } });
            document.dispatchEvent(event);
        });

        _timelineEl.appendChild(dot);
        _timelineDots.push(dot);
    });

    viewerContainer.appendChild(_timelineEl);

    // Show timeline after brief delay
    requestAnimationFrame(function () {
        _timelineEl.classList.add('visible');
    });
}

function onWalkthroughStopChange(stopIndex, stop) {
    // Update timeline dots
    if (_timelineDots) {
        _timelineDots.forEach(function (dot, i) {
            dot.classList.toggle('active', i === stopIndex);
            if (i <= stopIndex) dot.classList.add('visited');
        });
    }

    // Fill dashes up to current stop
    if (_timelineDashes) {
        _timelineDashes.forEach(function (dash, i) {
            dash.classList.toggle('filled', i < stopIndex);
        });
    }

    // Show chapter card
    if (_chapterCard && stop) {
        // Dismiss existing card first
        _chapterCard.classList.remove('visible');
        clearTimeout(_chapterTimer);

        setTimeout(function () {
            var numberEl = _chapterCard.querySelector('.gallery-chapter-number');
            var titleEl = _chapterCard.querySelector('.gallery-chapter-title');
            var descEl = _chapterCard.querySelector('.gallery-chapter-desc');

            if (numberEl) numberEl.textContent = 'Stop ' + String(stopIndex + 1).padStart(2, '0');
            if (titleEl) titleEl.textContent = stop.title || '';
            if (descEl) descEl.textContent = stop.description || '';

            // Only show if there's content
            if (stop.title || stop.description) {
                _chapterCard.classList.add('visible');

                // Auto-dismiss after dwell time or 6 seconds
                var dismissTime = (stop.dwell_time && stop.dwell_time > 0) ? Math.min(stop.dwell_time, 8000) : 6000;
                _chapterTimer = setTimeout(function () {
                    _chapterCard.classList.remove('visible');
                }, dismissTime);
            }
        }, 100);
    }
}

function onWalkthroughEnd() {
    _walkthroughActive = false;

    // Hide letterbox
    if (_letterboxTop) _letterboxTop.classList.remove('active');
    if (_letterboxBottom) _letterboxBottom.classList.remove('active');

    // Hide chapter card
    if (_chapterCard) {
        _chapterCard.classList.remove('visible');
        clearTimeout(_chapterTimer);
    }

    // Remove timeline
    if (_timelineEl) {
        _timelineEl.classList.remove('visible');
        setTimeout(function () {
            if (_timelineEl && _timelineEl.parentNode) _timelineEl.remove();
            _timelineEl = null;
            _timelineDots = null;
            _timelineDashes = null;
        }, 400);
    }

    // Restore title card fade behavior
    fadeIn();
}

// ---- Self-register for kiosk discovery ----
if (!window.__KIOSK_LAYOUTS__) window.__KIOSK_LAYOUTS__ = {};
window.__KIOSK_LAYOUTS__['gallery'] = {
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
