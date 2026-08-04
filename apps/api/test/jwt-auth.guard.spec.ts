import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

interface FakeRequest {
  cookies: Record<string, string>;
  user?: unknown;
}

function makeContext(cookies: Record<string, string>): { context: ExecutionContext; req: FakeRequest } {
  const req: FakeRequest = { cookies };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '7d' } });
  const guard = new JwtAuthGuard(jwt);

  it('throws UnauthorizedException when the verdict_token cookie is missing', () => {
    const { context } = makeContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the cookie holds a garbage (non-JWT) token', () => {
    const { context } = makeContext({ verdict_token: 'not-a-real-jwt' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token was signed with a different secret', () => {
    const otherJwt = new JwtService({ secret: 'other-secret' });
    const token = otherJwt.sign({ sub: 'u1', email: 'a@b.com', role: Role.STUDENT });
    const { context } = makeContext({ verdict_token: token });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token is expired', () => {
    const expiredJwt = new JwtService({ secret: 'test-secret' });
    const token = expiredJwt.sign({ sub: 'u1', email: 'a@b.com', role: Role.STUDENT }, { expiresIn: '-1s' });
    const { context } = makeContext({ verdict_token: token });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('sets req.user from a valid token and allows the request through', () => {
    const token = jwt.sign({ sub: 'user-1', email: 'student@verdict.dev', role: Role.STUDENT });
    const { context, req } = makeContext({ verdict_token: token });

    expect(guard.canActivate(context)).toBe(true);
    expect(req.user).toEqual({ id: 'user-1', email: 'student@verdict.dev', role: Role.STUDENT });
  });
});
