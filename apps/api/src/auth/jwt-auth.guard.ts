import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AUTH_COOKIE_NAME } from './cookie';
import { JwtPayload } from './types';

/**
 * Reads the `verdict_token` httpOnly cookie, verifies it via @nestjs/jwt
 * (using the same secret AuthModule registered JwtModule with), and sets
 * `req.user = {id, email, role}`. Throws 401 (never falls through) when the
 * cookie is missing, malformed, expired, or signed with a different secret.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('missing auth cookie');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('invalid or expired auth cookie');
    }

    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    return true;
  }
}
