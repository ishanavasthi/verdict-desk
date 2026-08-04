import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './types';

export interface AuthUserView {
  id: string;
  email: string;
  role: User['role'];
  name: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Looks up the user by email and bcrypt-compares `password` against the
   * stored hash. Returns null on ANY mismatch (user absent OR wrong
   * password) — callers must not distinguish the two (no user enumeration).
   */
  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Signs a JWT with payload `{sub, email, role}` (SHARED CONTRACT). Expiry
   * (~7d) comes from JwtModule's `signOptions` registered in AuthModule.
   */
  sign(user: Pick<User, 'id' | 'email' | 'role'>): string {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return this.jwt.sign(payload);
  }

  static toView(user: User): AuthUserView {
    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }
}
