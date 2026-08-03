/**
 * Idempotent seed. Safe to run repeatedly (upserts keyed on stable unique fields:
 * users by `email`, problems & test cases by fixed UUID `id`).
 *
 * Run via: pnpm --filter @verdict/api seed   (tsx prisma/seed.ts)
 *
 * NOTE on the "ugly" row: PostgreSQL `text` columns cannot store a literal NUL
 * byte (U+0000) - the driver rejects it. To still stress the pipeline against
 * nasty data we embed OTHER C0 control characters (SOH U+0001, BEL U+0007,
 * ESC U+001B) alongside multi-byte unicode. The whole payload is built from
 * \u escape sequences below so no literal non-ASCII bytes live in this source.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Stable UUIDs so upserts are idempotent across runs.
const IDS = {
  problemSum: '11111111-1111-4111-8111-111111111111',
  problemEcho: '22222222-2222-4222-8222-222222222222',
  tc: {
    sum1: 'aaaaaaa1-0000-4000-8000-000000000001',
    sum2: 'aaaaaaa1-0000-4000-8000-000000000002',
    sumHidden: 'aaaaaaa1-0000-4000-8000-000000000003',
    echo1: 'bbbbbbb2-0000-4000-8000-000000000001',
    echoHidden: 'bbbbbbb2-0000-4000-8000-000000000002',
    echoUgly: 'bbbbbbb2-0000-4000-8000-000000000003',
  },
} as const;

// Built entirely from escapes (pure-ASCII source). Contains:
//   - multi-byte unicode: "cafe"+combining acute (U+0301), snowman (U+2603),
//     CJK "Japanese" (U+65E5 U+672C U+8A9E), rocket emoji (U+1F680)
//   - C0 control characters: SOH (U+0001), BEL (U+0007), ESC (U+001B) forming a
//     fake ANSI colour escape
//   - TAB / CR / LF whitespace
// NUL (U+0000) is intentionally omitted: Postgres text columns reject it.
const UGLY_PAYLOAD =
  'café ☃ 日本語 \u{1F680} ' +
  'SOH<> BEL<> ESC<[31mred[0m>' +
  '\tTAB\r\nCRLF\n';

async function main(): Promise<void> {
  // Plaintext password for both seeded users is: "password"
  const passwordHash = await bcrypt.hash('password', 10);

  const student = await prisma.user.upsert({
    where: { email: 'student@verdict.dev' },
    update: { passwordHash, name: 'Sample Student', role: Role.STUDENT },
    create: {
      email: 'student@verdict.dev',
      passwordHash,
      name: 'Sample Student',
      role: Role.STUDENT,
    },
  });

  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@verdict.dev' },
    update: { passwordHash, name: 'Sample Teacher', role: Role.TEACHER },
    create: {
      email: 'teacher@verdict.dev',
      passwordHash,
      name: 'Sample Teacher',
      role: Role.TEACHER,
    },
  });

  // ---- Problem 1: Sum of Two Numbers ----
  await prisma.problem.upsert({
    where: { id: IDS.problemSum },
    update: {
      title: 'Sum of Two Numbers',
      description:
        'Read two integers, each on its own line from stdin, and print their sum to stdout.',
      difficulty: 'easy',
    },
    create: {
      id: IDS.problemSum,
      title: 'Sum of Two Numbers',
      description:
        'Read two integers, each on its own line from stdin, and print their sum to stdout.',
      difficulty: 'easy',
    },
  });

  await upsertTestCase({
    id: IDS.tc.sum1,
    problemId: IDS.problemSum,
    input: '2\n3\n',
    expectedOutput: '5\n',
    hidden: false,
    weight: 1,
    ordering: 0,
  });
  await upsertTestCase({
    id: IDS.tc.sum2,
    problemId: IDS.problemSum,
    input: '10\n-4\n',
    expectedOutput: '6\n',
    hidden: false,
    weight: 1,
    ordering: 1,
  });
  await upsertTestCase({
    id: IDS.tc.sumHidden,
    problemId: IDS.problemSum,
    input: '1000000\n2000000\n',
    expectedOutput: '3000000\n',
    hidden: true,
    weight: 2,
    ordering: 2,
  });

  // ---- Problem 2: Echo Line ----
  await prisma.problem.upsert({
    where: { id: IDS.problemEcho },
    update: {
      title: 'Echo Line',
      description: 'Echo stdin to stdout, unchanged.',
      difficulty: 'easy',
    },
    create: {
      id: IDS.problemEcho,
      title: 'Echo Line',
      description: 'Echo stdin to stdout, unchanged.',
      difficulty: 'easy',
    },
  });

  await upsertTestCase({
    id: IDS.tc.echo1,
    problemId: IDS.problemEcho,
    input: 'hello world\n',
    expectedOutput: 'hello world\n',
    hidden: false,
    weight: 1,
    ordering: 0,
  });
  await upsertTestCase({
    id: IDS.tc.echoHidden,
    problemId: IDS.problemEcho,
    input: 'the quick brown fox\n',
    expectedOutput: 'the quick brown fox\n',
    hidden: true,
    weight: 1,
    ordering: 1,
  });

  // The "ugly" row (see UGLY_PAYLOAD above): multi-byte unicode + control chars.
  await upsertTestCase({
    id: IDS.tc.echoUgly,
    problemId: IDS.problemEcho,
    input: UGLY_PAYLOAD,
    expectedOutput: UGLY_PAYLOAD,
    hidden: true,
    weight: 3,
    ordering: 2,
  });

  console.log('Seed complete:');
  console.log(
    `  users:     ${student.email} (STUDENT), ${teacher.email} (TEACHER)`,
  );
  console.log('  problems:  Sum of Two Numbers, Echo Line');
  console.log(
    '  testCases: 6 (incl. hidden rows + 1 ugly unicode/control-char row)',
  );
  console.log(
    `  ugly row bytes: ${Buffer.byteLength(UGLY_PAYLOAD)} (id ${IDS.tc.echoUgly})`,
  );
}

async function upsertTestCase(tc: {
  id: string;
  problemId: string;
  input: string;
  expectedOutput: string;
  hidden: boolean;
  weight: number;
  ordering: number;
}): Promise<void> {
  const { id, ...rest } = tc;
  await prisma.testCase.upsert({
    where: { id },
    update: rest,
    create: { id, ...rest },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
