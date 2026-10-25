import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCategory,
  normalizePriority,
  normalizeTicketImportRow,
  ticketAgeDays,
  ticketFilterConditions
} from '../src/ticketRules.js';

test('normalizes all supported priorities and common imported aliases', () => {
  for (const [input, expected] of [
    ['Critical', 'Critical'], ['URGENT', 'Critical'], ['P1', 'Critical'],
    ['high', 'High'], ['P2', 'High'], ['Medium', 'Medium'], ['normal', 'Medium'],
    ['low', 'Low'], ['P4', 'Low'], ['', 'Medium']
  ]) assert.equal(normalizePriority(input), expected);
});

test('keeps ticket category separate from priority and handles legacy request type', () => {
  const imported = normalizeTicketImportRow({
    'Ticket Number': ' INC-7 ',
    'Request Type': 'service_request',
    Category: ' Network  Access ',
    Priority: 'HIGH'
  });
  assert.equal(imported.value.ticketNumber, 'INC-7');
  assert.equal(imported.value.category, 'Network Access');
  assert.equal(imported.value.requestType, 'service_request');
  assert.equal(imported.value.priorityName, 'High');
  assert.equal(normalizeCategory('', imported.value.requestType), 'service_request');

  const conditions = ticketFilterConditions({ status: 'OPEN', category: 'Network Access', priority: 'High', search: 'inc-7' });
  assert.equal(conditions.length, 4);
  assert.ok(conditions.some((condition) => condition.$or?.some((branch) => branch.workflowStatus?.$in?.some((pattern) => pattern.test('OPEN')))));
  assert.ok(conditions.some((condition) => condition.$or?.some((branch) => branch.category instanceof RegExp)));
  assert.ok(conditions.some((condition) => condition.$or?.some((branch) => branch.priorityName?.$in?.some((pattern) => pattern.test('HIGH')))));
  assert.ok(conditions.some((condition) => condition.$or?.some((branch) => branch.ticketNumber instanceof RegExp)));
});

test('legacy workflow statuses and missing priorities remain filterable', () => {
  const conditions = ticketFilterConditions({ status: 'WIP', priority: 'Medium' });
  const statusCondition = conditions[0].$or;
  assert.ok(statusCondition.some((branch) => branch.$and?.some((part) => part.sourceStatus?.$in?.some((pattern) => pattern.test('In Progress')))));
  const priorityCondition = conditions[1].$or;
  assert.ok(priorityCondition.some((branch) => branch.priorityName?.$exists === false));
  assert.ok(priorityCondition.some((branch) => branch.priorityName?.$in?.some((pattern) => pattern.test('moderate'))));
});

test('legacy source status is only used when canonical workflow status is missing', () => {
  const [condition] = ticketFilterConditions({ status: 'OPEN' });
  const sourceFallback = condition.$or.find((branch) => branch.$and?.some((part) => part.sourceStatus));
  assert.ok(sourceFallback);
  assert.ok(sourceFallback.$and.some((part) => part.$or?.some((branch) => branch.workflowStatus?.$exists === false)));
});

test('normalizes ticket import headers and rejects missing IDs or invalid dates', () => {
  const imported = normalizeTicketImportRow({
    'Ticket ID': 'T-1',
    'Request Type': 'Incident',
    'Priority Name': 'critical',
    'Logged Date': 45292
  }, new Date('2025-01-01T00:00:00Z'));
  assert.equal(imported.value.priorityName, 'Critical');
  assert.equal(imported.value.category, 'Incident');
  assert.equal(imported.value.loggedDate.toISOString(), '2024-01-01T00:00:00.000Z');
  assert.match(normalizeTicketImportRow({ Description: 'no ID' }).error, /Ticket Number/);
  assert.match(normalizeTicketImportRow({ 'Ticket Number': 'T-2', 'Logged Date': 'not-a-date' }).error, /Logged Date/);
});

test('normalizes every supported imported priority as its own priority value', () => {
  for (const [input, expected] of [['critical', 'Critical'], ['High', 'High'], ['medium', 'Medium'], ['LOW', 'Low']]) {
    const imported = normalizeTicketImportRow({ 'Ticket Number': `T-${input}`, 'Priority Name': input, Category: 'Hardware' });
    assert.equal(imported.value.priorityName, expected);
    assert.equal(imported.value.category, 'Hardware');
  }
});

test('resolved age freezes at resolvedAt and reopening restarts the active age cycle', () => {
  const now = new Date('2025-01-18T12:00:00Z');
  const resolved = {
    workflowStatus: 'RESOLVED',
    loggedDate: new Date('2025-01-01T12:00:00Z'),
    resolvedAt: new Date('2025-01-01T13:00:00Z')
  };
  assert.equal(ticketAgeDays(resolved, now), 0);

  const reopened = {
    ...resolved,
    workflowStatus: 'REOPENED',
    reopenedAt: new Date('2025-01-17T12:00:00Z'),
    ageStartedAt: new Date('2025-01-17T12:00:00Z'),
    resolvedAt: null
  };
  assert.equal(ticketAgeDays(reopened, now), 1);
  assert.equal(ticketAgeDays({ ...reopened, workflowStatus: 'RESOLVED', resolvedAt: new Date('2025-01-17T14:00:00Z') }, now), 0);
});

test('legacy resolved source status is used for age when workflow status is absent', () => {
  const age = ticketAgeDays({
    sourceStatus: 'Closed',
    loggedDate: new Date('2025-01-01T00:00:00Z'),
    resolvedAt: new Date('2025-01-01T08:00:00Z')
  }, new Date('2025-02-01T00:00:00Z'));
  assert.equal(age, 0);
});
