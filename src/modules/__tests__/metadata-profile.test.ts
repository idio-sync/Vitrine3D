/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    isTierVisible,
    getFieldsForProfile,
    computeCompleteness,
    PROFILE_ORDER,
    COMPLETENESS_FIELDS,
    CRITICAL_FIELDS,
    TAB_TIERS,
    KIOSK_SECTION_TIERS,
    EDITORIAL_SECTION_TIERS,
    PRONOM_REGISTRY,
    type MetadataProfile,
} from '../metadata-profile.js';

// =============================================================================
// isTierVisible
// =============================================================================

describe('isTierVisible', () => {
    it('basic fields visible at all tiers', () => {
        expect(isTierVisible('basic', 'basic')).toBe(true);
        expect(isTierVisible('basic', 'standard')).toBe(true);
        expect(isTierVisible('basic', 'archival')).toBe(true);
    });

    it('standard fields hidden at basic, visible at standard+', () => {
        expect(isTierVisible('standard', 'basic')).toBe(false);
        expect(isTierVisible('standard', 'standard')).toBe(true);
        expect(isTierVisible('standard', 'archival')).toBe(true);
    });

    it('archival fields only visible at archival', () => {
        expect(isTierVisible('archival', 'basic')).toBe(false);
        expect(isTierVisible('archival', 'standard')).toBe(false);
        expect(isTierVisible('archival', 'archival')).toBe(true);
    });
});

// =============================================================================
// getFieldsForProfile
// =============================================================================

describe('getFieldsForProfile', () => {
    const allFieldIds = Object.keys(COMPLETENESS_FIELDS);
    const basicFields = allFieldIds.filter(id => COMPLETENESS_FIELDS[id] === 'basic');
    const standardFields = allFieldIds.filter(id => COMPLETENESS_FIELDS[id] === 'standard');

    it('basic profile returns only basic-tier fields', () => {
        const result = getFieldsForProfile('basic');
        expect(result).toEqual(basicFields);
        expect(result.length).toBeGreaterThan(0);
    });

    it('standard profile returns basic + standard fields', () => {
        const result = getFieldsForProfile('standard');
        expect(result).toEqual([...basicFields, ...standardFields]);
        expect(result.length).toBeGreaterThan(basicFields.length);
    });

    it('archival profile returns all fields', () => {
        const result = getFieldsForProfile('archival');
        expect(result).toEqual(allFieldIds);
        expect(result.length).toBe(allFieldIds.length);
    });

    it('each profile is a superset of the previous', () => {
        const basic = getFieldsForProfile('basic');
        const standard = getFieldsForProfile('standard');
        const archival = getFieldsForProfile('archival');
        expect(standard.length).toBeGreaterThan(basic.length);
        expect(archival.length).toBeGreaterThan(standard.length);
        for (const id of basic) expect(standard).toContain(id);
        for (const id of standard) expect(archival).toContain(id);
    });
});

// =============================================================================
// computeCompleteness
// =============================================================================

describe('computeCompleteness', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('returns total matching field count with 0 filled when no DOM elements exist', () => {
        const result = computeCompleteness('basic');
        expect(result.filled).toBe(0);
        expect(result.total).toBe(getFieldsForProfile('basic').length);
    });

    it('counts filled text inputs', () => {
        const fields = getFieldsForProfile('basic');
        for (const id of fields) {
            const input = document.createElement('input');
            input.id = id;
            document.body.appendChild(input);
        }
        (document.getElementById(fields[0]) as HTMLInputElement).value = 'Test Title';
        (document.getElementById(fields[1]) as HTMLInputElement).value = 'A description';

        const result = computeCompleteness('basic');
        expect(result.filled).toBe(2);
        expect(result.total).toBe(fields.length);
    });

    it('ignores whitespace-only values', () => {
        const fields = getFieldsForProfile('basic');
        const input = document.createElement('input');
        input.id = fields[0];
        input.value = '   ';
        document.body.appendChild(input);

        const result = computeCompleteness('basic');
        expect(result.filled).toBe(0);
    });

    it('skips select elements with "Not specified" value', () => {
        const select = document.createElement('select');
        select.id = 'meta-quality-tier';
        const opt = document.createElement('option');
        opt.value = 'Not specified';
        select.appendChild(opt);
        select.value = 'Not specified';
        document.body.appendChild(select);

        const result = computeCompleteness('standard');
        expect(result.filled).toBe(0);
    });

    it('counts select elements with a real value as filled', () => {
        const select = document.createElement('select');
        select.id = 'meta-quality-tier';
        const opt = document.createElement('option');
        opt.value = 'survey';
        select.appendChild(opt);
        select.value = 'survey';
        document.body.appendChild(select);

        const result = computeCompleteness('standard');
        expect(result.filled).toBe(1);
    });

    it('archival profile counts more fields than basic', () => {
        const result1 = computeCompleteness('basic');
        const result2 = computeCompleteness('archival');
        expect(result2.total).toBeGreaterThan(result1.total);
    });
});

// =============================================================================
// Data structure contracts
// =============================================================================

describe('PROFILE_ORDER', () => {
    it('has strictly increasing order: basic < standard < archival', () => {
        expect(PROFILE_ORDER.basic).toBeLessThan(PROFILE_ORDER.standard);
        expect(PROFILE_ORDER.standard).toBeLessThan(PROFILE_ORDER.archival);
    });
});

describe('CRITICAL_FIELDS', () => {
    it('each tier is a superset of the previous', () => {
        const basicKeys = Object.keys(CRITICAL_FIELDS.basic);
        const standardKeys = Object.keys(CRITICAL_FIELDS.standard);
        const archivalKeys = Object.keys(CRITICAL_FIELDS.archival);

        for (const key of basicKeys) expect(standardKeys).toContain(key);
        for (const key of standardKeys) expect(archivalKeys).toContain(key);
    });

    it('all critical field IDs exist in COMPLETENESS_FIELDS', () => {
        for (const tier of ['basic', 'standard', 'archival'] as MetadataProfile[]) {
            for (const fieldId of Object.keys(CRITICAL_FIELDS[tier])) {
                expect(COMPLETENESS_FIELDS).toHaveProperty(fieldId);
            }
        }
    });
});

describe('TAB_TIERS', () => {
    it('all values are valid profile names', () => {
        const validProfiles = Object.keys(PROFILE_ORDER);
        for (const tier of Object.values(TAB_TIERS)) {
            expect(validProfiles).toContain(tier);
        }
    });
});

describe('KIOSK_SECTION_TIERS', () => {
    it('all values are valid profile names', () => {
        const validProfiles = Object.keys(PROFILE_ORDER);
        for (const tier of Object.values(KIOSK_SECTION_TIERS)) {
            expect(validProfiles).toContain(tier);
        }
    });
});

describe('EDITORIAL_SECTION_TIERS', () => {
    it('all values are valid profile names', () => {
        const validProfiles = Object.keys(PROFILE_ORDER);
        for (const tier of Object.values(EDITORIAL_SECTION_TIERS)) {
            expect(validProfiles).toContain(tier);
        }
    });
});

describe('PRONOM_REGISTRY', () => {
    it('all entries have a non-empty name', () => {
        for (const entry of Object.values(PRONOM_REGISTRY)) {
            expect(typeof entry.name).toBe('string');
            expect(entry.name.length).toBeGreaterThan(0);
        }
    });

    it('puid is a string for all entries', () => {
        for (const entry of Object.values(PRONOM_REGISTRY)) {
            expect(typeof entry.puid).toBe('string');
        }
    });

    it('includes core scan formats', () => {
        expect(PRONOM_REGISTRY).toHaveProperty('glb');
        expect(PRONOM_REGISTRY).toHaveProperty('e57');
        expect(PRONOM_REGISTRY).toHaveProperty('ply');
        expect(PRONOM_REGISTRY).toHaveProperty('splat');
    });
});
