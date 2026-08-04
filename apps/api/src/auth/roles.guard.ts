import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';

/**
 * NOT wired to any route yet — M2 has no teacher-only endpoints. Set up now
 * (per the M2 spec) so a LATER milestone can do
 * `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('TEACHER')` with no further
 * plumbing. Always list AFTER JwtAuthGuard — it reads `req.user`, which only
 * JwtAuthGuard sets. Routes with no `@Roles()` metadata are allowed through.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    return !!req.user && requiredRoles.includes(req.user.role);
  }
}
