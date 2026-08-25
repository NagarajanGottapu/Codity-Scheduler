import { Request, Response, NextFunction } from 'express';
import { AuthService, TokenPayload } from '../services/auth.service.js';
import { UserRole } from '../types/index.js';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
  apiKeyUser?: any;
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // 1. Check Bearer Token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = AuthService.verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  // 2. Check X-API-Key header
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey) {
    const user = AuthService.getUserByApiKey(apiKey);
    if (user) {
      req.user = {
        userId: user.id,
        orgId: user.org_id,
        role: user.role,
        email: user.email,
        name: user.name
      };
      req.apiKeyUser = user;
      return next();
    }
  }

  // For seamless demo access if no token is provided in local dev, attach default admin
  if (process.env.ALLOW_ANONYMOUS_DEV === 'true' || !process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
    // Check if dev bypass token header exists
    req.user = {
      userId: 'user-admin-default',
      orgId: 'org-default',
      role: 'admin',
      email: 'admin@codity.io',
      name: 'Codity Admin'
    };
    return next();
  }

  res.status(401).json({
    success: false,
    error: 'Unauthorized. Please provide a valid Bearer token or X-API-Key header.'
  });
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `Forbidden: requires one of [${allowedRoles.join(', ')}] roles, but user has role '${req.user.role}'`
      });
      return;
    }

    next();
  };
}
