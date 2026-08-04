import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Role, User } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';

// Low bcrypt cost factor keeps this test fast; correctness of bcryptjs itself
// is out of scope, we're testing AuthService's use of it.
const PLAINTEXT_PASSWORD = 'password';
const PASSWORD_HASH = bcrypt.hashSync(PLAINTEXT_PASSWORD, 4);

const FAKE_USER: User = {
  id: 'user-1',
  email: 'student@verdict.dev',
  passwordHash: PASSWORD_HASH,
  name: 'Sample Student',
  role: Role.STUDENT,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

/** Minimal fake standing in for PrismaService — no DB/Docker involved. */
function makeFakePrisma(users: User[]) {
  return {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email !== undefined) return users.find((u) => u.email === where.email) ?? null;
        if (where.id !== undefined) return users.find((u) => u.id === where.id) ?? null;
        return null;
      }),
    },
  };
}

function makeService(users: User[] = [FAKE_USER]) {
  const prisma = makeFakePrisma(users);
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '7d' } });
  const service = new AuthService(prisma as any, jwt);
  return { service, prisma, jwt };
}

describe('AuthService.validateUser', () => {
  it('returns the user when the password bcrypt-compares against the stored hash', async () => {
    const { service } = makeService();
    const user = await service.validateUser(FAKE_USER.email, PLAINTEXT_PASSWORD);
    expect(user?.id).toBe(FAKE_USER.id);
  });

  it('returns null when the password does not match the stored hash', async () => {
    const { service } = makeService();
    const user = await service.validateUser(FAKE_USER.email, 'wrong-password');
    expect(user).toBeNull();
  });

  it('returns null when no user exists for the email (never throws / never distinguishes from a bad password)', async () => {
    const { service } = makeService();
    const user = await service.validateUser('nobody@verdict.dev', PLAINTEXT_PASSWORD);
    expect(user).toBeNull();
  });
});

describe('AuthService.sign / JWT round-trip', () => {
  it('signs a token whose verified payload carries {sub, email, role}', () => {
    const { service, jwt } = makeService();
    const token = service.sign(FAKE_USER);
    const decoded = jwt.verify<{ sub: string; email: string; role: string }>(token);

    expect(decoded.sub).toBe(FAKE_USER.id);
    expect(decoded.email).toBe(FAKE_USER.email);
    expect(decoded.role).toBe(FAKE_USER.role);
  });

  it('fails verification against a differently-secreted JwtService (secrets must match)', () => {
    const { service } = makeService();
    const token = service.sign(FAKE_USER);
    const otherJwt = new JwtService({ secret: 'a-different-secret' });
    expect(() => otherJwt.verify(token)).toThrow();
  });
});

describe('AuthService.toView', () => {
  it('projects only {id, email, role, name} — never passwordHash', () => {
    const view = AuthService.toView(FAKE_USER);
    expect(view).toEqual({
      id: FAKE_USER.id,
      email: FAKE_USER.email,
      role: FAKE_USER.role,
      name: FAKE_USER.name,
    });
    expect(view).not.toHaveProperty('passwordHash');
  });
});
