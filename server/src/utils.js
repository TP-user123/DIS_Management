import { Activity, Case, Task, User } from './models.js';

export async function logActivity({ companyId, entityType, entityId, action, performedBy, details = {}, comment = '' }) {
  return Activity.create({ companyId, entityType, entityId, action, performedBy, details, comment });
}
export async function makeCaseNumber(companyId) {
  const count = await Case.countDocuments({ companyId });
  return `CASE-${String(count + 1).padStart(5, '0')}`;
}
export async function makeTaskNumber(companyId) {
  const count = await Task.countDocuments({ companyId });
  return `TASK-${String(count + 1).padStart(5, '0')}`;
}
export async function ensureCompanyUser(companyId, userId) {
  if (!userId) return null;
  return User.findOne({ _id: userId, companyId, status: 'active' }).select('_id name email role team shift');
}
export function canAssign(actor, target) {
  if (actor.role === 'MANAGER') return true;
  if (actor.role === 'TL') return ['SL', 'RE'].includes(target.role) && actor.team === target.team;
  if (actor.role === 'SL') return target.role === 'RE' && actor.team === target.team && actor.shift === target.shift;
  if (actor.role === 'RE' && (actor.effectivePermissions?.includes('tickets:assign') || actor.effectivePermissions?.includes('tasks:assign'))) return target.role === 'RE' && actor.team === target.team;
  return false;
}
