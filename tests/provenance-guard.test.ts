/**
 * The provenance guard is the single most important safety control in the system.
 * These tests pin it: engine|imported|human pass; ANYTHING else — above all
 * 'model' — is refused, with the offending lines named for the audit trail.
 */
import { describe, it, expect } from 'vitest';
import {
  assertFiledProvenance,
  findProvenanceViolations,
  ProvenanceViolationError,
  type ProvenancedField,
} from '../src/shared/provenance-guard.js';

const clean: ProvenancedField[] = [
  { line: '060', value: '2025-01-01', provenance: 'imported' },
  { line: '300', value: 12345, provenance: 'engine' },
  { line: '040', value: 'CCPC', provenance: 'human' },
];

describe('provenance guard', () => {
  it('passes a return where every field is engine|imported|human', () => {
    expect(() => assertFiledProvenance(clean)).not.toThrow();
    expect(findProvenanceViolations(clean)).toEqual([]);
  });

  it('passes an empty field set', () => {
    expect(() => assertFiledProvenance([])).not.toThrow();
  });

  it('REFUSES a return with a model-provenance field', () => {
    const tainted = [...clean, { line: '999', value: 79700, provenance: 'model' }];
    expect(() => assertFiledProvenance(tainted)).toThrow(ProvenanceViolationError);
  });

  it('refuses any unknown provenance, not just "model"', () => {
    const tainted = [...clean, { line: '425', value: 1, provenance: 'guessed' }];
    expect(() => assertFiledProvenance(tainted)).toThrow(ProvenanceViolationError);
  });

  it('names every offending line in the error (audit trail)', () => {
    const tainted = [
      ...clean,
      { line: '999', value: 1, provenance: 'model' },
      { line: '888', value: 2, provenance: 'model' },
    ];
    try {
      assertFiledProvenance(tainted);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvenanceViolationError);
      const e = err as ProvenanceViolationError;
      expect(e.offenders.map((o) => o.line).sort()).toEqual(['888', '999']);
      expect(e.message).toContain('999=model');
      expect(e.message).toContain('never a model');
    }
  });
});
