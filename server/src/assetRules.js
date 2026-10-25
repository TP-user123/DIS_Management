const DAY_MS = 86_400_000;

const headerKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function importedDate(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + value * DAY_MS);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeWarrantyStatus(value, expiryDate, now = new Date()) {
  if (expiryDate) return expiryDate.toISOString().slice(0, 10) >= now.toISOString().slice(0, 10) ? 'IN_WARRANTY' : 'OUT_OF_WARRANTY';
  const key = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (['in warranty', 'under warranty', 'covered', 'active'].includes(key)) return 'IN_WARRANTY';
  if (['out of warranty', 'expired', 'not covered', 'inactive'].includes(key)) return 'OUT_OF_WARRANTY';
  if (['unknown', 'not specified'].includes(key)) return 'UNKNOWN';
  return '';
}

export function parseAssetRecordRow(row = {}, rowNumber = 2, now = new Date()) {
  const values = new Map(Object.entries(row).map(([key, value]) => [headerKey(key), value]));
  const get = (...keys) => {
    for (const key of keys) {
      const value = values.get(headerKey(key));
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
  };
  const assetId = String(get('Asset ID', 'Asset Number')).trim();
  const serialNumber = String(get('Serial Number', 'Serial')).trim().toUpperCase();
  const warrantyRaw = String(get('Warranty Status')).trim();
  const warrantyExpiryValue = get('Warranty Expiry Date', 'Warranty End Date');
  const warrantyExpiryDate = importedDate(warrantyExpiryValue);
  const errors = [];
  if (!values.has(headerKey('Asset ID')) && !values.has(headerKey('Asset Number'))) errors.push({ row: rowNumber, field: 'Asset ID', message: 'Required column is missing.' });
  if (!values.has(headerKey('Serial Number')) && !values.has(headerKey('Serial'))) errors.push({ row: rowNumber, field: 'Serial Number', message: 'Required column is missing.' });
  if (!values.has(headerKey('Warranty Status'))) errors.push({ row: rowNumber, field: 'Warranty Status', message: 'Required column is missing.' });
  if (!assetId) errors.push({ row: rowNumber, field: 'Asset ID', message: 'Asset ID is required.' });
  if (!serialNumber) errors.push({ row: rowNumber, field: 'Serial Number', message: 'Serial Number is required.' });
  if (warrantyExpiryValue && !warrantyExpiryDate) errors.push({ row: rowNumber, field: 'Warranty Expiry Date', message: 'Warranty expiry date is invalid.' });
  const warrantyStatus = normalizeWarrantyStatus(warrantyRaw, warrantyExpiryDate, now);
  if (!warrantyStatus) errors.push({ row: rowNumber, field: 'Warranty Status', message: 'Use In Warranty or Out of Warranty, or provide a warranty expiry date.' });
  const condition = String(get('Condition', 'Asset Condition')).trim().toUpperCase() || 'UNKNOWN';
  const operationalStatus = String(get('Operational Status', 'Asset Status')).trim().toUpperCase().replace(/[\s-]+/g, '_') || 'ACTIVE';
  if (!['UNKNOWN', 'GOOD', 'FAIR', 'DAMAGED'].includes(condition)) errors.push({ row: rowNumber, field: 'Condition', message: 'Condition must be Good, Fair, Damaged, or blank.' });
  if (!['ACTIVE', 'UNDER_REPAIR', 'RETIRED'].includes(operationalStatus)) errors.push({ row: rowNumber, field: 'Operational Status', message: 'Operational Status must be Active, Under Repair, Retired, or blank.' });

  const dateField = (label, ...aliases) => {
    const raw = get(label, ...aliases);
    if (!raw) return null;
    const date = importedDate(raw);
    if (!date) errors.push({ row: rowNumber, field: label, message: `${label} is invalid.` });
    return date;
  };
  return {
    value: {
      assetId,
      assetKey: assetId.toUpperCase(),
      serialNumber,
      warrantyStatus,
      warrantyStartDate: dateField('Warranty Start Date'),
      warrantyExpiryDate,
      assetType: String(get('Asset Type', 'System Type')).trim(),
      manufacturer: String(get('Manufacturer', 'Make')).trim(),
      model: String(get('Model', 'Model Name')).trim(),
      purchaseDate: dateField('Purchase Date'),
      location: String(get('Location', 'Site')).trim(),
      notes: String(get('Notes', 'Comments')).trim(),
      condition,
      operationalStatus,
      provided: [...values.keys()]
    },
    errors
  };
}

export function assignmentTransition({ action, currentStatus, isAssignee, ready, comment }) {
  const current = String(currentStatus || 'ASSIGNED').toUpperCase();
  const command = String(action || '').toUpperCase();
  if (!isAssignee) return { error: 'Only the person currently assigned to this system can confirm this workflow step.', statusCode: 403 };
  if (['COMPLETED', 'CANCELLED'].includes(current)) return { error: 'This assignment workflow is complete and cannot be edited through ordinary actions.', statusCode: 409 };
  if (command === 'PICKUP_READY') {
    if (current !== 'ASSIGNED') return { error: 'Pickup can only be marked ready from an assigned state.', statusCode: 409 };
    return { nextStatus: 'PICKUP_READY' };
  }
  if (command === 'COLLECTED') {
    if (current !== 'PICKUP_READY') return { error: 'Physical collection can only be recorded after the system is ready for pickup.', statusCode: 409 };
    return { nextStatus: 'COLLECTED' };
  }
  if (command === 'RETURN') {
    if (!['ASSIGNED', 'PICKUP_READY', 'COLLECTED', 'RETURN_BLOCKED'].includes(current)) {
      return { error: 'Return cannot be started from the current assignment state.', statusCode: 409 };
    }
    if (ready === true) return { nextStatus: 'COMPLETED' };
    if (!String(comment || '').trim()) return { error: 'Explain why the system is not ready before submitting the return.', statusCode: 400 };
    return { nextStatus: 'RETURN_BLOCKED' };
  }
  return { error: 'Choose a valid assignment workflow action.', statusCode: 400 };
}
