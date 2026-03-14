/**
 * Editorial Layout — self-contained layout module for the editorial theme.
 *
 * No ES imports — receives ALL dependencies via the `deps` object passed to
 * setup(). This avoids path-resolution issues between online (relative to
 * theme folder) and offline (blob URLs) modes.
 *
 * Self-registers on window.__KIOSK_LAYOUTS__ so the kiosk bootstrap can
 * discover it without dynamic import() in offline viewers.
 */

// ---- Private helpers (duplicated because originals are module-private) ----

function formatDate(raw, style) {
    if (!raw) return raw;
    const d = new Date(raw);
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
        return Object.keys(val).filter(k => !k.startsWith('_')).some(k => hasValue(val[k]));
    }
    return true;
}

// ---- Static tile map (no Leaflet — pure DOM + Web Mercator math) ----

/**
 * Render a static OpenStreetMap tile map centered on the given coordinates.
 * Creates a 3×3 grid of 256 px tiles, positions via CSS transform so the
 * target point sits at the container's center, and resolves when done.
 *
 * @param {number} lat  Latitude in degrees
 * @param {number} lng  Longitude in degrees
 * @param {HTMLElement} container  Map container (must be in the DOM)
 * @param {number} [zoom=15]  Tile zoom level
 * @returns {Promise<boolean>} true if at least one tile loaded
 */
function createStaticMap(lat, lng, container, zoom) {
    zoom = zoom || 15;
    let TILE = 256;
    let n = Math.pow(2, zoom);

    // Web Mercator: lat/lng → continuous tile coordinates
    let tileXf = (lng + 180) / 360 * n;
    let latRad = lat * Math.PI / 180;
    let tileYf = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    tileYf = Math.max(0, Math.min(n - 1, tileYf)); // clamp near poles

    let cx = Math.floor(tileXf);
    let cy = Math.floor(tileYf);
    let offX = (tileXf - cx) * TILE;
    let offY = (tileYf - cy) * TILE;

    let COLS = 3, ROWS = 3;
    let subs = ['a', 'b', 'c'];
    let wrapper = document.createElement('div');
    wrapper.className = 'editorial-map-tiles';

    let loaded = 0, failed = 0, total = COLS * ROWS;

    return new Promise(function (resolve) {
        let timer = setTimeout(function () { if (loaded === 0) resolve(false); }, 4000);

        function check() {
            if (loaded + failed === total) {
                clearTimeout(timer);
                resolve(loaded > 0);
            }
        }

        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                let tx = cx - 1 + col;          // one tile left of center
                let ty = cy - 1 + row;           // one tile above center
                tx = ((tx % n) + n) % n;        // wrap at date line
                if (ty < 0 || ty >= n) { total--; continue; }

                let img = document.createElement('img');
                img.className = 'editorial-map-tile';
                img.alt = '';
                img.draggable = false;
                img.style.gridColumn = String(col + 1);
                img.style.gridRow = String(row + 1);
                img.src = 'https://' + subs[(tx + ty) % 3] +
                    '.tile.openstreetmap.org/' + zoom + '/' + tx + '/' + ty + '.png';
                img.onload = function () { loaded++; check(); };
                img.onerror = function () { failed++; this.style.display = 'none'; check(); };
                wrapper.appendChild(img);
            }
        }

        container.appendChild(wrapper);

        // Position grid so the target coordinate is at container center
        requestAnimationFrame(function () {
            let cw = container.clientWidth || 360;
            let ch = container.clientHeight || 170;
            let targetGX = 1 * TILE + offX;   // col 1 is the center tile
            let targetGY = 1 * TILE + offY;   // row 1 is the center row
            wrapper.style.transform =
                'translate(' + (cw / 2 - targetGX) + 'px,' + (ch / 2 - targetGY) + 'px)';
        });
    });
}

// ---- Auto-fade behavior ----

function setupAutoFade(titleBlock, cornerElement) {
    let fadeTimer;
    const elements = [titleBlock, cornerElement].filter(Boolean);

    const fadeIn = () => {
        elements.forEach(el => { el.style.opacity = '1'; });
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => {
            elements.forEach(el => { el.style.opacity = '0.15'; });
        }, 4000);
    };

    document.addEventListener('mousemove', fadeIn, { signal: _signal });

    // Touch: tap on viewer canvas reveals title for 3s (mousemove doesn't fire on touch)
    const canvas = document.getElementById('viewer-canvas');
    if (canvas) {
        canvas.addEventListener('touchstart', (e) => {
            // Only single-tap on blank canvas (not pinch/multi-touch)
            if (e.touches.length === 1) fadeIn();
        }, { passive: true });
    }

    fadeTimer = setTimeout(() => {
        elements.forEach(el => { el.style.opacity = '0.15'; });
    }, 4000);
}

// ---- Info panel (side panel with image strip) ----

function createCollapsible(title, openByDefault) {
    const section = document.createElement('div');
    section.className = 'editorial-collapsible' + (openByDefault ? ' open' : '');
    const header = document.createElement('div');
    header.className = 'editorial-collapsible-header';
    header.innerHTML = `<span class="editorial-collapsible-title">${title}</span><span class="editorial-collapsible-chevron">&#9654;</span>`;
    header.addEventListener('click', () => section.classList.toggle('open'));
    section.appendChild(header);
    const content = document.createElement('div');
    content.className = 'editorial-collapsible-content';
    const inner = document.createElement('div');
    inner.className = 'editorial-collapsible-inner';
    content.appendChild(inner);
    section.appendChild(content);
    return { section, content: inner };
}

function createQualityDetail(label, value, extraClass) {
    const el = document.createElement('div');
    el.className = 'editorial-quality-detail';
    el.innerHTML = `<span class="editorial-quality-label">${label}</span><span class="editorial-quality-value${extraClass || ''}">${value}</span>`;
    return el;
}

function createSubjectDetail(label, value) {
    const el = document.createElement('div');
    el.className = 'editorial-subject-detail';
    el.innerHTML = `<span class="editorial-subject-label">${label}</span><span class="editorial-subject-value">${value}</span>`;
    return el;
}

function createTechDetail(label, value) {
    const el = document.createElement('div');
    el.className = 'editorial-tech-detail';
    el.innerHTML = `<span class="editorial-tech-label">${label}</span><span class="editorial-tech-value">${value}</span>`;
    return el;
}

function createInfoOverlay(manifest, deps) {
    const { escapeHtml, parseMarkdown, resolveAssetRefs, state, annotationSystem, modelGroup } = deps;

    const metadataProfile = deps.metadataProfile || 'archival';
    const shouldShow = (title) => {
        const tiers = deps.EDITORIAL_SECTION_TIERS;
        const tier = tiers?.[title];
        if (!tier || !deps.isTierVisible) return true;
        return deps.isTierVisible(tier, metadataProfile);
    };

    const overlay = document.createElement('div');
    overlay.className = 'editorial-info-overlay';

    const panelInner = document.createElement('div');
    panelInner.className = 'editorial-panel-inner';

    // --- Image strip ---
    const imageAssets = state.imageAssets || {};
    const desc = manifest?.description || manifest?.project?.description || '';
    let stripSrc = null;
    const assetKeys = Object.keys(imageAssets);
    if (assetKeys.length > 0) {
        stripSrc = imageAssets['preview.jpg'] || imageAssets['preview.png'] || imageAssets[assetKeys[0]];
    }
    if (!stripSrc && desc) {
        const tmp = document.createElement('div');
        tmp.innerHTML = parseMarkdown(resolveAssetRefs(desc, imageAssets));
        const firstImg = tmp.querySelector('img');
        if (firstImg) stripSrc = firstImg.src;
    }

    const imageStrip = document.createElement('div');
    imageStrip.className = 'editorial-image-strip';
    const stripAccent = document.createElement('div');
    stripAccent.className = 'editorial-strip-accent';

    if (stripSrc) {
        const stripImg = document.createElement('img');
        stripImg.src = stripSrc;
        stripImg.alt = '';
        stripImg.draggable = false;
        imageStrip.appendChild(stripImg);
        panelInner.appendChild(imageStrip);
        panelInner.appendChild(stripAccent);
    }

    // --- Close button ---
    const closeBtn = document.createElement('button');
    closeBtn.className = 'editorial-info-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
        overlay.classList.remove('open');
        overlay.classList.remove('mobile-open');
        const detailsBtn = document.querySelector('.editorial-details-link');
        if (detailsBtn) detailsBtn.classList.remove('active');
        if (syncInfoOverlayState) syncInfoOverlayState(false);
    });
    panelInner.appendChild(closeBtn);

    // --- Scrollable content ---
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'editorial-info-content';

    // === Title block ===
    const headerSection = document.createElement('div');
    headerSection.className = 'editorial-info-header';

    const infoTitleEl = document.createElement('h2');
    infoTitleEl.className = 'editorial-info-title';
    infoTitleEl.textContent = 'Info';
    headerSection.appendChild(infoTitleEl);

    const titleBar = document.createElement('div');
    titleBar.className = 'editorial-info-title-bar';
    headerSection.appendChild(titleBar);

    // Model stats
    if (modelGroup && modelGroup.children.length > 0) {
        let vertexCount = 0, textureSet = new Set(), maxTexRes = 0;
        modelGroup.traverse(child => {
            if (child.isMesh && child.geometry) {
                const geo = child.geometry;
                if (geo.attributes.position) vertexCount += geo.attributes.position.count;
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => {
                    if (m) {
                        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(t => {
                            const tex = m[t];
                            if (tex && !textureSet.has(tex)) {
                                textureSet.add(tex);
                                const img = tex.image;
                                if (img && img.width) maxTexRes = Math.max(maxTexRes, img.width, img.height);
                            }
                        });
                    }
                });
            }
        });
        if (vertexCount > 0) {
            const parts = [];
            const fmt = (n) => n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M' : n.toLocaleString();
            parts.push(`<strong>${fmt(vertexCount)}</strong> vertices`);
            if (textureSet.size > 0) parts.push(`<strong>${textureSet.size}</strong> textures @ ${maxTexRes}\u00B2`);
            const annoCount = annotationSystem ? annotationSystem.getAnnotations().length : 0;
            if (annoCount > 0) parts.push(`<strong>${annoCount}</strong> annotations`);

            const statsEl = document.createElement('div');
            statsEl.className = 'editorial-info-model-stats';
            statsEl.innerHTML = parts.join(' \u00B7 ');
            headerSection.appendChild(statsEl);
        }
    }

    contentWrapper.appendChild(headerSection);

    // === Description (reading zone) ===
    if (desc) {
        const descEl = document.createElement('div');
        descEl.className = 'editorial-info-description';
        descEl.innerHTML = parseMarkdown(resolveAssetRefs(desc, imageAssets));
        // Remove first image if it's already shown in the image strip
        if (stripSrc) {
            const firstImg = descEl.querySelector('img');
            if (firstImg) {
                // Remove if src matches strip, or if strip was extracted from description
                const parent = firstImg.parentElement;
                firstImg.remove();
                // Clean up empty <p> wrapper left behind
                if (parent && parent.tagName === 'P' && parent.textContent.trim() === '') parent.remove();
            }
        }
        contentWrapper.appendChild(descEl);
    }

    // === Collapsible: The Subject ===
    const ar = manifest?.archival_record;
    if (ar && hasValue(ar) && shouldShow('The Subject')) {
        const { section, content } = createCollapsible('The Subject', false);

        const subjectGrid = document.createElement('div');
        subjectGrid.className = 'editorial-subject-grid';
        const creation = ar.creation || {};
        const phys = ar.physical_description || {};
        if (creation.creator) subjectGrid.appendChild(createSubjectDetail('Creator', escapeHtml(creation.creator)));
        const creationDate = creation.date || creation.date_created;
        if (creationDate) subjectGrid.appendChild(createSubjectDetail('Date', escapeHtml(String(creationDate))));
        if (creation.period) subjectGrid.appendChild(createSubjectDetail('Period', escapeHtml(creation.period)));
        if (creation.culture) subjectGrid.appendChild(createSubjectDetail('Culture', escapeHtml(creation.culture)));
        if (phys.medium) subjectGrid.appendChild(createSubjectDetail('Medium', escapeHtml(phys.medium)));
        if (phys.dimensions) {
            const d = phys.dimensions;
            const dimStr = typeof d === 'object'
                ? [d.height, d.width, d.depth].filter(Boolean).join(' × ') || JSON.stringify(d)
                : String(d);
            subjectGrid.appendChild(createSubjectDetail('Dimensions', escapeHtml(dimStr)));
        }
        if (phys.condition) subjectGrid.appendChild(createSubjectDetail('Condition', escapeHtml(phys.condition)));
        if (subjectGrid.children.length > 0) content.appendChild(subjectGrid);

        // Location block — combines location name + static tile map
        const subjLocation = ar.coverage?.spatial?.place || ar.coverage?.spatial?.location_name || manifest?.location;
        const coords = manifest?.coordinates || ar.coverage?.spatial?.coordinates;
        if (subjLocation || coords) {
            const locLabeled = document.createElement('div');
            locLabeled.className = 'editorial-prose-labeled';
            const locLabel = document.createElement('div');
            locLabel.className = 'editorial-prose-sub-label';
            locLabel.textContent = 'Location';
            locLabeled.appendChild(locLabel);

            // Location name text
            if (subjLocation) {
                const locName = document.createElement('div');
                locName.className = 'editorial-location-name';
                locName.textContent = subjLocation;
                locLabeled.appendChild(locName);
            }

            // GPS coordinates — static tile map with graceful fallback
            if (coords) {
                let lat, lng;
                if (Array.isArray(coords) && coords.length >= 2) {
                    lat = coords[0]; lng = coords[1];
                } else {
                    lat = coords.latitude || coords.lat;
                    lng = coords.longitude || coords.lng || coords.lon;
                }
                if (lat != null && lng != null) {
                    lat = parseFloat(String(lat));
                    lng = parseFloat(String(lng));
                    if (!isNaN(lat) && !isNaN(lng)) {
                        const mapContainer = document.createElement('div');
                        mapContainer.className = 'editorial-map-placeholder';

                        const latDir = lat >= 0 ? 'N' : 'S';
                        const lngDir = lng >= 0 ? 'E' : 'W';
                        const latStr = escapeHtml(Math.abs(lat).toFixed(6));
                        const lngStr = escapeHtml(Math.abs(lng).toFixed(6));

                        const pin = document.createElement('div');
                        pin.className = 'editorial-map-pin-overlay';
                        pin.innerHTML = '<svg width="20" height="28" viewBox="0 0 24 34" fill="none"><path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 22 12 22s12-13 12-22C24 5.37 18.63 0 12 0zm0 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" fill="currentColor"/></svg>';

                        const footer = document.createElement('div');
                        footer.className = 'editorial-map-footer';
                        footer.innerHTML =
                            '<span class="editorial-map-coords">' + latStr + '\u00B0' + latDir + ', ' + lngStr + '\u00B0' + lngDir + '</span>' +
                            '<span class="editorial-map-attribution">\u00A9 OpenStreetMap</span>';

                        mapContainer.appendChild(pin);
                        mapContainer.appendChild(footer);
                        locLabeled.appendChild(mapContainer);

                        createStaticMap(lat, lng, mapContainer, 15).then(function (ok) {
                            mapContainer.classList.add(ok ? 'editorial-map-loaded' : 'editorial-map-fallback');
                        });
                    }
                }
            }

            content.appendChild(locLabeled);
        }

        // Historical context prose
        if (ar.context?.description) {
            const proseLabeled = document.createElement('div');
            proseLabeled.className = 'editorial-prose-labeled';
            const subLabel = document.createElement('div');
            subLabel.className = 'editorial-prose-sub-label';
            subLabel.textContent = 'Historical Context';
            proseLabeled.appendChild(subLabel);
            const proseBlock = document.createElement('div');
            proseBlock.className = 'editorial-prose-block';
            proseBlock.innerHTML = parseMarkdown(ar.context.description);
            proseLabeled.appendChild(proseBlock);
            content.appendChild(proseLabeled);
        }

        // Provenance prose
        if (ar.provenance) {
            const proseLabeled = document.createElement('div');
            proseLabeled.className = 'editorial-prose-labeled';
            const subLabel = document.createElement('div');
            subLabel.className = 'editorial-prose-sub-label';
            subLabel.textContent = 'Provenance';
            proseLabeled.appendChild(subLabel);
            const proseBlock = document.createElement('div');
            proseBlock.className = 'editorial-prose-block';
            proseBlock.innerHTML = parseMarkdown(ar.provenance);
            proseLabeled.appendChild(proseBlock);
            content.appendChild(proseLabeled);
        }

        contentWrapper.appendChild(section);
    }

    // === Collapsible: Quality & Capture ===
    const qm = manifest?.quality_metrics;
    const prov = manifest?.provenance;
    const hasQuality = qm && hasValue(qm);
    const hasCapture = prov && (prov.capture_device || prov.device_serial);
    const operator = manifest?.creator || prov?.operator;
    if ((hasQuality || hasCapture || operator) && shouldShow('Quality & Capture')) {
        const { section, content } = createCollapsible('Quality & Capture', false);

        // Operator credit line
        if (operator) {
            const creditLine = document.createElement('div');
            creditLine.className = 'editorial-info-credit-line';
            creditLine.innerHTML = `<span class="org">${escapeHtml(operator)}</span>`;
            content.appendChild(creditLine);
        }

        // 3-column quality grid
        const qualityGrid = document.createElement('div');
        qualityGrid.className = 'editorial-quality-grid';
        if (qm) {
            if (qm.tier) qualityGrid.appendChild(createQualityDetail('Tier', escapeHtml(String(qm.tier))));
            if (qm.accuracy_grade) qualityGrid.appendChild(createQualityDetail('Accuracy', escapeHtml(`Grade ${qm.accuracy_grade}`)));
            if (qm.capture_resolution?.value != null) {
                const cr = qm.capture_resolution;
                qualityGrid.appendChild(createQualityDetail('Resolution', escapeHtml(`${cr.value}${cr.unit || ''} GSD`)));
            }
            if (qm.alignment_error?.value != null) {
                const ae = qm.alignment_error;
                qualityGrid.appendChild(createQualityDetail('Alignment', escapeHtml(`${ae.value}${ae.unit || ''} RMSE`)));
            }
            if (qm.scale_verification) qualityGrid.appendChild(createQualityDetail('Scale Check', escapeHtml(qm.scale_verification)));
        }
        if (prov?.capture_device) qualityGrid.appendChild(createQualityDetail('Device', escapeHtml(prov.capture_device)));
        if (prov?.device_serial) {
            const serialEl = createQualityDetail('Serial', escapeHtml(prov.device_serial));
            const valSpan = serialEl.querySelector('.editorial-quality-value');
            if (valSpan) {
                valSpan.style.fontFamily = 'var(--kiosk-font-mono)';
                valSpan.style.fontSize = '0.68rem';
                valSpan.style.letterSpacing = '0.01em';
            }
            qualityGrid.appendChild(serialEl);
        }
        if (qualityGrid.children.length > 0) content.appendChild(qualityGrid);

        // Secondary quality grid (data_quality sub-fields)
        if (qm && hasValue(qm.data_quality)) {
            const secGrid = document.createElement('div');
            secGrid.className = 'editorial-quality-secondary';
            Object.keys(qm.data_quality).forEach(k => {
                secGrid.appendChild(createQualityDetail(
                    escapeHtml(k.replace(/_/g, ' ')),
                    escapeHtml(String(qm.data_quality[k]))
                ));
            });
            content.appendChild(secGrid);
        }

        contentWrapper.appendChild(section);
    }

    // === Flight Log placeholder (populated by onFlightPathLoaded) ===
    const flightLogPlaceholder = document.createElement('div');
    flightLogPlaceholder.id = 'editorial-flight-log-section';
    contentWrapper.appendChild(flightLogPlaceholder);

    // === Collapsible: Processing ===
    if (prov && shouldShow('Processing')) {
        const hasSoftware = Array.isArray(prov.processing_software) && prov.processing_software.length > 0;
        const hasNotes = !!prov.processing_notes;
        if (hasSoftware || hasNotes) {
            const { section, content } = createCollapsible('Processing', false);

            if (hasSoftware) {
                const swLine = document.createElement('div');
                swLine.className = 'editorial-software-line';
                const names = prov.processing_software.map(sw =>
                    typeof sw === 'object' ? `${sw.name || ''}${sw.version ? ' ' + sw.version : ''}`.trim() : sw
                ).filter(Boolean);
                swLine.innerHTML = `<strong>Software</strong> ${escapeHtml(names.join(' \u00B7 '))}`;
                content.appendChild(swLine);
            }

            if (hasNotes) {
                const proseBlock = document.createElement('div');
                proseBlock.className = 'editorial-prose-block';
                proseBlock.innerHTML = parseMarkdown(prov.processing_notes);
                content.appendChild(proseBlock);
            }

            contentWrapper.appendChild(section);
        }
    }

    // === Collapsible: Data Assets ===
    let entries = manifest?.data_entries;
    // Normalize object-keyed entries to array (manifest may use {scene_0: {...}, mesh_0: {...}} format)
    if (entries && !Array.isArray(entries) && typeof entries === 'object') {
        entries = Object.values(entries).filter(e => e && typeof e === 'object');
    }
    if (Array.isArray(entries) && entries.length > 0 && shouldShow('Data Assets')) {
        const { section, content } = createCollapsible('Data Assets', false);

        entries.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'editorial-asset-item';

            const headerEl = document.createElement('div');
            headerEl.className = 'editorial-asset-header';
            if (entry.role) {
                const roleEl = document.createElement('span');
                roleEl.className = 'editorial-asset-role';
                roleEl.textContent = entry.role;
                headerEl.appendChild(roleEl);
            }
            const nameEl = document.createElement('span');
            nameEl.className = 'editorial-asset-filename';
            nameEl.textContent = entry.file_name || entry.filename || '';
            headerEl.appendChild(nameEl);
            item.appendChild(headerEl);

            const entryCreator = entry.creator || entry.created_by;
            if (entryCreator) {
                const creatorEl = document.createElement('div');
                creatorEl.className = 'editorial-asset-creator';
                creatorEl.textContent = entryCreator;
                item.appendChild(creatorEl);
            }

            // Meta chips (file size, counts)
            const metaChips = [];
            if (entry.file_size) metaChips.push(entry.file_size);
            if (entry.splat_count) metaChips.push(`${Number(entry.splat_count).toLocaleString()} splats`);
            if (entry.polygon_count) metaChips.push(`${Number(entry.polygon_count).toLocaleString()} polygons`);
            if (entry.vertex_count) metaChips.push(`${Number(entry.vertex_count).toLocaleString()} vertices`);
            if (metaChips.length > 0) {
                const metaRow = document.createElement('div');
                metaRow.className = 'editorial-asset-meta';
                metaChips.forEach(chip => {
                    const chipEl = document.createElement('span');
                    chipEl.className = 'editorial-asset-meta-chip';
                    chipEl.textContent = chip;
                    metaRow.appendChild(chipEl);
                });
                item.appendChild(metaRow);
            }

            // Source notes
            if (entry._source_notes) {
                const notesEl = document.createElement('div');
                notesEl.className = 'editorial-asset-notes';
                notesEl.textContent = entry._source_notes;
                item.appendChild(notesEl);
            }

            content.appendChild(item);
        });

        contentWrapper.appendChild(section);
    }

    // === Collapsible: Technical Details ===
    if (shouldShow('Technical Details')) {
        const hasTech = ar || manifest?.material_standard || manifest?.preservation || manifest?.integrity;
        if (hasTech) {
            const { section, content } = createCollapsible('Technical Details', false);

            const techGrid = document.createElement('div');
            techGrid.className = 'editorial-tech-grid';
            if (ar?.standard) techGrid.appendChild(createTechDetail('Standard', escapeHtml(ar.standard)));
            const copyrightVal = ar?.rights?.holder || ar?.rights?.copyright_status;
            if (copyrightVal) techGrid.appendChild(createTechDetail('Copyright', escapeHtml(copyrightVal)));
            const matStd = manifest?.material_standard;
            if (matStd) {
                if (matStd.workflow) techGrid.appendChild(createTechDetail('Material', escapeHtml(matStd.workflow)));
                if (matStd.color_space) techGrid.appendChild(createTechDetail('Color Space', escapeHtml(matStd.color_space)));
                const normalVal = matStd.normal_convention || matStd.normal_space;
                if (normalVal) techGrid.appendChild(createTechDetail('Normal', escapeHtml(normalVal)));
            }
            const pres = manifest?.preservation;
            if (pres?.rendering_requirements) techGrid.appendChild(createTechDetail('Rendering', escapeHtml(pres.rendering_requirements)));
            if (techGrid.children.length > 0) content.appendChild(techGrid);

            // Significant properties
            if (pres?.significant_properties?.length > 0) {
                const subHead = document.createElement('div');
                subHead.className = 'editorial-tech-sub-header';
                subHead.textContent = 'Significant Properties';
                content.appendChild(subHead);
                const propsRow = document.createElement('div');
                propsRow.className = 'editorial-sig-props';
                pres.significant_properties.forEach(prop => {
                    const chip = document.createElement('span');
                    chip.className = 'editorial-sig-prop';
                    chip.textContent = prop;
                    propsRow.appendChild(chip);
                });
                content.appendChild(propsRow);
            }

            // Integrity hashes — supports both {checksums: [{file, hash}]} and {assets: {file: hash}} formats
            const integ = manifest?.integrity;
            let hashEntries = [];
            if (Array.isArray(integ?.checksums) && integ.checksums.length > 0) {
                hashEntries = integ.checksums.map(cs => ({ file: cs.file || '', hash: cs.hash || cs.value || '' }));
            } else if (integ?.assets && typeof integ.assets === 'object') {
                hashEntries = Object.entries(integ.assets).map(([file, hash]) => ({ file, hash: String(hash) }));
            }
            if (hashEntries.length > 0) {
                const subHead = document.createElement('div');
                subHead.className = 'editorial-tech-sub-header';
                subHead.textContent = `Integrity \u2014 ${escapeHtml(integ.algorithm || 'SHA-256')}`;
                content.appendChild(subHead);
                const hashList = document.createElement('ul');
                hashList.className = 'editorial-hash-list';
                hashEntries.forEach(({ file, hash }) => {
                    const li = document.createElement('li');
                    const truncated = hash.length > 16 ? hash.slice(0, 8) + '...' + hash.slice(-8) : hash;
                    li.innerHTML = `<span>${escapeHtml(file)}</span> ${escapeHtml(truncated)}`;
                    hashList.appendChild(li);
                });
                content.appendChild(hashList);
            }

            // Creation / modified dates
            const creationDate = manifest?._creation_date || manifest?._meta?.created;
            const modifiedDate = manifest?._last_modified || manifest?._meta?.modified;
            if (creationDate || modifiedDate) {
                const datesRow = document.createElement('div');
                datesRow.className = 'editorial-dates-row';
                if (creationDate) datesRow.appendChild(createTechDetail('Created', escapeHtml(String(creationDate))));
                if (modifiedDate) datesRow.appendChild(createTechDetail('Last Modified', escapeHtml(String(modifiedDate))));
                content.appendChild(datesRow);
            }

            contentWrapper.appendChild(section);
        }
    }

    // === Collapsible: Tags ===
    const tags = manifest?.tags || manifest?.project?.tags || [];
    if (tags.length > 0 && shouldShow('Tags')) {
        const { section, content } = createCollapsible('Tags', false);
        const tagsRow = document.createElement('div');
        tagsRow.className = 'editorial-info-tags';
        tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'editorial-tag-chip';
            chip.textContent = tag;
            tagsRow.appendChild(chip);
        });
        content.appendChild(tagsRow);
        contentWrapper.appendChild(section);
    }

    // === Footer ===
    const license = manifest?.license || manifest?.project?.license || manifest?.archival_record?.rights?.license ||
                    manifest?.archival_record?.rights?.statement || '';
    if (license) {
        const licenseEl = document.createElement('div');
        licenseEl.className = 'editorial-info-license';
        licenseEl.textContent = license;
        contentWrapper.appendChild(licenseEl);
    }

    panelInner.appendChild(contentWrapper);
    overlay.appendChild(panelInner);
    return overlay;
}

// ---- Cleanup — remove all DOM elements created by setup() ----

/** Top-level CSS classes appended to viewerContainer by setup(). */
const EDITORIAL_ROOT_CLASSES = [
    'editorial-spine',
    'editorial-title-block',
    'editorial-bottom-ribbon',
    'editorial-mobile-pill',
    'editorial-info-overlay',
    'editorial-anno-strip',
    'editorial-frozen-label'
];

export function cleanup() {
    // Abort all document-level listeners registered during setup()
    if (_editorialAbort) { _editorialAbort.abort(); _editorialAbort = null; }

    // Remove from both viewerContainer and body (mobile portals fixed elements to body)
    const viewerContainer = document.getElementById('viewer-container') || document.body;
    EDITORIAL_ROOT_CLASSES.forEach(cls => {
        viewerContainer.querySelectorAll('.' + cls).forEach(el => el.remove());
        document.body.querySelectorAll('.' + cls).forEach(el => el.remove());
    });
    // Null out flight path manager callbacks to prevent stale closures
    if (_flightPathManager) {
        _flightPathManager.onPlaybackUpdate(null);
        _flightPathManager.onPlaybackEnd(null);
        _flightPathManager.onCameraModeChange(null);
        _flightPathManager = null;
    }
    // Reset walkthrough module state
    wtStopDots = null;
    wtTitleEl = null;
    if (wtMobileControls) { wtMobileControls.remove(); wtMobileControls = null; }
    wtTotalStops = 0;
    syncInfoOverlayState = null;
}

// ---- Main setup entry point ----

export function setup(manifest, deps) {
    const {
        Logger, escapeHtml,
        updateModelTextures, updateModelWireframe, updateModelMatcap, updateModelNormals,
        updateModelRoughness, updateModelMetalness,
        sceneManager, state, annotationSystem, modelGroup,
        setDisplayMode, createDisplayModeDeps, triggerLazyLoad,
        showAnnotationPopup, hideAnnotationPopup, hideAnnotationLine,
        getCurrentPopupId, setCurrentPopupId,
        resetOrbitCenter,
        flightPathManager
    } = deps;

    const log = Logger.getLogger('editorial-layout');
    log.info('Setting up editorial layout');

    // Store flight path manager ref for cleanup
    _flightPathManager = flightPathManager || null;

    // Remove any previously-created editorial layout elements (re-entry safe)
    cleanup();

    // Create AbortController for document-level listeners (aborted in cleanup())
    _editorialAbort = new AbortController();
    const _signal = _editorialAbort.signal;

    // Hide orbit-reset when the archive locks the orbit pivot (pan disabled)
    const vs = manifest && manifest.viewer_settings;
    const cameraLocked = !!(vs && vs.lock_orbit);

    const viewerContainer = document.getElementById('viewer-container') || document.body;

    // Set scene background from theme metadata, or fall back to CSS variable.
    // Skip if the archive manifest declares its own background override — the
    // kiosk loader applies that override after setup() returns, and we must not
    // clobber savedBackgroundColor with the theme default.
    const hasArchiveBgOverride = manifest && manifest.viewer_settings &&
        (manifest.viewer_settings.splat_background_color ||
         manifest.viewer_settings.mesh_background_color ||
         manifest.viewer_settings.background_color);
    if (!hasArchiveBgOverride) {
        const themeMeta = (window.APP_CONFIG || {})._themeMeta;
        const sceneBg = (themeMeta && themeMeta.sceneBg) ||
            getComputedStyle(document.body).getPropertyValue('--kiosk-scene-bg').trim() ||
            '#1a1a2e';
        sceneManager.setBackgroundColor(sceneBg);
    }

    // --- 1. Gold Spine ---
    const spine = document.createElement('div');
    spine.className = 'editorial-spine';
    viewerContainer.appendChild(spine);

    // --- 2. Title Block — title, gold rule, meta ---
    const titleBlock = document.createElement('div');
    titleBlock.className = 'editorial-title-block';

    const title = manifest?.title || manifest?.project?.title || manifest?.archival_record?.title || '';
    const location = manifest?.location || manifest?.provenance?.location || manifest?.archival_record?.creation?.place || '';
    const rawDate = manifest?.date || manifest?.provenance?.capture_date || manifest?.archival_record?.creation?.date || '';
    const date = formatDate(rawDate, 'medium') || rawDate;
    const metaParts = [location, date].filter(Boolean);

    titleBlock.innerHTML = `
        <h1>${escapeHtml(title)}</h1>
        <div class="editorial-title-rule"></div>
        ${metaParts.length > 0 ? `<span class="editorial-title-meta">${escapeHtml(metaParts.join(' \u00B7 '))}</span>` : ''}
    `;
    // On mobile, append fixed-position elements to document.body so position:fixed
    // works correctly. Chrome Android doesn't break fixed elements out of overflow:hidden
    // flex containers reliably.
    const isMobileTier = window.matchMedia('(max-width: 699px)').matches;
    const fixedRoot = isMobileTier ? document.body : viewerContainer;

    // Detail subtitle — shown when detail viewer is active (CSS-driven visibility)
    const detailSubtitle = document.createElement('div');
    detailSubtitle.className = 'editorial-detail-subtitle';
    detailSubtitle.innerHTML = '<span class="detail-label">Inspecting Detail</span><span class="detail-name"></span>';
    titleBlock.appendChild(detailSubtitle);

    // Frozen preview label — appears over dimmed main canvas in detail mode
    const frozenLabel = document.createElement('div');
    frozenLabel.className = 'editorial-frozen-label';
    frozenLabel.textContent = 'Main Scene';

    fixedRoot.appendChild(titleBlock);
    fixedRoot.appendChild(frozenLabel);

    // Auto-fade behavior for title block
    setupAutoFade(titleBlock, null);

    // Logo src for ribbon
    const logoSrc = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';

    // --- 4. Bottom Ribbon ---
    const ribbon = document.createElement('div');
    ribbon.className = 'editorial-bottom-ribbon';

    // View modes
    const viewModes = document.createElement('div');
    viewModes.className = 'editorial-view-modes';

    const contentInfo = state.archiveLoader ? state.archiveLoader.getContentInfo() : null;
    const types = [];
    if (contentInfo) {
        if (contentInfo.hasMesh) types.push({ mode: 'model', label: 'Model' });
        if (contentInfo.hasSplat) types.push({ mode: 'splat', label: 'Splat' });
        if (contentInfo.hasPointcloud) types.push({ mode: 'pointcloud', label: 'Point Cloud' });
    }
    if (types.length >= 2) {
        types.push({ mode: 'both', label: 'Both' });
    }

    types.forEach(({ mode, label }) => {
        const link = document.createElement('button');
        link.className = 'editorial-view-mode-link';
        link.dataset.mode = mode;
        link.textContent = label;
        if (state.displayMode === mode) link.classList.add('active');
        link.addEventListener('click', () => {
            state.displayMode = mode;
            setDisplayMode(mode, createDisplayModeDeps());
            triggerLazyLoad(mode);
            if (deps.applyBackgroundForMode) deps.applyBackgroundForMode(mode);
            viewModes.querySelectorAll('.editorial-view-mode-link:not(.quality-toggle-btn)').forEach(l => {
                l.classList.toggle('active', l.dataset.mode === mode);
            });
        });
        viewModes.appendChild(link);
    });

    // Quality toggle (SD/HD) — inline with view modes if archive has proxies, splat (Spark 2.0 LOD budget), or mesh
    if (deps.hasAnyProxy || deps.hasSplat || deps.hasMesh) {
        const qualitySep = document.createElement('span');
        qualitySep.className = 'editorial-view-mode-sep';
        qualitySep.textContent = '|';
        viewModes.appendChild(qualitySep);

        const sdBtn = document.createElement('button');
        sdBtn.className = 'editorial-view-mode-link quality-toggle-btn' + (deps.qualityResolved === 'sd' ? ' active' : '');
        sdBtn.dataset.tier = 'sd';
        sdBtn.textContent = 'SD';
        viewModes.appendChild(sdBtn);

        const hdBtn = document.createElement('button');
        hdBtn.className = 'editorial-view-mode-link quality-toggle-btn' + (deps.qualityResolved === 'hd' ? ' active' : '');
        hdBtn.dataset.tier = 'hd';
        hdBtn.textContent = 'HD';
        viewModes.appendChild(hdBtn);

        [sdBtn, hdBtn].forEach(btn => {
            btn.addEventListener('click', () => {
                if (deps.switchQualityTier) deps.switchQualityTier(btn.dataset.tier);
                [sdBtn, hdBtn].forEach(b => {
                    b.classList.toggle('active', b.dataset.tier === btn.dataset.tier);
                });
            });
        });
    }

    // Info link — last item in viewModes
    const infoSep = document.createElement('span');
    infoSep.className = 'editorial-view-mode-sep';
    infoSep.textContent = '|';
    viewModes.appendChild(infoSep);
    const detailsLink = document.createElement('button');
    detailsLink.className = 'editorial-view-mode-link editorial-details-link';
    detailsLink.textContent = 'Info';
    viewModes.appendChild(detailsLink);

    // Measure dropdown (like material view — self-contained, replaces global scale panel)
    let measureWrapper = null;
    if (deps.measurementSystem) {
        measureWrapper = document.createElement('div');
        measureWrapper.className = 'editorial-measure-wrapper';

        const measureBtn = document.createElement('button');
        measureBtn.className = 'editorial-marker-toggle editorial-measure-btn';
        measureBtn.title = 'Measure';
        measureBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M5.5 5.5L8 3"/><path d="M9.5 9.5L12 7"/><path d="M13.5 13.5L16 11"/><path d="M17.5 17.5L20 15"/></svg>';

        const measureDropdown = document.createElement('div');
        measureDropdown.className = 'editorial-measure-dropdown';

        // Scale row: 1 unit = [value] [unit]
        const scaleRow = document.createElement('div');
        scaleRow.className = 'editorial-measure-scale-row';

        const scaleLabel = document.createElement('span');
        scaleLabel.className = 'editorial-measure-scale-label';
        scaleLabel.textContent = '1 unit =';

        const scaleValue = document.createElement('input');
        scaleValue.type = 'number';
        scaleValue.value = '1';
        scaleValue.min = '0.0001';
        scaleValue.step = 'any';
        scaleValue.className = 'editorial-measure-scale-value';

        const scaleUnit = document.createElement('select');
        scaleUnit.className = 'editorial-measure-scale-unit';
        ['m', 'cm', 'mm', 'in', 'ft'].forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            if (u === 'in') opt.selected = true;
            scaleUnit.appendChild(opt);
        });

        scaleRow.appendChild(scaleLabel);
        scaleRow.appendChild(scaleValue);
        scaleRow.appendChild(scaleUnit);
        measureDropdown.appendChild(scaleRow);

        // Clear all button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'editorial-measure-clear';
        clearBtn.textContent = 'Clear all';
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deps.measurementSystem.clearAll();
        });
        measureDropdown.appendChild(clearBtn);

        // Wire scale inputs → setScale()
        const getVal = () => parseFloat(scaleValue.value) || 1;
        const getUnit = () => scaleUnit.value;
        scaleValue.addEventListener('input', (e) => {
            e.stopPropagation();
            deps.measurementSystem.setScale(getVal(), getUnit());
        });
        scaleUnit.addEventListener('change', (e) => {
            e.stopPropagation();
            deps.measurementSystem.setScale(getVal(), getUnit());
        });

        // Initialize with inches
        deps.measurementSystem.setScale(1, 'in');

        // Button toggles measure mode + dropdown; deactivation clears all measurements
        measureBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = !deps.measurementSystem.isActive;
            deps.measurementSystem.setMeasureMode(isActive);
            measureBtn.classList.toggle('active', isActive);
            measureDropdown.classList.toggle('open', isActive);
        });

        measureWrapper.appendChild(measureBtn);
        measureWrapper.appendChild(measureDropdown);
    }

    // Slice / cross-section dropdown (slider-based, no gizmo)
    let sliceWrapper = null;
    const crossSection = deps.crossSection;
    if (crossSection) {
        sliceWrapper = document.createElement('div');
        sliceWrapper.className = 'editorial-slice-wrapper';

        const sliceBtn = document.createElement('button');
        sliceBtn.className = 'editorial-marker-toggle editorial-slice-btn';
        sliceBtn.title = 'Cross-section';
        sliceBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="3 2"/><polyline points="12 8 12 3"/><polyline points="12 16 12 21"/></svg>';

        const sliceDropdown = document.createElement('div');
        sliceDropdown.className = 'editorial-slice-dropdown';

        let sliceActive = false;
        let currentAxis = 'y';

        // Axis row
        const axisRow = document.createElement('div');
        axisRow.className = 'editorial-slice-axis-row';

        const axisLabel = document.createElement('span');
        axisLabel.className = 'editorial-slice-label';
        axisLabel.textContent = 'Axis';
        axisRow.appendChild(axisLabel);

        const axisBtnGroup = document.createElement('div');
        axisBtnGroup.className = 'editorial-slice-seg';

        ['X', 'Y', 'Z'].forEach(a => {
            const btn = document.createElement('button');
            btn.className = 'editorial-slice-seg-btn';
            btn.textContent = a;
            btn.dataset.axis = a.toLowerCase();
            if (a === 'Y') btn.classList.add('active');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentAxis = a.toLowerCase();
                crossSection.setAxis(currentAxis);
                axisBtnGroup.querySelectorAll('.editorial-slice-seg-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                // Reset slider to current position
                sliceSlider.value = String(crossSection.getPositionAlongAxis(currentAxis) * 100);
            });
            axisBtnGroup.appendChild(btn);
        });
        axisRow.appendChild(axisBtnGroup);
        sliceDropdown.appendChild(axisRow);

        // Position slider
        const sliderRow = document.createElement('div');
        sliderRow.className = 'editorial-slice-slider-row';

        const sliceSlider = document.createElement('input');
        sliceSlider.type = 'range';
        sliceSlider.min = '0';
        sliceSlider.max = '100';
        sliceSlider.step = '0.5';
        sliceSlider.value = '50';
        sliceSlider.className = 'editorial-slice-slider';

        sliceSlider.addEventListener('input', (e) => {
            e.stopPropagation();
            const t = parseFloat(sliceSlider.value) / 100;
            crossSection.setPositionAlongAxis(currentAxis, t);
        });

        sliderRow.appendChild(sliceSlider);
        sliceDropdown.appendChild(sliderRow);

        // Actions row: Flip · Reset
        const actionsRow = document.createElement('div');
        actionsRow.className = 'editorial-slice-actions';

        const flipBtn = document.createElement('button');
        flipBtn.className = 'editorial-slice-action';
        flipBtn.textContent = 'Flip';
        flipBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            crossSection.flip();
        });

        const actionDot = document.createElement('span');
        actionDot.className = 'editorial-slice-action-dot';
        actionDot.textContent = '\u00b7';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'editorial-slice-action editorial-slice-action-danger';
        resetBtn.textContent = 'Reset';
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const box = crossSection.getBBox();
            const center = { x: 0, y: 0, z: 0 };
            if (!box.isEmpty()) {
                center.x = (box.min.x + box.max.x) / 2;
                center.y = (box.min.y + box.max.y) / 2;
                center.z = (box.min.z + box.max.z) / 2;
            }
            crossSection.reset({ x: center.x, y: center.y, z: center.z });
            currentAxis = 'y';
            axisBtnGroup.querySelectorAll('.editorial-slice-seg-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.axis === 'y');
            });
            sliceSlider.value = '50';
        });

        actionsRow.appendChild(flipBtn);
        actionsRow.appendChild(actionDot);
        actionsRow.appendChild(resetBtn);
        sliceDropdown.appendChild(actionsRow);

        // Toggle: click activates/deactivates slice + opens/closes dropdown
        sliceBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // If active but dropdown was closed by outside click, just re-open it
            if (sliceActive && !sliceDropdown.classList.contains('open')) {
                sliceDropdown.classList.add('open');
                return;
            }

            sliceActive = !sliceActive;

            if (sliceActive) {
                const box = crossSection.getBBox();
                const center = { x: 0, y: 0, z: 0 };
                if (!box.isEmpty()) {
                    center.x = (box.min.x + box.max.x) / 2;
                    center.y = (box.min.y + box.max.y) / 2;
                    center.z = (box.min.z + box.max.z) / 2;
                }
                if (deps.setLocalClippingEnabled) deps.setLocalClippingEnabled(true);
                crossSection.start(center);
                crossSection.hideGizmo();
                sliceSlider.value = '50';
                currentAxis = 'y';
                axisBtnGroup.querySelectorAll('.editorial-slice-seg-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.axis === 'y');
                });
            } else {
                crossSection.stop();
                if (deps.setLocalClippingEnabled) deps.setLocalClippingEnabled(false);
            }

            sliceBtn.classList.toggle('active', sliceActive);
            sliceDropdown.classList.toggle('open', sliceActive);
        });

        // Close dropdown on outside click but keep slice active
        document.addEventListener('click', () => {
            sliceDropdown.classList.remove('open');
        }, { signal: _signal });
        sliceDropdown.addEventListener('click', (e) => { e.stopPropagation(); });

        // Re-open dropdown when clicking active slice button
        sliceWrapper.appendChild(sliceBtn);
        sliceWrapper.appendChild(sliceDropdown);
    }

    ribbon.appendChild(viewModes);

    // Detail back button — shown in detail mode, hidden otherwise (CSS-driven)
    const detailBackBtn = document.createElement('button');
    detailBackBtn.className = 'editorial-detail-back';
    detailBackBtn.innerHTML = '\u2190\u00a0Back to Scene';
    ribbon.appendChild(detailBackBtn);

    // Separator after Info / before tools
    const infoToolsRule = document.createElement('div');
    infoToolsRule.className = 'editorial-ribbon-rule';
    ribbon.appendChild(infoToolsRule);

    // Right-side tools wrapper — keeps tools grouped and prevents viewModes overlap
    const toolsGroup = document.createElement('div');
    toolsGroup.className = 'editorial-ribbon-tools';

    // Annotation dropdown — matches matcap dropdown pattern
    const annotations = annotationSystem.getAnnotations();
    let markersVisible = true;
    let activeAnnoIndex = -1; // -1 = none selected

    let annoWrapper, annoBtn, annoDropdown, annoBadge;

    const goToAnno = (index) => {
        if (index < 0 || index >= annotations.length) return;
        const anno = annotations[index];
        activeAnnoIndex = index;

        if (!markersVisible) setMarkersVisible(true);

        annotationSystem.goToAnnotation(anno.id);
        setCurrentPopupId(showAnnotationPopup(anno, state.imageAssets));
        updateAnnoUI();
    };

    const deselectAnno = () => {
        hideAnnotationPopup();
        hideAnnotationLine();
        setCurrentPopupId(null);
        annotationSystem.selectedAnnotation = null;
        document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
        activeAnnoIndex = -1;
        updateAnnoUI();
    };

    const setMarkersVisible = (visible) => {
        markersVisible = visible;
        const container = document.getElementById('annotation-markers');
        if (container) container.style.display = markersVisible ? '' : 'none';
        if (annoBtn) annoBtn.classList.toggle('off', !markersVisible);
        if (annoDropdown) {
            const toggleItem = annoDropdown.querySelector('[data-anno-action="toggle"]');
            if (toggleItem) toggleItem.textContent = markersVisible ? 'Hide Markers' : 'Show Markers';
        }
    };

    const updateAnnoUI = () => {
        if (!annoBtn) return;
        annoBtn.classList.toggle('active', activeAnnoIndex >= 0);
        annoBtn.title = activeAnnoIndex >= 0
            ? 'Annotation ' + (activeAnnoIndex + 1) + ' / ' + annotations.length
            : 'Annotations';
        if (annoDropdown) {
            annoDropdown.querySelectorAll('.editorial-matcap-item[data-anno-idx]').forEach(el => {
                el.classList.toggle('active', parseInt(el.dataset.annoIdx) === activeAnnoIndex);
            });
        }
    };

    const createOrbitResetBtn = () => {
        const btn = document.createElement('button');
        btn.className = 'editorial-marker-toggle';
        btn.title = 'Reset rotation center';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
        ['circle', 'line', 'line', 'line', 'line'].forEach((tag, idx) => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
            if (idx === 0) { el.setAttribute('cx','12'); el.setAttribute('cy','12'); el.setAttribute('r','10'); }
            if (idx === 1) { el.setAttribute('x1','12'); el.setAttribute('y1','2'); el.setAttribute('x2','12'); el.setAttribute('y2','6'); }
            if (idx === 2) { el.setAttribute('x1','12'); el.setAttribute('y1','18'); el.setAttribute('x2','12'); el.setAttribute('y2','22'); }
            if (idx === 3) { el.setAttribute('x1','2'); el.setAttribute('y1','12'); el.setAttribute('x2','6'); el.setAttribute('y2','12'); }
            if (idx === 4) { el.setAttribute('x1','18'); el.setAttribute('y1','12'); el.setAttribute('x2','22'); el.setAttribute('y2','12'); }
            svg.appendChild(el);
        });
        btn.appendChild(svg);
        btn.addEventListener('click', () => { if (resetOrbitCenter) resetOrbitCenter(); });
        return btn;
    };

    if (annotations.length > 0) {
        annoWrapper = document.createElement('div');
        annoWrapper.className = 'editorial-anno-wrapper';

        annoBtn = document.createElement('button');
        annoBtn.className = 'editorial-marker-toggle';
        annoBtn.title = 'Annotations';
        annoBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

        annoBadge = document.createElement('span');
        annoBadge.className = 'editorial-anno-badge';
        annoBadge.textContent = String(annotations.length);

        annoDropdown = document.createElement('div');
        annoDropdown.className = 'editorial-matcap-dropdown';

        // Annotation items
        annotations.forEach((anno, i) => {
            const item = document.createElement('button');
            item.className = 'editorial-matcap-item';
            item.dataset.annoIdx = String(i);
            const numSpan = document.createElement('span');
            numSpan.className = 'editorial-anno-item-num';
            numSpan.textContent = String(i + 1).padStart(2, '0');
            item.appendChild(numSpan);
            item.appendChild(document.createTextNode(anno.title || 'Annotation ' + (i + 1)));
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeAnnoIndex === i) {
                    deselectAnno();
                } else {
                    goToAnno(i);
                }
                annoDropdown.classList.remove('open');
            });
            annoDropdown.appendChild(item);
        });

        // Divider + prev/next row
        const navDiv = document.createElement('div');
        navDiv.className = 'editorial-material-divider';
        annoDropdown.appendChild(navDiv);

        const navRow = document.createElement('div');
        navRow.className = 'editorial-anno-nav-row';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'editorial-anno-nav-btn';
        prevBtn.textContent = '\u2039 Prev';
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (annotations.length === 0) return;
            const next = activeAnnoIndex <= 0 ? annotations.length - 1 : activeAnnoIndex - 1;
            goToAnno(next);
        });
        const navSep = document.createElement('div');
        navSep.className = 'editorial-anno-nav-sep';
        const nextBtn = document.createElement('button');
        nextBtn.className = 'editorial-anno-nav-btn';
        nextBtn.textContent = 'Next \u203A';
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (annotations.length === 0) return;
            const next = activeAnnoIndex >= annotations.length - 1 ? 0 : activeAnnoIndex + 1;
            goToAnno(next);
        });
        navRow.appendChild(prevBtn);
        navRow.appendChild(navSep);
        navRow.appendChild(nextBtn);
        annoDropdown.appendChild(navRow);

        // Divider + hide/show toggle
        const toggleDiv = document.createElement('div');
        toggleDiv.className = 'editorial-material-divider';
        annoDropdown.appendChild(toggleDiv);

        const toggleItem = document.createElement('button');
        toggleItem.className = 'editorial-matcap-item editorial-matcap-off';
        toggleItem.dataset.annoAction = 'toggle';
        toggleItem.textContent = 'Hide Markers';
        toggleItem.addEventListener('click', (e) => {
            e.stopPropagation();
            setMarkersVisible(!markersVisible);
            if (!markersVisible) deselectAnno();
            annoDropdown.classList.remove('open');
        });
        annoDropdown.appendChild(toggleItem);

        // Open/close dropdown
        annoBtn.addEventListener('click', (e) => { e.stopPropagation(); annoDropdown.classList.toggle('open'); });
        document.addEventListener('click', () => { annoDropdown.classList.remove('open'); }, { signal: _signal });

        annoWrapper.appendChild(annoBtn);
        annoWrapper.appendChild(annoBadge);
        annoWrapper.appendChild(annoDropdown);
        updateAnnoUI();

        toolsGroup.appendChild(annoWrapper);

        // Separator after annotations
        const annoRule = document.createElement('div');
        annoRule.className = 'editorial-ribbon-rule';
        toolsGroup.appendChild(annoRule);

        // Reset orbit center — only useful when camera is fully unlocked
        if (!cameraLocked) toolsGroup.appendChild(createOrbitResetBtn());

        if (measureWrapper) toolsGroup.appendChild(measureWrapper);
        if (sliceWrapper) toolsGroup.appendChild(sliceWrapper);
    } else {
        // No annotations — still show orbit reset and measure
        if (!cameraLocked) toolsGroup.appendChild(createOrbitResetBtn());
        if (measureWrapper) toolsGroup.appendChild(measureWrapper);
        if (sliceWrapper) toolsGroup.appendChild(sliceWrapper);
    }

    // Flight log dropdown — inserted at setup() if data is already loaded,
    // or via onFlightPathLoaded() if flight paths load after layout init
    if (flightPathManager && flightPathManager.hasData) {
        buildFlightDropdown(flightPathManager, toolsGroup);
    }

    // Rule separator between annotation and visualization groups
    const vizRule = document.createElement('div');
    vizRule.className = 'editorial-ribbon-rule';
    toolsGroup.appendChild(vizRule);

    // Mesh visualization tools
    // Texture toggle
    const textureToggle = document.createElement('button');
    textureToggle.className = 'editorial-marker-toggle';
    textureToggle.title = 'Toggle textures';
    textureToggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
    let texturesVisible = true;
    let barTexBtn = null; // late-bound: set after mobile pill is created
    textureToggle.addEventListener('click', () => {
        texturesVisible = !texturesVisible;
        updateModelTextures(modelGroup, texturesVisible);
        textureToggle.classList.toggle('off', !texturesVisible);
        if (barTexBtn) barTexBtn.classList.toggle('off', !texturesVisible);
    });
    toolsGroup.appendChild(textureToggle);

    // Combined Material Views dropdown (wireframe, normals, PBR channels, matcap presets)
    const matcapPresets = ['clay', 'chrome', 'pearl', 'jade', 'copper', 'bronze'];
    const matcapLabels = ['Clay', 'Chrome', 'Pearl', 'Jade', 'Copper', 'Bronze'];
    let activeView = null; // null or: 'wireframe','normals','roughness','metalness','specularF0','matcap:clay', etc.

    let syncMobileView = null; // late-bound: set after mobile pill is created

    const materialWrapper = document.createElement('div');
    materialWrapper.className = 'editorial-matcap-wrapper';

    const materialBtn = document.createElement('button');
    materialBtn.className = 'editorial-marker-toggle';
    materialBtn.title = 'Material views';
    materialBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/></svg>';

    const materialDropdown = document.createElement('div');
    materialDropdown.className = 'editorial-matcap-dropdown';

    const viewLabels = {
        wireframe: 'Wireframe', normals: 'Normals',
        roughness: 'Roughness', metalness: 'Metalness'
    };

    const setMaterialView = (view) => {
        if (view === activeView) view = null;
        // Disable current
        if (activeView) {
            if (activeView === 'wireframe') updateModelWireframe(modelGroup, false);
            else if (activeView === 'normals') updateModelNormals(modelGroup, false);
            else if (activeView === 'roughness') updateModelRoughness(modelGroup, false);
            else if (activeView === 'metalness') updateModelMetalness(modelGroup, false);
            else if (activeView.startsWith('matcap:')) updateModelMatcap(modelGroup, false);
        }
        activeView = view;
        // Enable new
        if (activeView) {
            if (activeView === 'wireframe') updateModelWireframe(modelGroup, true);
            else if (activeView === 'normals') updateModelNormals(modelGroup, true);
            else if (activeView === 'roughness') updateModelRoughness(modelGroup, true);
            else if (activeView === 'metalness') updateModelMetalness(modelGroup, true);
            else if (activeView.startsWith('matcap:')) updateModelMatcap(modelGroup, true, activeView.split(':')[1]);
        }
        // Update button — highlight when a view is active, but never dim to .off
        materialBtn.classList.toggle('active', !!activeView);
        const label = activeView
            ? (viewLabels[activeView] || matcapLabels[matcapPresets.indexOf((activeView.split(':')[1]) || '')] || activeView)
            : null;
        materialBtn.title = label ? 'Material: ' + label : 'Material views';
        materialDropdown.querySelectorAll('.editorial-matcap-item').forEach(el => {
            el.classList.toggle('active', el.dataset.view === activeView);
        });
        materialDropdown.classList.remove('open');
        if (syncMobileView) syncMobileView(activeView);
    };

    const addMaterialItem = (label, viewKey) => {
        const item = document.createElement('button');
        item.className = 'editorial-matcap-item';
        item.dataset.view = viewKey;
        item.textContent = label;
        item.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView(viewKey); });
        materialDropdown.appendChild(item);
    };

    const addDivider = () => {
        const d = document.createElement('div');
        d.className = 'editorial-material-divider';
        materialDropdown.appendChild(d);
    };

    addMaterialItem('Wireframe', 'wireframe');
    addMaterialItem('Normals', 'normals');
    addMaterialItem('Roughness', 'roughness');
    addMaterialItem('Metalness', 'metalness');
    addDivider();
    matcapPresets.forEach((style, i) => addMaterialItem(matcapLabels[i], 'matcap:' + style));
    addDivider();
    const offItem = document.createElement('button');
    offItem.className = 'editorial-matcap-item editorial-matcap-off';
    offItem.textContent = 'Off';
    offItem.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView(null); });
    materialDropdown.appendChild(offItem);

    materialBtn.addEventListener('click', (e) => { e.stopPropagation(); materialDropdown.classList.toggle('open'); });
    document.addEventListener('click', () => { materialDropdown.classList.remove('open'); }, { signal: _signal });

    materialWrapper.appendChild(materialBtn);
    materialWrapper.appendChild(materialDropdown);
    toolsGroup.appendChild(materialWrapper);

    // --- Overflow menu for compact viewports ---
    // At full width: panel uses display:contents so tools render inline in toolsGroup.
    // At compact width (≤1023px via CSS): panel becomes a dropdown, overflow button visible.
    const overflowBtn = document.createElement('button');
    overflowBtn.className = 'editorial-marker-toggle editorial-overflow-btn';
    overflowBtn.title = 'More tools';
    overflowBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';

    const overflowPanel = document.createElement('div');
    overflowPanel.className = 'editorial-ribbon-overflow';

    // Move advanced/visualization tools into overflow panel (appendChild moves existing DOM nodes)
    if (sliceWrapper && sliceWrapper.parentNode === toolsGroup) overflowPanel.appendChild(sliceWrapper);
    if (measureWrapper && measureWrapper.parentNode === toolsGroup) overflowPanel.appendChild(measureWrapper);
    overflowPanel.appendChild(vizRule);
    overflowPanel.appendChild(textureToggle);
    overflowPanel.appendChild(materialWrapper);

    overflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        overflowPanel.classList.toggle('open');
    });
    document.addEventListener('click', () => overflowPanel.classList.remove('open'), { signal: _signal });
    overflowPanel.addEventListener('click', (e) => e.stopPropagation());

    toolsGroup.appendChild(overflowBtn);
    toolsGroup.appendChild(overflowPanel);

    // Fullscreen button — appended next to logo on far right
    let fsBtn = null;
    if (document.fullscreenEnabled) {
        fsBtn = document.createElement('button');
        fsBtn.className = 'editorial-marker-toggle editorial-fullscreen-btn';
        fsBtn.title = 'Toggle Fullscreen (F11)';
        fsBtn.innerHTML = `<svg class="icon-expand" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg><svg class="icon-compress" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="10" y1="14" x2="3" y2="21"></line><line x1="21" y1="3" x2="14" y2="10"></line></svg>`;
        fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });
        document.addEventListener('fullscreenchange', () => {
            const isFs = !!document.fullscreenElement;
            const expand = fsBtn.querySelector('.icon-expand');
            const compress = fsBtn.querySelector('.icon-compress');
            if (expand) expand.style.display = isFs ? 'none' : '';
            if (compress) compress.style.display = isFs ? '' : 'none';
        }, { signal: _signal });
    }

    ribbon.appendChild(toolsGroup);

    // Separator between tools and logo
    const toolsLogoRule = document.createElement('div');
    toolsLogoRule.className = 'editorial-ribbon-rule';
    ribbon.appendChild(toolsLogoRule);

    // Right group — logo + fullscreen, pushed far right
    const ribbonLogo = document.createElement('img');
    ribbonLogo.className = 'editorial-ribbon-logo';
    ribbonLogo.src = logoSrc;
    ribbonLogo.alt = '';
    ribbonLogo.draggable = false;
    ribbon.appendChild(ribbonLogo);
    if (fsBtn) {
        const logoFsRule = document.createElement('div');
        logoFsRule.className = 'editorial-ribbon-rule';
        ribbon.appendChild(logoFsRule);
        ribbon.appendChild(fsBtn);
    }
    viewerContainer.appendChild(ribbon);

    // --- 4b. Floating Capsule (replaces mobile nav at <700px) ---
    const mobilePill = document.createElement('div');
    mobilePill.className = 'editorial-mobile-pill';

    const createCapsuleBtn = (iconSvg, label, extraClass) => {
        const btn = document.createElement('button');
        btn.className = 'editorial-capsule-btn' + (extraClass ? ' ' + extraClass : '');
        btn.setAttribute('aria-label', label);
        btn.innerHTML = iconSvg + '<span>' + label + '</span>';
        return btn;
    };

    const createSep = () => {
        const sep = document.createElement('div');
        sep.className = 'editorial-capsule-sep';
        return sep;
    };

    // --- Tool buttons (texture + material views) — only when mesh is present ---
    const hasMeshContent = contentInfo && contentInfo.hasMesh;
    if (hasMeshContent) {
        // Texture toggle button
        barTexBtn = createCapsuleBtn(
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
            'Tex'
        );
        barTexBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            texturesVisible = !texturesVisible;
            updateModelTextures(modelGroup, texturesVisible);
            barTexBtn.classList.toggle('off', !texturesVisible);
            textureToggle.classList.toggle('off', !texturesVisible);
        });
        mobilePill.appendChild(barTexBtn);

        // Matcap button
        const capsuleMatBtn = createCapsuleBtn(
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
            'Mat'
        );
        // Normals button
        const capsuleNrmBtn = createCapsuleBtn(
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
            'Nrm'
        );
        // Wireframe button
        const capsuleWireBtn = createCapsuleBtn(
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l10 6v8l-10 6L2 16V8z"/></svg>',
            'Wire'
        );

        capsuleMatBtn.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView('matcap:clay'); });
        capsuleNrmBtn.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView('normals'); });
        capsuleWireBtn.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView('wireframe'); });

        syncMobileView = (view) => {
            capsuleMatBtn.classList.toggle('active', view === 'matcap:clay');
            capsuleNrmBtn.classList.toggle('active', view === 'normals');
            capsuleWireBtn.classList.toggle('active', view === 'wireframe');
        };

        mobilePill.appendChild(capsuleMatBtn);
        mobilePill.appendChild(capsuleNrmBtn);
        mobilePill.appendChild(capsuleWireBtn);
        mobilePill.appendChild(createSep());
    }

    // --- Info button (always shown) ---
    const capsuleInfoBtn = createCapsuleBtn(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        'Info'
    );
    capsuleInfoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const overlay = document.querySelector('.editorial-info-overlay');
        if (!overlay) return;
        const isOpen = overlay.classList.toggle('mobile-open');
        capsuleInfoBtn.classList.toggle('active', isOpen);
    });

    syncInfoOverlayState = (isOpen) => {
        capsuleInfoBtn.classList.toggle('active', isOpen);
    };

    mobilePill.appendChild(capsuleInfoBtn);

    // --- Annotation button + strip (only when annotations exist) ---
    let annoStrip = null;
    let annoStripTimeout = null;
    let capsuleAnnoIndex = 0;

    if (annotations.length > 0) {
        mobilePill.appendChild(createSep());

        const capsuleAnnoBtn = createCapsuleBtn(
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            'Anno'
        );
        capsuleAnnoBtn.style.position = 'relative';

        // Badge
        const annoBadge = document.createElement('span');
        annoBadge.className = 'editorial-capsule-badge';
        annoBadge.textContent = String(annotations.length);
        capsuleAnnoBtn.appendChild(annoBadge);

        // Annotation strip
        annoStrip = document.createElement('div');
        annoStrip.className = 'editorial-anno-strip';
        annoStrip.style.display = 'none';

        const stripPrev = document.createElement('button');
        stripPrev.className = 'editorial-anno-strip-btn';
        stripPrev.innerHTML = '&#9664;';

        const stripCounter = document.createElement('span');
        stripCounter.className = 'editorial-anno-strip-counter';

        const stripLabel = document.createElement('span');
        stripLabel.className = 'editorial-anno-strip-label';

        const stripNext = document.createElement('button');
        stripNext.className = 'editorial-anno-strip-btn';
        stripNext.innerHTML = '&#9654;';

        const updateStripUI = () => {
            const anno = annotations[capsuleAnnoIndex];
            stripCounter.textContent = (capsuleAnnoIndex + 1) + '/' + annotations.length;
            stripLabel.textContent = anno ? (anno.title || anno.label || '') : '';
        };

        const navigateAnno = (index) => {
            capsuleAnnoIndex = ((index % annotations.length) + annotations.length) % annotations.length;
            updateStripUI();
            const anno = annotations[capsuleAnnoIndex];
            if (anno && anno.id) {
                // Trigger annotation selection via the existing system
                const marker = document.querySelector('.annotation-marker[data-annotation-id="' + anno.id + '"]');
                if (marker) marker.click();
            }
            // Reset auto-hide timer
            clearTimeout(annoStripTimeout);
            annoStripTimeout = setTimeout(() => {
                if (annoStrip) {
                    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                        annoStrip.style.display = 'none';
                    } else {
                        annoStrip.classList.add('fade-out');
                        setTimeout(() => { if (annoStrip) annoStrip.style.display = 'none'; annoStrip.classList.remove('fade-out'); }, 200);
                    }
                }
            }, 5000);
        };

        stripPrev.addEventListener('click', (e) => { e.stopPropagation(); navigateAnno(capsuleAnnoIndex - 1); });
        stripNext.addEventListener('click', (e) => { e.stopPropagation(); navigateAnno(capsuleAnnoIndex + 1); });

        annoStrip.appendChild(stripPrev);
        annoStrip.appendChild(stripCounter);
        annoStrip.appendChild(stripLabel);
        annoStrip.appendChild(stripNext);

        capsuleAnnoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (annoStrip.style.display === 'none') {
                annoStrip.style.display = 'flex';
                annoStrip.classList.remove('fade-out');
                updateStripUI();
                navigateAnno(capsuleAnnoIndex);
            } else {
                clearTimeout(annoStripTimeout);
                if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                    annoStrip.style.display = 'none';
                } else {
                    annoStrip.classList.add('fade-out');
                    setTimeout(() => { annoStrip.style.display = 'none'; annoStrip.classList.remove('fade-out'); }, 200);
                }
            }
        });

        mobilePill.appendChild(capsuleAnnoBtn);
        viewerContainer.appendChild(annoStrip);
    }

    // --- More button (kebab ⋮) ---
    const moreWrapper = document.createElement('div');
    moreWrapper.style.cssText = 'position:relative;display:flex;';

    const capsuleMoreBtn = createCapsuleBtn(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="17" r="1"/></svg>',
        ''
    );
    capsuleMoreBtn.title = 'More';

    const morePopover = document.createElement('div');
    morePopover.className = 'editorial-capsule-popover';

    // Note: Share is listed in the spec's More menu but editorial layout.js has no
    // share dialog in its deps interface. Share can be added later when a share
    // module is wired into the editorial theme deps. For now, only Fullscreen + Quality.

    // Fullscreen item
    const fsItem = document.createElement('button');
    fsItem.className = 'editorial-capsule-popover-item';
    fsItem.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    fsItem.addEventListener('click', (e) => {
        e.stopPropagation();
        morePopover.classList.remove('open');
        if (document.fullscreenElement) {
            document.exitFullscreen();
            fsItem.textContent = 'Fullscreen';
        } else {
            document.documentElement.requestFullscreen();
            fsItem.textContent = 'Exit Fullscreen';
        }
    });
    morePopover.appendChild(fsItem);

    // Quality toggle item (uses deps.qualityResolved + deps.switchQualityTier — same pattern as ribbon)
    if (deps.switchQualityTier) {
        let currentTier = deps.qualityResolved || 'sd';
        const qualItem = document.createElement('button');
        qualItem.className = 'editorial-capsule-popover-item';
        qualItem.textContent = 'Quality: ' + currentTier.toUpperCase();
        qualItem.addEventListener('click', (e) => {
            e.stopPropagation();
            currentTier = currentTier === 'sd' ? 'hd' : 'sd';
            deps.switchQualityTier(currentTier);
            qualItem.textContent = 'Quality: ' + currentTier.toUpperCase();
        });
        morePopover.appendChild(qualItem);
    }

    capsuleMoreBtn.addEventListener('click', (e) => { e.stopPropagation(); morePopover.classList.toggle('open'); });
    document.addEventListener('click', () => morePopover.classList.remove('open'), { signal: _signal });

    moreWrapper.appendChild(capsuleMoreBtn);
    moreWrapper.appendChild(morePopover);
    mobilePill.appendChild(moreWrapper);

    fixedRoot.appendChild(mobilePill);

    // Keep legacy reference — walkthrough uses querySelector('.editorial-mobile-pill') not this var,
    // but other downstream code between here and section 5 may reference mobileNav.
    const mobileNav = mobilePill; // eslint-disable-line no-unused-vars

    // --- 5. Info Panel (side panel) ---
    const overlay = createInfoOverlay(manifest, deps);
    // On desktop, overlay is a flex child of viewerContainer (slides in from right).
    // On mobile, portal to body so position:fixed works correctly.
    if (isMobileTier) {
        fixedRoot.appendChild(overlay);
    } else {
        viewerContainer.appendChild(overlay);
    }

    // Populate the Flight Log sidebar section if data is already available at setup time
    if (flightPathManager && flightPathManager.hasData) {
        const flightPlaceholder = document.getElementById('editorial-flight-log-section');
        if (flightPlaceholder && !flightPlaceholder.hasChildNodes()) {
            const fStats = flightPathManager.getStats();
            if (fStats) {
                const { section: fSection, content: fContent } = createCollapsible('Flight Log', false);
                const fGrid = document.createElement('div');
                fGrid.className = 'editorial-flight-info-stats';
                [
                    ['Duration', fStats.duration],
                    ['Distance', fStats.distance],
                    ['Max Alt', fStats.maxAlt],
                    ['Max Speed', fStats.maxSpeed],
                    ['Avg Speed', fStats.avgSpeed],
                    ['Points', fStats.points],
                ].forEach(([label, value]) => {
                    const lbl = document.createElement('span');
                    lbl.className = 'editorial-flight-info-label';
                    lbl.textContent = label;
                    const val = document.createElement('span');
                    val.className = 'editorial-flight-info-value';
                    val.textContent = value;
                    fGrid.appendChild(lbl);
                    fGrid.appendChild(val);
                });
                fContent.appendChild(fGrid);
                flightPlaceholder.appendChild(fSection);
            }
        }
    }

    // --- Mobile info overlay: curated content for mobile tier ---
    // Build curated mobile content inside the existing overlay element.
    // On mobile, the .mobile-open class shows this content; on desktop, .open shows the full panel.
    const mobileInfoContent = document.createElement('div');
    mobileInfoContent.className = 'editorial-mobile-info-content';
    // Hidden by default via CSS (.editorial-mobile-info-content { display: none; })
    // Shown when parent has .mobile-open class — do NOT use inline style.display here
    // because inline styles defeat CSS !important rules.

    const mobileCloseBtn = document.createElement('button');
    mobileCloseBtn.className = 'editorial-mobile-info-close';
    mobileCloseBtn.setAttribute('aria-label', 'Close info overlay');
    mobileCloseBtn.innerHTML = '&times;';
    mobileCloseBtn.addEventListener('click', () => {
        overlay.classList.remove('mobile-open');
        if (syncInfoOverlayState) syncInfoOverlayState(false);
    });

    // Title
    const mobileTitleText = manifest?.title || manifest?.project?.title || 'Untitled';
    const mobileTitle = document.createElement('div');
    mobileTitle.className = 'editorial-mobile-info-title';
    mobileTitle.textContent = mobileTitleText;

    const mobileRule = document.createElement('div');
    mobileRule.className = 'editorial-mobile-info-rule';

    // Close button appended directly to overlay (not mobileInfoContent) so position:absolute
    // works correctly within the fixed-position overlay.
    mobileInfoContent.appendChild(mobileTitle);
    mobileInfoContent.appendChild(mobileRule);

    // Description
    const desc = manifest?.description || manifest?.project?.description || '';
    if (desc) {
        const mobileDesc = document.createElement('div');
        mobileDesc.className = 'editorial-mobile-info-desc';
        mobileDesc.textContent = desc.replace(/<[^>]+>/g, '').substring(0, 300);
        mobileInfoContent.appendChild(mobileDesc);

        const divider = document.createElement('div');
        divider.className = 'editorial-mobile-info-divider';
        mobileInfoContent.appendChild(divider);
    }

    // Detail rows: Creator, Date, Location
    const detailFields = [
        ['Creator', manifest?.creator || manifest?.project?.creator || ''],
        ['Date', manifest?.date || manifest?.project?.date || ''],
        ['Location', manifest?.coverage || manifest?.project?.coverage || '']
    ];
    detailFields.forEach(([label, value]) => {
        if (!value) return;
        const row = document.createElement('div');
        row.className = 'editorial-mobile-info-row';
        row.innerHTML = '<span class="editorial-mobile-info-label">' + escapeHtml(label) + '</span><span class="editorial-mobile-info-value">' + escapeHtml(String(value)) + '</span>';
        mobileInfoContent.appendChild(row);
    });

    // Stats grid
    const statsGrid = document.createElement('div');
    statsGrid.className = 'editorial-mobile-info-stats';
    const fmt = (n) => n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);

    if (modelGroup && modelGroup.children.length > 0) {
        let vertexCount = 0;
        modelGroup.traverse(child => {
            if (child.isMesh && child.geometry && child.geometry.attributes.position) {
                vertexCount += child.geometry.attributes.position.count;
            }
        });
        if (vertexCount > 0) {
            const vertStat = document.createElement('div');
            vertStat.className = 'editorial-mobile-info-stat';
            vertStat.innerHTML = '<div class="editorial-mobile-info-stat-num">' + fmt(vertexCount) + '</div><div class="editorial-mobile-info-stat-label">Vertices</div>';
            statsGrid.appendChild(vertStat);
        }
    }

    // Gaussian count from manifest
    const gaussianCount = manifest?.splat_count || manifest?.project?.splat_count || 0;
    if (gaussianCount > 0) {
        const gaussStat = document.createElement('div');
        gaussStat.className = 'editorial-mobile-info-stat';
        gaussStat.innerHTML = '<div class="editorial-mobile-info-stat-num">' + fmt(gaussianCount) + '</div><div class="editorial-mobile-info-stat-label">Gaussians</div>';
        statsGrid.appendChild(gaussStat);
    }

    if (statsGrid.children.length > 0) {
        mobileInfoContent.appendChild(statsGrid);
    }

    // Close button is a direct child of overlay (the scroll container) for absolute positioning
    overlay.appendChild(mobileCloseBtn);
    overlay.appendChild(mobileInfoContent);

    // Wire details link to panel
    detailsLink.addEventListener('click', () => {
        const isOpen = overlay.classList.toggle('open');
        detailsLink.classList.toggle('active', isOpen);
    });

    // Invalidate popup layout cache after panel open/close transition so annotation
    // popups respect the new canvas bounds
    overlay.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'margin-right') {
            window.dispatchEvent(new Event('resize'));
        }
    });

    // --- Image strip parallax on info panel scroll ---
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const panelContent = overlay.querySelector('.editorial-info-content');
    const stripImg = overlay.querySelector('.editorial-image-strip img');
    if (panelContent && stripImg && !prefersReducedMotion) {
        panelContent.addEventListener('scroll', () => {
            const offset = Math.max(panelContent.scrollTop * -0.08, -20);
            stripImg.style.transform = `translateY(${offset}px)`;
        }, { passive: true });
    }

    // --- Staggered annotation marker entrance ---
    if (!prefersReducedMotion) {
        setTimeout(() => {
            const markers = document.querySelectorAll('.annotation-marker');
            markers.forEach((marker, i) => {
                marker.style.animation = `editorialMarkerFadeIn 0.4s ease-out ${0.15 + i * 0.12}s both`;
            });
        }, 50);
    }

    // Close panel on ESC; 'm' toggle handled by exported onKeyboardShortcut()
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (overlay.classList.contains('open')) {
            overlay.classList.remove('open');
            detailsLink.classList.remove('active');
        }
        // Check dropdown open state — not isActive, since kiosk handler may have already set it false
        const measureDropdown = document.querySelector('.editorial-measure-dropdown');
        if (measureDropdown?.classList.contains('open')) {
            measureDropdown.classList.remove('open');
            const measureBtn = document.querySelector('.editorial-measure-btn');
            if (measureBtn) measureBtn.classList.remove('active');
            if (deps.measurementSystem) {
                deps.measurementSystem.setMeasureMode(false);
                deps.measurementSystem.clearAll();
            }
        }
    }, { signal: _signal });

    log.info('Editorial layout setup complete');
}

// ---- Loading screen customization ----

/**
 * Replace the default loading overlay content with editorial-styled DOM.
 * Preserves element IDs so showLoading/updateProgress/hideLoading still work.
 */
function initLoadingScreen(container, deps) {
    const logoSrc = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';

    container.innerHTML = `
        <div class="editorial-loading-spine"></div>
        <div class="editorial-loading-logo">
            <img src="${logoSrc}" alt="" draggable="false" />
        </div>
        <div class="editorial-loading-center">
            <div id="loading-brand" class="hidden">
                <img id="loading-thumbnail" alt="" />
                <div class="editorial-loading-meta">
                    <div class="editorial-loading-eyebrow">Loading</div>
                    <h2 id="loading-title"></h2>
                    <div class="editorial-loading-title-bar"></div>
                    <p id="loading-content-types"></p>
                </div>
            </div>
            <div class="loading-spinner"></div>
            <p id="loading-text">Loading...</p>
        </div>
        <div class="editorial-loading-bottom">
            <div id="loading-progress-container" class="hidden">
                <div id="loading-progress-bar"></div>
            </div>
            <p id="loading-progress-text" class="hidden">0%</p>
        </div>
    `;
}

// ---- Click gate customization ----

/**
 * Replace the default click gate content with editorial-styled DOM.
 * Preserves element IDs so showClickGate population still works.
 */
function initClickGate(container, deps) {
    const logoSrc = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';

    container.innerHTML = `
        <div class="editorial-gate-backdrop">
            <img id="kiosk-gate-poster" alt="" />
            <div class="editorial-gate-overlay"></div>
        </div>
        <div class="editorial-loading-spine"></div>
        <div class="editorial-loading-logo">
            <img src="${logoSrc}" alt="" draggable="false" />
        </div>
        <div class="editorial-gate-content">
            <button id="kiosk-gate-play" type="button" aria-label="Load 3D viewer">
                <svg viewBox="0 0 24 24" width="40" height="40">
                    <polygon points="6,3 20,12 6,21" />
                </svg>
            </button>
        </div>
        <div class="editorial-gate-info">
            <h2 id="kiosk-gate-title"></h2>
            <div class="editorial-loading-title-bar"></div>
            <p id="kiosk-gate-types"></p>
        </div>
    `;
}

// ---- File picker customization ----

/**
 * Replace the default file picker content with editorial-styled DOM.
 * Preserves element IDs so setupFilePicker() event wiring still works.
 */
function initFilePicker(container, deps) {
    const logoSrc = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';

    container.innerHTML = `
        <div class="editorial-loading-spine"></div>
        <div class="editorial-loading-logo">
            <img src="${logoSrc}" alt="" draggable="false" />
        </div>
        <div class="editorial-loading-center kiosk-picker-box" id="kiosk-drop-zone">
            <div class="editorial-loading-eyebrow">Open File</div>
            <h1 class="editorial-picker-title">Vitrine3D</h1>
            <div class="editorial-loading-title-bar"></div>
            <p class="kiosk-picker-formats">
                Models, splats, point clouds, and 3D archives
            </p>
            <button id="kiosk-picker-btn" type="button">Browse Files</button>
            <p class="kiosk-picker-prompt">or drag and drop here</p>
        </div>
        <div class="editorial-loading-bottom">
            <div class="editorial-picker-progress-shell"></div>
        </div>
        <input type="file" id="kiosk-picker-input" accept=".ddim,.a3z,.a3d,.zip,.glb,.gltf,.obj,.stl,.ply,.splat,.ksplat,.spz,.sog,.e57" multiple style="display:none">
    `;
}

// ---- Flight log dropdown builder (reusable from setup + onFlightPathLoaded) ----

function buildFlightDropdown(fpm, container) {
    // Guard: already inserted
    if (container.querySelector('.editorial-flight-wrapper')) return;

    const fpRule = document.createElement('div');
    fpRule.className = 'editorial-ribbon-rule';
    container.appendChild(fpRule);

    const fpWrapper = document.createElement('div');
    fpWrapper.className = 'editorial-flight-wrapper';

    const fpBtn = document.createElement('button');
    const fpIsVisible = fpm.group.visible;
    fpBtn.className = 'editorial-marker-toggle editorial-flight-btn' + (fpIsVisible ? ' active' : ' off');
    fpBtn.title = 'Flight Log';
    fpBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 2.8L21 6l-3.2 3.2"/><path d="M21 6H7.5a4.5 4.5 0 0 0 0 9H12"/><circle cx="17" cy="17" r="3"/><path d="M14 17h-4"/></svg>';

    const fpDropdown = document.createElement('div');
    fpDropdown.className = 'editorial-flight-dropdown';

    // --- Playback controls section ---
    const playSection = document.createElement('div');
    playSection.className = 'editorial-flight-playback';

    // Transport row: play/pause, stop, time
    const transport = document.createElement('div');
    transport.className = 'editorial-flight-transport';

    const playBtn = document.createElement('button');
    playBtn.className = 'editorial-flight-transport-btn play';
    playBtn.title = 'Play';
    playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';

    const stopBtn = document.createElement('button');
    stopBtn.className = 'editorial-flight-transport-btn';
    stopBtn.title = 'Stop';
    stopBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';

    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'editorial-flight-time';
    timeDisplay.textContent = '0:00 / 0:00';

    transport.appendChild(playBtn);
    transport.appendChild(stopBtn);
    transport.appendChild(timeDisplay);
    playSection.appendChild(transport);

    // Timeline scrubber
    const timeline = document.createElement('input');
    timeline.type = 'range';
    timeline.min = '0';
    timeline.max = '1000';
    timeline.value = '0';
    timeline.className = 'editorial-flight-timeline';
    playSection.appendChild(timeline);

    // Speed selector
    const speedRow = document.createElement('div');
    speedRow.className = 'editorial-flight-section';
    speedRow.style.paddingTop = '2px';

    const speedLabel = document.createElement('span');
    speedLabel.className = 'editorial-flight-section-label';
    speedLabel.textContent = 'Speed';
    speedRow.appendChild(speedLabel);

    const speedSeg = document.createElement('div');
    speedSeg.className = 'editorial-flight-seg';

    const speeds = [
        { value: 0.5, label: '½×' },
        { value: 1, label: '1×' },
        { value: 2, label: '2×' },
        { value: 4, label: '4×' },
    ];
    const speedBtns = [];
    speeds.forEach(({ value, label }) => {
        const btn = document.createElement('button');
        btn.className = 'editorial-flight-seg-btn';
        btn.textContent = label;
        btn.dataset.speed = String(value);
        if (value === 1) btn.classList.add('active');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            fpm.setPlaybackSpeed(value);
            speedBtns.forEach(b => b.classList.toggle('active', b.dataset.speed === String(value)));
        });
        speedBtns.push(btn);
        speedSeg.appendChild(btn);
    });
    speedRow.appendChild(speedSeg);
    playSection.appendChild(speedRow);

    // Camera mode selector
    const camRow = document.createElement('div');
    camRow.className = 'editorial-flight-section';
    camRow.style.paddingTop = '2px';

    const camLabel = document.createElement('span');
    camLabel.className = 'editorial-flight-section-label';
    camLabel.textContent = 'Camera';
    camRow.appendChild(camLabel);

    const camSeg = document.createElement('div');
    camSeg.className = 'editorial-flight-seg';

    const camModes = [
        { key: 'orbit', label: 'Orbit' },
        { key: 'chase', label: 'Chase' },
        { key: 'fpv', label: 'FPV' },
    ];
    const camBtns = [];
    camModes.forEach(({ key, label }) => {
        const btn = document.createElement('button');
        btn.className = 'editorial-flight-seg-btn';
        btn.textContent = label;
        btn.dataset.cam = key;
        if (fpm.cameraMode === key) btn.classList.add('active');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            fpm.setCameraMode(key);
        });
        camBtns.push(btn);
        camSeg.appendChild(btn);
    });
    camRow.appendChild(camSeg);
    playSection.appendChild(camRow);

    fpDropdown.appendChild(playSection);

    // --- Wire playback events ---
    function formatTime(ms) {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    let playing = false;
    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (playing) {
            fpm.pausePlayback();
            playing = false;
            playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
            playBtn.title = 'Play';
            playBtn.classList.remove('active');
        } else {
            fpm.startPlayback();
            playing = true;
            playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>';
            playBtn.title = 'Pause';
            playBtn.classList.add('active');
        }
    });

    stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fpm.stopPlayback();
        playing = false;
        playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        playBtn.title = 'Play';
        playBtn.classList.remove('active');
        timeline.value = '0';
        timeDisplay.textContent = '0:00 / 0:00';
    });

    let scrubbing = false;
    timeline.addEventListener('mousedown', () => { scrubbing = true; });
    timeline.addEventListener('touchstart', () => { scrubbing = true; });
    timeline.addEventListener('input', (e) => {
        e.stopPropagation();
        fpm.seekTo(parseInt(timeline.value, 10) / 1000);
    });
    timeline.addEventListener('mouseup', () => { scrubbing = false; });
    timeline.addEventListener('touchend', () => { scrubbing = false; });

    fpm.onPlaybackUpdate((currentMs, totalMs) => {
        if (!scrubbing) {
            timeline.value = String(Math.round((currentMs / totalMs) * 1000));
        }
        timeDisplay.textContent = `${formatTime(currentMs)} / ${formatTime(totalMs)}`;
    });

    fpm.onPlaybackEnd(() => {
        playing = false;
        playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        playBtn.title = 'Play';
        playBtn.classList.remove('active');
        timeline.value = '0';
    });

    fpm.onCameraModeChange((mode) => {
        camBtns.forEach(b => b.classList.toggle('active', b.dataset.cam === mode));
    });

    // --- Divider before visualization controls ---
    const div2 = document.createElement('div');
    div2.className = 'editorial-flight-divider';
    fpDropdown.appendChild(div2);

    // --- Color mode selector ---
    const colorSection = document.createElement('div');
    colorSection.className = 'editorial-flight-section';

    const colorLabel = document.createElement('span');
    colorLabel.className = 'editorial-flight-section-label';
    colorLabel.textContent = 'Color';
    colorSection.appendChild(colorLabel);

    const colorSeg = document.createElement('div');
    colorSeg.className = 'editorial-flight-seg';

    const currentSettings = fpm.getSettings();
    const colorModes = [
        { key: 'speed', label: 'Spd' },
        { key: 'altitude', label: 'Alt' },
        { key: 'climbrate', label: 'Climb' },
    ];
    const colorBtns = [];
    colorModes.forEach(({ key, label }) => {
        const btn = document.createElement('button');
        btn.className = 'editorial-flight-seg-btn';
        btn.textContent = label;
        btn.dataset.colorMode = key;
        if (currentSettings.colorMode === key) btn.classList.add('active');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            fpm.setColorMode(key);
            colorBtns.forEach(b => b.classList.toggle('active', b.dataset.colorMode === key));
        });
        colorBtns.push(btn);
        colorSeg.appendChild(btn);
    });
    colorSection.appendChild(colorSeg);
    fpDropdown.appendChild(colorSection);

    // --- Bottom action: Hide / Show ---
    const actions = document.createElement('div');
    actions.className = 'editorial-flight-actions';

    let fpVisible = fpm.group.visible;
    const hideBtn = document.createElement('button');
    hideBtn.className = 'editorial-flight-action';
    hideBtn.textContent = fpVisible ? 'Hide Path' : 'Show Path';
    hideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fpVisible = !fpVisible;
        fpm.setVisible(fpVisible);
        fpBtn.classList.toggle('active', fpVisible);
        fpBtn.classList.toggle('off', !fpVisible);
        hideBtn.textContent = fpVisible ? 'Hide Path' : 'Show Path';
        fpDropdown.classList.remove('open');
    });
    actions.appendChild(hideBtn);
    fpDropdown.appendChild(actions);

    // Open/close dropdown
    fpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fpDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => { fpDropdown.classList.remove('open'); }, { signal: _signal });
    fpDropdown.addEventListener('click', (e) => { e.stopPropagation(); });

    fpWrapper.appendChild(fpBtn);
    fpWrapper.appendChild(fpDropdown);
    container.appendChild(fpWrapper);
}

// ---- Late-bind hook: flight path loaded after layout setup ----

function onFlightPathLoaded(fpm) {
    if (!fpm || !fpm.hasData) return;
    // Find the tools group in the already-rendered ribbon
    const toolsGroup = document.querySelector('.editorial-ribbon-tools');
    if (!toolsGroup) return;
    buildFlightDropdown(fpm, toolsGroup);

    // Populate the Flight Log section in the info sidebar
    const placeholder = document.getElementById('editorial-flight-log-section');
    if (placeholder && !placeholder.hasChildNodes()) {
        const stats = fpm.getStats();
        if (stats) {
            const { section, content } = createCollapsible('Flight Log', false);

            const statsGrid = document.createElement('div');
            statsGrid.className = 'editorial-flight-info-stats';
            [
                ['Duration', stats.duration],
                ['Distance', stats.distance],
                ['Max Alt', stats.maxAlt],
                ['Max Speed', stats.maxSpeed],
                ['Avg Speed', stats.avgSpeed],
                ['Points', stats.points],
            ].forEach(([label, value]) => {
                const lbl = document.createElement('span');
                lbl.className = 'editorial-flight-info-label';
                lbl.textContent = label;
                const val = document.createElement('span');
                val.className = 'editorial-flight-info-value';
                val.textContent = value;
                statsGrid.appendChild(lbl);
                statsGrid.appendChild(val);
            });
            content.appendChild(statsGrid);

            placeholder.appendChild(section);
        }
    }
}

// ---- Layout module hooks (called by kiosk-main.ts) ----

function onAnnotationSelect(annotationId) {
    // Update annotation dropdown when a 3D marker is clicked
    const wrapper = document.querySelector('.editorial-anno-wrapper');
    if (!wrapper) return;
    const items = wrapper.querySelectorAll('.editorial-matcap-item[data-anno-idx]');
    const btn = wrapper.querySelector('.editorial-marker-toggle');
    let foundIndex = -1;
    const annos = document.querySelectorAll('.annotation-marker');
    annos.forEach((marker, i) => {
        if (marker.dataset.annotationId === annotationId) foundIndex = i;
    });
    if (foundIndex >= 0) {
        if (btn) btn.classList.add('active');
        items.forEach((el, i) => el.classList.toggle('active', i === foundIndex));
    }
}

function onAnnotationDeselect() {
    const wrapper = document.querySelector('.editorial-anno-wrapper');
    if (!wrapper) return;
    const btn = wrapper.querySelector('.editorial-marker-toggle');
    const items = wrapper.querySelectorAll('.editorial-matcap-item[data-anno-idx]');
    if (btn) btn.classList.remove('active');
    items.forEach(el => el.classList.remove('active'));
}

function onViewModeChange(mode) {
    document.querySelectorAll('.editorial-view-mode-link').forEach(link => {
        link.classList.toggle('active', link.dataset.mode === mode);
    });
}

function onKeyboardShortcut(key) {
    if (key === 'm') {
        const panel = document.querySelector('.editorial-info-overlay');
        const btn = document.querySelector('.editorial-details-link');
        if (panel) {
            // Toggle both desktop and mobile open states
            const isMobileOpen = panel.classList.contains('mobile-open');
            const isDesktopOpen = panel.classList.contains('open');
            if (isMobileOpen) {
                panel.classList.remove('mobile-open');
                if (syncInfoOverlayState) syncInfoOverlayState(false);
            } else if (isDesktopOpen) {
                panel.classList.remove('open');
                if (btn) btn.classList.remove('active');
            } else {
                // Open — detect if mobile tier
                const isMobile = window.matchMedia('(max-width: 699px)').matches;
                if (isMobile) {
                    panel.classList.add('mobile-open');
                    if (syncInfoOverlayState) syncInfoOverlayState(true);
                } else {
                    panel.classList.add('open');
                    if (btn) btn.classList.add('active');
                }
            }
        }
        return true;
    }
    if (key === 'escape') {
        const panel = document.querySelector('.editorial-info-overlay');
        if (panel && panel.classList.contains('mobile-open')) {
            panel.classList.remove('mobile-open');
            if (syncInfoOverlayState) syncInfoOverlayState(false);
            return true;
        }
        if (panel && panel.classList.contains('open')) {
            panel.classList.remove('open');
            const btn = document.querySelector('.editorial-details-link');
            if (btn) btn.classList.remove('active');
            return true;
        }
    }
    return false;
}

// ---- Walkthrough hooks ----

let syncInfoOverlayState = null; // late-bound: assigned inside setup() capsule creation, called from module-level createInfoOverlay()
let _editorialAbort = null; // AbortController for document-level listeners
let _flightPathManager = null; // stored ref for cleanup

let wtStopDots = null;
let wtTitleEl = null;
let wtMobileControls = null;
let wtTotalStops = 0;

function onWalkthroughStart(walkthrough) {
    wtTotalStops = walkthrough.stops.length;

    // Create walkthrough progress dots in the ribbon
    const ribbon = document.querySelector('.editorial-bottom-ribbon');
    if (ribbon) {
        // Hide annotation capsule during walkthrough
        const annoWrapper = ribbon.querySelector('.editorial-anno-wrapper');
        if (annoWrapper) annoWrapper.style.display = 'none';

        // Create walkthrough stop dots
        wtStopDots = document.createElement('div');
        wtStopDots.className = 'editorial-wt-sequence';

        walkthrough.stops.forEach((stop, i) => {
            if (i > 0) {
                const dash = document.createElement('span');
                dash.className = 'editorial-anno-seq-dash';
                wtStopDots.appendChild(dash);
            }
            const dot = document.createElement('span');
            dot.className = 'editorial-wt-seq-dot';
            dot.dataset.stopIndex = String(i);
            dot.textContent = String(i + 1).padStart(2, '0');
            wtStopDots.appendChild(dot);
        });

        // Insert before the first ribbon-rule after tools group, or append to tools group
        const toolsGroup = ribbon.querySelector('.editorial-ribbon-tools');
        if (toolsGroup) {
            toolsGroup.prepend(wtStopDots);
        }
    }

    // Create stop title subtitle in the title block
    const titleBlock = document.querySelector('.editorial-title-block');
    if (titleBlock) {
        wtTitleEl = document.createElement('span');
        wtTitleEl.className = 'editorial-wt-stop-title';
        titleBlock.appendChild(wtTitleEl);
        titleBlock.style.opacity = '1';
        titleBlock.style.pointerEvents = 'auto';
    }

    // --- Mobile pill: swap content with walkthrough controls ---
    const mobileNav = document.querySelector('.editorial-mobile-pill');
    if (mobileNav) {
        // Hide pill children
        Array.from(mobileNav.children).forEach(child => {
            child.style.display = 'none';
        });

        // Create walkthrough controls container
        wtMobileControls = document.createElement('div');
        wtMobileControls.className = 'editorial-mobile-wt-controls';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'editorial-mobile-wt-btn';
        prevBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
        prevBtn.addEventListener('click', () => {
            document.querySelector('.wt-prev-btn')?.dispatchEvent(new MouseEvent('click'));
        });

        const counter = document.createElement('span');
        counter.className = 'editorial-mobile-wt-counter';
        counter.textContent = `1 / ${wtTotalStops}`;

        const nextBtn = document.createElement('button');
        nextBtn.className = 'editorial-mobile-wt-btn';
        nextBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
        nextBtn.addEventListener('click', () => {
            document.querySelector('.wt-next-btn')?.dispatchEvent(new MouseEvent('click'));
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'editorial-mobile-wt-btn editorial-mobile-wt-close';
        closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.addEventListener('click', () => {
            document.querySelector('.wt-close-btn')?.dispatchEvent(new MouseEvent('click'));
        });

        wtMobileControls.appendChild(prevBtn);
        wtMobileControls.appendChild(counter);
        wtMobileControls.appendChild(nextBtn);
        wtMobileControls.appendChild(closeBtn);
        mobileNav.appendChild(wtMobileControls);
    }
}

function onWalkthroughStopChange(stopIndex, stop) {
    // Update progress dots (ribbon)
    if (wtStopDots) {
        wtStopDots.querySelectorAll('.editorial-wt-seq-dot').forEach(d => d.classList.remove('active'));
        // Mark current and all previous as visited
        wtStopDots.querySelectorAll('.editorial-wt-seq-dot').forEach(d => {
            const idx = parseInt(d.dataset.stopIndex, 10);
            if (idx < stopIndex) d.classList.add('visited');
            if (idx === stopIndex) d.classList.add('active');
        });
    }

    // Update stop title
    if (wtTitleEl) {
        wtTitleEl.textContent = stop.title || '';
    }

    // Update mobile counter
    if (wtMobileControls) {
        const counter = wtMobileControls.querySelector('.editorial-mobile-wt-counter');
        if (counter) counter.textContent = `${stopIndex + 1} / ${wtTotalStops}`;
    }
}

function onWalkthroughEnd() {
    // Remove walkthrough UI (ribbon)
    if (wtStopDots) {
        wtStopDots.remove();
        wtStopDots = null;
    }

    if (wtTitleEl) {
        wtTitleEl.remove();
        wtTitleEl = null;
    }

    // Re-show annotation dropdown
    const annoWrapper = document.querySelector('.editorial-anno-wrapper');
    if (annoWrapper) annoWrapper.style.display = '';

    // Let title block resume auto-fade
    const titleBlock = document.querySelector('.editorial-title-block');
    if (titleBlock) {
        titleBlock.style.opacity = '';
        titleBlock.style.pointerEvents = '';
    }

    // Restore mobile pill children
    if (wtMobileControls) {
        wtMobileControls.remove();
        wtMobileControls = null;
    }
    const mobilePillEl = document.querySelector('.editorial-mobile-pill');
    if (mobilePillEl) {
        Array.from(mobilePillEl.children).forEach(child => {
            child.style.display = '';
        });
    }

    wtTotalStops = 0;
}

// ---- Self-register for offline kiosk discovery ----
if (!window.__KIOSK_LAYOUTS__) window.__KIOSK_LAYOUTS__ = {};
window.__KIOSK_LAYOUTS__['editorial'] = {
    setup, cleanup, initLoadingScreen, initClickGate, initFilePicker,
    onAnnotationSelect, onAnnotationDeselect, onViewModeChange, onKeyboardShortcut,
    onWalkthroughStart, onWalkthroughStopChange, onWalkthroughEnd,
    onFlightPathLoaded,
    hasOwnInfoPanel: true,
    hasOwnQualityToggle: true
};
