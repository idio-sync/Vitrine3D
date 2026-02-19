/**
 * SIP (Submission Information Package) Compliance Validator
 *
 * Pure logic module — no DOM access, fully testable.
 * Receives CollectedMetadata + validation rules, returns structured results.
 */

import { Logger } from './utilities.js';
import type { MetadataProfile } from './metadata-profile.js';
import { getFieldsForProfile } from './metadata-profile.js';
import type { CollectedMetadata, ValidationRule } from './metadata-manager.js';

const log = Logger.getLogger('sip-validator');

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type SIPSeverity = 'error' | 'warning';

export interface SIPFinding {
    fieldId: string;
    label: string;
    severity: SIPSeverity;
    category: 'presence' | 'format';
    message: string;
}

export type ComplianceStatus = 'pass' | 'warnings' | 'override';

export interface SIPValidationResult {
    profile: MetadataProfile;
    score: number;
    errors: SIPFinding[];
    warnings: SIPFinding[];
    passCount: number;
    totalChecked: number;
    status: ComplianceStatus;
}

export interface ManifestCompliance {
    profile: MetadataProfile;
    status: ComplianceStatus;
    score: number;
    checked_at: string;
    errors: string[];
    warnings: string[];
    overridden: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Required fields per tier — cumulative. Empty → error finding.
 */
const REQUIRED_FIELDS: Record<MetadataProfile, Record<string, string>> = {
    basic: {
        'meta-title': 'Title',
        'meta-operator': 'Scan Operator',
        'meta-capture-date': 'Capture Date',
    },
    standard: {
        'meta-title': 'Title',
        'meta-operator': 'Scan Operator',
        'meta-capture-date': 'Capture Date',
        'meta-description': 'Description',
        'meta-capture-device': 'Capture Device',
        'meta-quality-tier': 'Quality Tier',
    },
    archival: {
        'meta-title': 'Title',
        'meta-operator': 'Scan Operator',
        'meta-capture-date': 'Capture Date',
        'meta-description': 'Description',
        'meta-capture-device': 'Capture Device',
        'meta-quality-tier': 'Quality Tier',
        'meta-archival-title': 'Catalog Title',
        'meta-archival-copyright': 'Original Object Copyright',
        'meta-pres-render-req': 'Rendering Requirements',
    },
};

/**
 * Human-readable labels for all completeness fields.
 * Required field labels are pulled from REQUIRED_FIELDS; remaining fields
 * derive labels from their IDs.
 */
const FIELD_LABELS: Record<string, string> = {
    // basic
    'meta-title': 'Title',
    'meta-description': 'Description',
    'meta-tags': 'Tags',
    'meta-license': 'License',
    'meta-capture-date': 'Capture Date',
    'meta-capture-device': 'Capture Device',
    'meta-operator': 'Scan Operator',
    'meta-location': 'Location',
    // standard
    'meta-device-serial': 'Device Serial',
    'meta-operator-orcid': 'Operator ORCID',
    'meta-processing-notes': 'Processing Notes',
    'meta-conventions': 'Conventions',
    'meta-quality-tier': 'Quality Tier',
    'meta-quality-accuracy': 'Accuracy Grade',
    'meta-quality-res-value': 'Capture Resolution',
    'meta-quality-scale-verify': 'Scale Verification',
    'meta-splat-created-by': 'Splat Created By',
    'meta-mesh-created-by': 'Mesh Created By',
    'meta-pointcloud-created-by': 'Point Cloud Created By',
    // archival
    'meta-archival-title': 'Catalog Title',
    'meta-archival-creator': 'Creator',
    'meta-archival-date-created': 'Date Created',
    'meta-archival-medium': 'Medium',
    'meta-archival-provenance': 'Provenance',
    'meta-archival-copyright': 'Original Object Copyright',
    'meta-coverage-location': 'Subject Location',
    'meta-coverage-lat': 'Latitude',
    'meta-coverage-lon': 'Longitude',
    'meta-archival-condition': 'Condition',
    'meta-archival-credit': 'Credit Line',
    'meta-archival-context-desc': 'Context Description',
    'meta-material-workflow': 'Material Workflow',
    'meta-material-colorspace': 'Color Space',
    'meta-pres-render-req': 'Rendering Requirements',
};

/**
 * Maps field IDs to accessor functions on CollectedMetadata.
 */
const FIELD_VALUE_MAP: Record<string, (m: CollectedMetadata) => string> = {
    'meta-title': m => m.project.title,
    'meta-description': m => m.project.description,
    'meta-tags': m => m.project.tags.join(', '),
    'meta-license': m => m.project.license,
    'meta-capture-date': m => m.provenance.captureDate,
    'meta-capture-device': m => m.provenance.captureDevice,
    'meta-operator': m => m.provenance.operator,
    'meta-operator-orcid': m => m.provenance.operatorOrcid,
    'meta-location': m => m.provenance.location,
    'meta-device-serial': m => m.provenance.deviceSerial,
    'meta-processing-notes': m => m.provenance.processingNotes,
    'meta-conventions': m => m.provenance.conventions,
    'meta-quality-tier': m => m.qualityMetrics.tier,
    'meta-quality-accuracy': m => m.qualityMetrics.accuracyGrade,
    'meta-quality-res-value': m => String(m.qualityMetrics.captureResolution.value ?? ''),
    'meta-quality-scale-verify': m => m.qualityMetrics.scaleVerification,
    'meta-splat-created-by': m => m.splatMetadata.createdBy,
    'meta-mesh-created-by': m => m.meshMetadata.createdBy,
    'meta-pointcloud-created-by': m => m.pointcloudMetadata.createdBy,
    'meta-archival-title': m => m.archivalRecord.title,
    'meta-archival-creator': m => m.archivalRecord.creation.creator,
    'meta-archival-date-created': m => m.archivalRecord.creation.dateCreated,
    'meta-archival-medium': m => m.archivalRecord.physicalDescription.medium,
    'meta-archival-provenance': m => m.archivalRecord.provenance,
    'meta-archival-copyright': m => m.archivalRecord.rights.copyrightStatus,
    'meta-coverage-location': m => m.archivalRecord.coverage.spatial.locationName,
    'meta-coverage-lat': m => String(m.archivalRecord.coverage.spatial.coordinates[0] ?? ''),
    'meta-coverage-lon': m => String(m.archivalRecord.coverage.spatial.coordinates[1] ?? ''),
    'meta-archival-condition': m => m.archivalRecord.physicalDescription.condition,
    'meta-archival-credit': m => m.archivalRecord.rights.creditLine,
    'meta-archival-context-desc': m => m.archivalRecord.context.description,
    'meta-material-workflow': m => m.materialStandard.workflow,
    'meta-material-colorspace': m => m.materialStandard.colorSpace,
    'meta-pres-render-req': m => m.preservation.renderingRequirements,
};

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Resolve a field value from CollectedMetadata by field ID.
 */
function resolveFieldValue(fieldId: string, metadata: CollectedMetadata): string {
    const accessor = FIELD_VALUE_MAP[fieldId];
    if (!accessor) return '';
    try {
        return accessor(metadata);
    } catch {
        return '';
    }
}

/**
 * Get the human-readable label for a field ID.
 */
function getFieldLabel(fieldId: string): string {
    return FIELD_LABELS[fieldId] || fieldId.replace(/^meta-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Validate CollectedMetadata against SIP compliance rules for a given profile.
 * Pure function — no DOM access.
 */
export function validateSIP(
    metadata: CollectedMetadata,
    profile: MetadataProfile,
    formatRules: Record<string, ValidationRule>
): SIPValidationResult {
    const fields = getFieldsForProfile(profile);
    const required = REQUIRED_FIELDS[profile];
    const errors: SIPFinding[] = [];
    const warnings: SIPFinding[] = [];
    let passCount = 0;

    for (const fieldId of fields) {
        const value = resolveFieldValue(fieldId, metadata).trim();
        const isEmpty = !value || value === 'Not specified';
        const label = getFieldLabel(fieldId);
        const isRequired = fieldId in required;

        if (isEmpty) {
            if (isRequired) {
                errors.push({
                    fieldId,
                    label,
                    severity: 'error',
                    category: 'presence',
                    message: 'Required field is empty',
                });
            } else {
                warnings.push({
                    fieldId,
                    label,
                    severity: 'warning',
                    category: 'presence',
                    message: 'Recommended field is empty',
                });
            }
            continue;
        }

        // Non-empty — check format rules
        const rule = formatRules[fieldId];
        if (rule) {
            let isValid = true;
            if (rule.pattern) {
                isValid = rule.pattern.test(value);
            } else if (rule.validate) {
                isValid = rule.validate(value);
            }

            if (!isValid) {
                errors.push({
                    fieldId,
                    label,
                    severity: 'error',
                    category: 'format',
                    message: rule.message,
                });
                continue;
            }
        }

        passCount++;
    }

    const totalChecked = fields.length;
    const score = totalChecked > 0 ? Math.round((passCount / totalChecked) * 100) : 100;
    const status: ComplianceStatus = errors.length > 0 ? 'warnings' :
        warnings.length > 0 ? 'warnings' : 'pass';

    log.info(`SIP validation: profile=${profile}, score=${score}%, errors=${errors.length}, warnings=${warnings.length}`);

    return {
        profile,
        score,
        errors,
        warnings,
        passCount,
        totalChecked,
        status,
    };
}

/**
 * Convert a SIPValidationResult to a ManifestCompliance record for embedding in the archive manifest.
 */
export function toManifestCompliance(
    result: SIPValidationResult,
    overridden: boolean
): ManifestCompliance {
    return {
        profile: result.profile,
        status: overridden ? 'override' : result.status,
        score: result.score,
        checked_at: new Date().toISOString(),
        errors: result.errors.map(f => `${f.label}: ${f.message}`),
        warnings: result.warnings.map(f => `${f.label}: ${f.message}`),
        overridden,
    };
}
