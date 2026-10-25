import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentTransition, normalizeWarrantyStatus, parseAssetRecordRow } from '../src/assetRules.js';

test('asset records normalize warranty values and derive status from expiry dates', () => {
  assert.equal(normalizeWarrantyStatus('In Warranty', null), 'IN_WARRANTY');
  assert.equal(normalizeWarrantyStatus('expired', null), 'OUT_OF_WARRANTY');
  assert.equal(normalizeWarrantyStatus('', new Date('2026-10-24T00:00:00Z'), new Date('2026-10-24T18:00:00Z')), 'IN_WARRANTY');
  const parsed = parseAssetRecordRow({
    'Asset ID': ' lap-4 ',
    'Serial Number': ' SN-009 ',
    'Warranty Status': 'in warranty',
    'Asset Type': 'Laptop',
    'Warranty Expiry Date': 45292
  }, 4, new Date('2024-01-01T00:00:00Z'));
  assert.equal(parsed.value.assetKey, 'LAP-4');
  assert.equal(parsed.value.serialNumber, 'SN-009');
  assert.equal(parsed.value.warrantyStatus, 'IN_WARRANTY');
  assert.equal(parsed.value.warrantyExpiryDate.toISOString(), '2024-01-01T00:00:00.000Z');
  assert.deepEqual(parseAssetRecordRow({ 'Asset ID': 'A', 'Serial Number': '', 'Warranty Status': '' }, 5).errors.map((error) => error.field), ['Serial Number', 'Warranty Status']);
  assert.ok(parseAssetRecordRow({ 'Asset ID': 'A', 'Serial Number': 'S' }, 6).errors.some((error) => error.message === 'Required column is missing.'));
  assert.equal(parseAssetRecordRow({ 'Asset ID': 'A', 'Serial Number': 'S', 'Warranty Status': 'Maybe' }).errors.length, 1);
});

test('assignment workflow distinguishes pickup readiness from physical collection and blocks invalid returns', () => {
  assert.deepEqual(assignmentTransition({ action: 'PICKUP_READY', currentStatus: 'ASSIGNED', isAssignee: true }), { nextStatus: 'PICKUP_READY' });
  assert.deepEqual(assignmentTransition({ action: 'COLLECTED', currentStatus: 'PICKUP_READY', isAssignee: true }), { nextStatus: 'COLLECTED' });
  assert.equal(assignmentTransition({ action: 'PICKUP_READY', currentStatus: 'ASSIGNED', isAssignee: false }).statusCode, 403);
  assert.equal(assignmentTransition({ action: 'RETURN', currentStatus: 'ASSIGNED', isAssignee: true, ready: false, comment: '' }).statusCode, 400);
  assert.deepEqual(assignmentTransition({ action: 'RETURN', currentStatus: 'RETURN_BLOCKED', isAssignee: true, ready: true }), { nextStatus: 'COMPLETED' });
  assert.equal(assignmentTransition({ action: 'RETURN', currentStatus: 'COMPLETED', isAssignee: true, ready: true }).statusCode, 409);
});
