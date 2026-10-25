import test from 'node:test';
import assert from 'node:assert/strict';
import { publicIssue } from '../src/routes/engineerIssues.js';

test('anonymous RE issue responses hide reporter identity from leads', () => {
  const issue = {
    _id: 'issue-1', engineerId: 'engineer-1', anonymousToLeads: true, reportRef: 'EIR-42',
    title: 'Access issue', description: 'Cannot open the support tool', status: 'OPEN'
  };
  const users = { 'engineer-1': { _id: 'engineer-1', name: 'Riya Engineer', role: 'RE' } };
  for (const role of ['TL', 'SL', 'MANAGER']) {
    const visible = publicIssue(issue, users, { role });
    assert.equal(Object.hasOwn(visible, 'engineerId'), false);
    assert.equal(Object.hasOwn(visible, 'reporter'), false);
    assert.equal(visible.reportRef, 'EIR-42');
  }
});

test('the engineer can still see their own reporter identity for follow-up', () => {
  const issue = { _id: 'issue-2', engineerId: 'engineer-2', anonymousToLeads: true, reportRef: 'EIR-43', title: 'VPN issue' };
  const users = { 'engineer-2': { _id: 'engineer-2', name: 'Dev Engineer', role: 'RE' } };
  const visible = publicIssue(issue, users, { role: 'RE' });
  assert.equal(visible.reporter.name, 'Dev Engineer');
  assert.equal(Object.hasOwn(visible, 'engineerId'), false);
});
