import jwt from 'jsonwebtoken';
import { User, Company } from './models.js';

export async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Please sign in.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: payload.userId, status: 'active' }).select('-passwordHash');
    if (!user) return res.status(401).json({ message: 'Account not found or inactive.' });
    req.user = user;
    req.companyId = String(user.companyId);
    next();
  } catch {
    return res.status(401).json({ message: 'Your session is invalid or expired. Please sign in again.' });
  }
}

export const DEFAULT_ROLE_PERMISSIONS = {
  MANAGER: ['tickets:view','tickets:import','tickets:assign','tickets:route','tasks:view','tasks:create','tasks:assign','tasks:handover','events:view','events:manage','reports:view','team:view','team:manage','notifications:view'],
  TL: ['tickets:view','tickets:import','tickets:assign','tickets:route','tasks:view','tasks:create','tasks:assign','tasks:handover','events:view','events:manage','reports:view','team:view','notifications:view'],
  SL: ['tickets:view','tickets:import','tickets:assign','tickets:route','tasks:view','tasks:create','tasks:assign','tasks:handover','events:view','events:manage','reports:view','team:view','notifications:view'],
  RE: ['tickets:view','tickets:route','tasks:view','tasks:handover','events:view','notifications:view']
};

export async function permissionCheck(req, permission) {
  try {
    if (req.user?.role === 'MANAGER') return true;
    const companyId = req.companyId || String(req.user?.companyId || '');
    if (!companyId || !req.user?.role) return false;
    const company = await Company.findById(companyId).select('rolePermissions').lean();
    const configured = company?.rolePermissions?.[req.user.role];
    const allowed = Array.isArray(configured)
      ? configured
      : (DEFAULT_ROLE_PERMISSIONS[req.user.role] || []);
    req.user.effectivePermissions = allowed;
    return allowed.includes(permission);
  } catch {
    return false;
  }
}

export function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      if (req.user.role === 'MANAGER') return next();
      const company = await Company.findById(req.companyId).select('rolePermissions').lean();
      const configured = company?.rolePermissions?.[req.user.role];
      const allowed = Array.isArray(configured) ? configured : (DEFAULT_ROLE_PERMISSIONS[req.user.role] || []);
      req.user.effectivePermissions = allowed;
      if (!allowed.includes(permission)) return res.status(403).json({ message: `Your account does not have the required permission: ${permission}. Ask a manager to update your access.` });
      next();
    } catch (error) { next(error); }
  };
}
export function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission for this action.' });
    next();
  };
}
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
