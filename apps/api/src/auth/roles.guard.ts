import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';

/**
 * Role authorization. Always list AFTER JwtAuthGuard in `@UseGuards(...)` — it
 * reads `req.user`, which only JwtAuthGuard sets. Routes with no `@Roles()`
 * metadata are allowed through.
 *
 * Currently guards: `/review/queue` and `/answers/:id/{approve,reject,edit}`
 * (`@Roles('TEACHER')`), and `POST /doubts` (`@Roles('STUDENT')`, so a teacher
 * can't route their own question into their own review queue). These are the
 * boundaries that keep the approval workflow meaningful, so they're asserted
 * over HTTP in broad-coverage.e2e-spec.ts rather than trusted to stay wired.
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
