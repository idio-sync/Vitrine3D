// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { validateSIP, toManifestCompliance } from '../sip-validator.js';
import type { CollectedMetadata, ValidationRule } from '../metadata-manager.js';

/** Build a minimal CollectedMetadata with all fields empty, then override as needed. */
function makeMetadata(overrides: Partial<{
    title: string;
    description: string;
    tags: string[];
    license: string;
    captureDate: string;
    captureDevice: string;
    operator: string;
    operatorOrcid: string;
    location: string;
    deviceSerial: string;
    processingNotes: string;
    conventions: string;
    qualityTier: string;
    accuracyGrade: string;
    resValue: number | null;
    scaleVerification: string;
    splatCreatedBy: string;
    meshCreatedBy: string;
    pointcloudCreatedBy: string;
    archivalTitle: string;
    archivalCreator: string;
    archivalDateCreated: string;
    archivalMedium: string;
    archivalProvenance: string;
    archivalCopyright: string;
    coverageLocation: string;
    coverageLat: number | null;
    coverageLon: number | null;
    archivalCondition: string;
    archivalCredit: string;
    archivalContextDesc: string;
    materialWorkflow: string;
    materialColorspace: string;
    presRenderReq: string;
}> = {}): CollectedMetadata {
    return {
        project: {
            title: overrides.title ?? '',
            id: '',
            description: overrides.description ?? '',
            license: overrides.license ?? '',
            tags: overrides.tags ?? [],
        },
        relationships: {
            partOf: '',
            derivedFrom: '',
            replaces: '',
            relatedObjects: [],
        },
        provenance: {
            captureDate: overrides.captureDate ?? '',
            captureDevice: overrides.captureDevice ?? '',
            deviceSerial: overrides.deviceSerial ?? '',
            operator: overrides.operator ?? '',
            operatorOrcid: overrides.operatorOrcid ?? '',
            location: overrides.location ?? '',
            conventions: overrides.conventions ?? '',
            processingSoftware: [],
            processingNotes: overrides.processingNotes ?? '',
        },
        qualityMetrics: {
            tier: overrides.qualityTier ?? '',
            accuracyGrade: overrides.accuracyGrade ?? '',
            captureResolution: {
                value: overrides.resValue ?? null,
                unit: 'mm',
                type: 'GSD',
            },
            alignmentError: {
                value: null,
                unit: 'mm',
                method: 'RMSE',
            },
            scaleVerification: overrides.scaleVerification ?? '',
            dataQuality: {
                coverageGaps: '',
                reconstructionAreas: '',
                colorCalibration: '',
                measurementUncertainty: '',
            },
        },
        archivalRecord: {
            standard: '',
            title: overrides.archivalTitle ?? '',
            alternateTitles: [],
            ids: { accessionNumber: '', sirisId: '', uri: '' },
            creation: {
                creator: overrides.archivalCreator ?? '',
                dateCreated: overrides.archivalDateCreated ?? '',
                period: '',
                culture: '',
            },
            physicalDescription: {
                medium: overrides.archivalMedium ?? '',
                dimensions: { height: '', width: '', depth: '' },
                condition: overrides.archivalCondition ?? '',
            },
            provenance: overrides.archivalProvenance ?? '',
            rights: {
                copyrightStatus: overrides.archivalCopyright ?? '',
                creditLine: overrides.archivalCredit ?? '',
            },
            context: {
                description: overrides.archivalContextDesc ?? '',
                locationHistory: '',
            },
            coverage: {
                spatial: {
                    locationName: overrides.coverageLocation ?? '',
                    coordinates: [overrides.coverageLat ?? null, overrides.coverageLon ?? null],
                },
                temporal: {
                    subjectPeriod: '',
                    subjectDateCirca: false,
                },
            },
        },
        materialStandard: {
            workflow: overrides.materialWorkflow ?? '',
            occlusionPacked: false,
            colorSpace: overrides.materialColorspace ?? '',
            normalSpace: '',
        },
        preservation: {
            formatRegistry: {},
            significantProperties: [],
            renderingRequirements: overrides.presRenderReq ?? '',
            renderingNotes: '',
        },
        splatMetadata: {
            createdBy: overrides.splatCreatedBy ?? '',
            version: '',
            sourceNotes: '',
            role: '',
        },
        meshMetadata: {
            createdBy: overrides.meshCreatedBy ?? '',
            version: '',
            sourceNotes: '',
            role: '',
        },
        pointcloudMetadata: {
            createdBy: overrides.pointcloudCreatedBy ?? '',
            version: '',
            sourceNotes: '',
            role: '',
        },
        customFields: {},
        versionHistory: [],
        includeIntegrity: false,
        viewerSettings: {
            singleSided: false,
            backgroundColor: null,
            displayMode: 'combined',
            cameraPosition: null,
            cameraTarget: null,
            autoRotate: false,
            annotationsVisible: true,
        },
    };
}

/** Format rules matching the 4 rules from metadata-manager.ts */
const FORMAT_RULES: Record<string, ValidationRule> = {
    'meta-operator-orcid': {
        pattern: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/,
        message: 'ORCID must be in format 0000-0000-0000-000X',
        emptyOk: true,
    },
    'meta-coverage-lat': {
        validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= -90 && n <= 90; },
        message: 'Latitude must be between -90 and 90',
        emptyOk: true,
    },
    'meta-coverage-lon': {
        validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= -180 && n <= 180; },
        message: 'Longitude must be between -180 and 180',
        emptyOk: true,
    },
    'meta-capture-date': {
        validate: (v) => !isNaN(new Date(v).getTime()),
        message: 'Invalid date format',
        emptyOk: true,
    },
};

describe('validateSIP', () => {
    it('returns pass with 0 errors/warnings when all required basic fields are filled', () => {
        const metadata = makeMetadata({
            title: 'Test Project',
            operator: 'Jane Doe',
            captureDate: '2025-01-15',
            // Fill remaining basic-tier fields (recommended)
            description: 'A test',
            tags: ['scan'],
            license: 'CC0',
            captureDevice: 'Scanner X',
            location: 'Lab A',
        });
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        expect(result.status).toBe('pass');
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
        expect(result.score).toBe(100);
    });

    it('returns error finding when a required field is missing', () => {
        // Title is required at basic, leave it empty
        const metadata = makeMetadata({
            operator: 'Jane Doe',
            captureDate: '2025-01-15',
            description: 'A test',
            tags: ['scan'],
            license: 'CC0',
            captureDevice: 'Scanner X',
            location: 'Lab A',
        });
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        expect(result.errors.length).toBeGreaterThan(0);
        const titleError = result.errors.find(e => e.fieldId === 'meta-title');
        expect(titleError).toBeDefined();
        expect(titleError!.severity).toBe('error');
        expect(titleError!.category).toBe('presence');
        expect(titleError!.message).toBe('Required field is empty');
        expect(titleError!.label).toBe('Title');
    });

    it('returns warning finding for missing recommended field (not error)', () => {
        // Fill all required basic fields, leave location (recommended) empty
        const metadata = makeMetadata({
            title: 'Test',
            operator: 'Jane',
            captureDate: '2025-01-15',
            description: 'Desc',
            tags: ['tag'],
            license: 'CC0',
            captureDevice: 'Scanner',
            // location left empty — recommended, not required
        });
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        const locationWarning = result.warnings.find(w => w.fieldId === 'meta-location');
        expect(locationWarning).toBeDefined();
        expect(locationWarning!.severity).toBe('warning');
        expect(locationWarning!.category).toBe('presence');
        // Ensure it is NOT in errors
        expect(result.errors.find(e => e.fieldId === 'meta-location')).toBeUndefined();
    });

    it('returns format error for invalid ORCID', () => {
        const metadata = makeMetadata({
            title: 'Test',
            operator: 'Jane',
            captureDate: '2025-01-15',
            description: 'Desc',
            tags: ['tag'],
            license: 'CC0',
            captureDevice: 'Scanner',
            location: 'Lab',
            // standard fields needed since ORCID is standard-tier
            deviceSerial: 'SN123',
            operatorOrcid: '1234-INVALID',
            processingNotes: 'notes',
            conventions: 'conv',
            qualityTier: 'survey',
            accuracyGrade: 'A',
            resValue: 0.5,
            scaleVerification: 'verified',
            splatCreatedBy: 'tool',
            meshCreatedBy: 'tool',
            pointcloudCreatedBy: 'tool',
        });
        const result = validateSIP(metadata, 'standard', FORMAT_RULES);
        const orcidError = result.errors.find(e => e.fieldId === 'meta-operator-orcid');
        expect(orcidError).toBeDefined();
        expect(orcidError!.category).toBe('format');
        expect(orcidError!.message).toBe('ORCID must be in format 0000-0000-0000-000X');
    });

    it('returns format error for invalid date', () => {
        const metadata = makeMetadata({
            title: 'Test',
            operator: 'Jane',
            captureDate: 'not-a-date',
        });
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        const dateError = result.errors.find(e => e.fieldId === 'meta-capture-date');
        expect(dateError).toBeDefined();
        expect(dateError!.category).toBe('format');
        expect(dateError!.message).toBe('Invalid date format');
    });

    it('validates latitude range correctly', () => {
        // Valid lat
        const valid = makeMetadata({
            title: 'T', operator: 'O', captureDate: '2025-01-01',
            description: 'D', captureDevice: 'C', qualityTier: 'survey',
            archivalTitle: 'AT', archivalCopyright: 'PD', presRenderReq: 'WebGL',
            coverageLat: 45.5,
        });
        const validResult = validateSIP(valid, 'archival', FORMAT_RULES);
        const latError = validResult.errors.find(e => e.fieldId === 'meta-coverage-lat');
        expect(latError).toBeUndefined();

        // Invalid lat (out of range)
        const invalid = makeMetadata({
            title: 'T', operator: 'O', captureDate: '2025-01-01',
            description: 'D', captureDevice: 'C', qualityTier: 'survey',
            archivalTitle: 'AT', archivalCopyright: 'PD', presRenderReq: 'WebGL',
            coverageLat: 95,
        });
        const invalidResult = validateSIP(invalid, 'archival', FORMAT_RULES);
        const latErr = invalidResult.errors.find(e => e.fieldId === 'meta-coverage-lat');
        expect(latErr).toBeDefined();
        expect(latErr!.message).toBe('Latitude must be between -90 and 90');
    });

    it('validates longitude range correctly', () => {
        const invalid = makeMetadata({
            title: 'T', operator: 'O', captureDate: '2025-01-01',
            description: 'D', captureDevice: 'C', qualityTier: 'survey',
            archivalTitle: 'AT', archivalCopyright: 'PD', presRenderReq: 'WebGL',
            coverageLon: -200,
        });
        const result = validateSIP(invalid, 'archival', FORMAT_RULES);
        const lonErr = result.errors.find(e => e.fieldId === 'meta-coverage-lon');
        expect(lonErr).toBeDefined();
        expect(lonErr!.message).toBe('Longitude must be between -180 and 180');
    });

    it('computes correct score with all fields filled', () => {
        const metadata = makeMetadata({
            title: 'T', description: 'D', tags: ['t'], license: 'CC0',
            captureDate: '2025-01-01', captureDevice: 'Dev', operator: 'Op', location: 'Loc',
        });
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        expect(result.score).toBe(100);
        expect(result.passCount).toBe(result.totalChecked);
    });

    it('computes correct percentage for partial fill', () => {
        // Basic has 8 fields: title, description, tags, license, captureDate, captureDevice, operator, location
        // Fill only 4 required fields
        const metadata = makeMetadata({
            title: 'T',
            operator: 'Op',
            captureDate: '2025-01-01',
        });
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        // 3 pass out of 8 total = 37.5% → 38%
        expect(result.totalChecked).toBe(8);
        expect(result.passCount).toBe(3);
        expect(result.score).toBe(38);
    });

    it('checks fewer fields for basic than archival', () => {
        const metadata = makeMetadata({});
        const basicResult = validateSIP(metadata, 'basic', FORMAT_RULES);
        const archivalResult = validateSIP(metadata, 'archival', FORMAT_RULES);
        expect(basicResult.totalChecked).toBeLessThan(archivalResult.totalChecked);
    });

    it('treats "Not specified" as empty', () => {
        const metadata = makeMetadata({
            title: 'Not specified',
            operator: 'Jane',
            captureDate: '2025-01-01',
        });
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        const titleError = result.errors.find(e => e.fieldId === 'meta-title');
        expect(titleError).toBeDefined();
        expect(titleError!.message).toBe('Required field is empty');
    });
});

describe('toManifestCompliance', () => {
    it('serializes result correctly', () => {
        const result = validateSIP(
            makeMetadata({ title: 'T', operator: 'O', captureDate: '2025-01-01' }),
            'basic',
            FORMAT_RULES
        );
        const compliance = toManifestCompliance(result, false);

        expect(compliance.profile).toBe('basic');
        expect(compliance.score).toBe(result.score);
        expect(compliance.overridden).toBe(false);
        expect(compliance.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(Array.isArray(compliance.errors)).toBe(true);
        expect(Array.isArray(compliance.warnings)).toBe(true);
    });

    it('sets overridden flag and override status', () => {
        const metadata = makeMetadata({}); // all empty — will have errors
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        const compliance = toManifestCompliance(result, true);

        expect(compliance.overridden).toBe(true);
        expect(compliance.status).toBe('override');
    });

    it('formats error strings as "Label: message"', () => {
        const metadata = makeMetadata({
            operator: 'O',
            captureDate: '2025-01-01',
            // title missing — required error
        });
        const result = validateSIP(metadata, 'basic', FORMAT_RULES);
        const compliance = toManifestCompliance(result, false);

        const titleErrorStr = compliance.errors.find(s => s.startsWith('Title:'));
        expect(titleErrorStr).toBeDefined();
        expect(titleErrorStr).toBe('Title: Required field is empty');
    });
});
