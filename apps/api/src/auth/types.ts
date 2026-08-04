import { Role } from '@prisma/client';

/** Signed into `verdict_token`. Kept intentionally small — no `name` (see AuthService.findById for that). */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

/** `req.user` shape set by JwtAuthGuard and read via `@CurrentUser()`. */
export interface RequestUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}
