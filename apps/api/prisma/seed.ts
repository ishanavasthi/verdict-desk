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
import { PrismaClient, Prisma, Role, QuestionKind } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, 'data');

interface DataOption {
  id: string;
  text: string;
}

interface DataTestCase {
  input: string;
  expectedOutput: string;
  hidden: boolean;
  weight: number;
  ordering: number;
}

interface DataProblem {
  kind: 'CODE' | 'MCQ' | 'INTEGER';
  title: string;
  description: string;
  difficulty: 'easy' | 'medium';
  options: DataOption[] | null;
  answerKey: string | null;
  testCases: DataTestCase[] | null;
}

interface DataFile {
  source: string;
  license: string | null;
  problems: DataProblem[];
}

/** Minimal schema-shape + cap validation for a single problem entry. Throws on failure. */
function validateDataProblem(file: string, p: unknown, index: number): DataProblem {
  const ctx = `${file} problems[${index}]`;
  if (typeof p !== 'object' || p === null) {
    throw new Error(`${ctx}: not an object`);
  }
  const problem = p as Record<string, unknown>;

  if (!['CODE', 'MCQ', 'INTEGER'].includes(problem.kind as string)) {
    throw new Error(`${ctx}: invalid kind "${String(problem.kind)}"`);
  }
  if (typeof problem.title !== 'string' || problem.title.trim().length === 0) {
    throw new Error(`${ctx}: missing/invalid title`);
  }
  if (typeof problem.description !== 'string' || problem.description.length === 0) {
    throw new Error(`${ctx} (${problem.title}): missing/invalid description`);
  }
  if (problem.description.length > 2500) {
    throw new Error(`${ctx} (${problem.title}): description exceeds 2500 chars`);
  }
  if (!['easy', 'medium'].includes(problem.difficulty as string)) {
    throw new Error(`${ctx} (${problem.title}): invalid difficulty`);
  }

  const kind = problem.kind as DataProblem['kind'];

  if (kind === 'MCQ') {
    if (!Array.isArray(problem.options) || problem.options.length === 0) {
      throw new Error(`${ctx} (${problem.title}): MCQ requires options`);
    }
    const ids = new Set<string>();
    for (const opt of problem.options as unknown[]) {
      if (
        typeof opt !== 'object' ||
        opt === null ||
        typeof (opt as Record<string, unknown>).id !== 'string' ||
        typeof (opt as Record<string, unknown>).text !== 'string'
      ) {
        throw new Error(`${ctx} (${problem.title}): malformed MCQ option`);
      }
      ids.add((opt as Record<string, unknown>).id as string);
    }
    if (typeof problem.answerKey !== 'string' || !ids.has(problem.answerKey)) {
      throw new Error(`${ctx} (${problem.title}): answerKey not among option ids`);
    }
  } else if (kind === 'INTEGER') {
    if (typeof problem.answerKey !== 'string' || !/^-?\d+$/.test(problem.answerKey)) {
      throw new Error(`${ctx} (${problem.title}): INTEGER answerKey must be an integer string`);
    }
  } else {
    // CODE
    if (!Array.isArray(problem.testCases) || problem.testCases.length === 0) {
      throw new Error(`${ctx} (${problem.title}): CODE requires testCases`);
    }
    if (problem.testCases.length > 8) {
      throw new Error(`${ctx} (${problem.title}): more than 8 testCases`);
    }
    let hasVisible = false;
    let hasHidden = false;
    for (const tc of problem.testCases as unknown[]) {
      if (typeof tc !== 'object' || tc === null) {
        throw new Error(`${ctx} (${problem.title}): malformed testCase`);
      }
      const t = tc as Record<string, unknown>;
      if (typeof t.input !== 'string' || typeof t.expectedOutput !== 'string') {
        throw new Error(`${ctx} (${problem.title}): testCase input/expectedOutput must be strings`);
      }
      if (Buffer.byteLength(t.input) > 4096 || Buffer.byteLength(t.expectedOutput) > 4096) {
        throw new Error(`${ctx} (${problem.title}): testCase input/expectedOutput exceeds 4KB`);
      }
      if (typeof t.hidden !== 'boolean') {
        throw new Error(`${ctx} (${problem.title}): testCase.hidden must be boolean`);
      }
      if (t.hidden) hasHidden = true;
      else hasVisible = true;
    }
    if (!hasVisible || !hasHidden) {
      throw new Error(
        `${ctx} (${problem.title}): CODE requires at least 1 visible AND 1 hidden testCase`,
      );
    }
  }

  return problem as unknown as DataProblem;
}

function loadDataFiles(): DataProblem[] {
  if (!fs.existsSync(DATA_DIR)) {
    return [];
  }
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const problems: DataProblem[] = [];
  for (const file of files) {
    const fullPath = path.join(DATA_DIR, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (e) {
      throw new Error(`${file}: invalid JSON (${(e as Error).message})`);
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).source !== 'string' ||
      !Array.isArray((parsed as Record<string, unknown>).problems)
    ) {
      throw new Error(`${file}: does not match the data-file schema`);
    }
    const data = parsed as DataFile;
    data.problems.forEach((p, i) => {
      problems.push(validateDataProblem(file, p, i));
    });
  }
  return problems;
}

/**
 * Upserts a data-driven problem by title (not a DB-level unique constraint,
 * hence findFirst + create/update rather than prisma.problem.upsert). Test
 * cases are created only when the problem is newly created — existing
 * TestCase rows are never mutated or deleted on re-seed, matching the
 * idempotency approach used for the inline seed problems above.
 */
async function upsertDataProblem(p: DataProblem): Promise<void> {
  const existing = await prisma.problem.findFirst({ where: { title: p.title } });

  const scalarFields = {
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    kind: p.kind as QuestionKind,
    // `options` is a Json? column: Prisma's input type is InputJsonValue, which
    // doesn't accept a typed object array directly (no string index signature).
    options: (p.options ?? undefined) as Prisma.InputJsonValue | undefined,
    answerKey: p.answerKey,
  };

  if (existing) {
    await prisma.problem.update({ where: { id: existing.id }, data: scalarFields });
    return;
  }

  const created = await prisma.problem.create({ data: scalarFields });

  if (p.kind === 'CODE' && p.testCases) {
    for (const tc of p.testCases) {
      await prisma.testCase.create({
        data: {
          problemId: created.id,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          hidden: tc.hidden,
          weight: tc.weight,
          ordering: tc.ordering,
        },
      });
    }
  }
}

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
  problemDockerMcq: '33333333-3333-4333-8333-333333333333',
  problemTreeInteger: '44444444-4444-4444-8444-444444444444',
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

  // ---- Problem 3: Docker Network Isolation (MCQ) ----
  await prisma.problem.upsert({
    where: { id: IDS.problemDockerMcq },
    update: {
      title: 'Docker Network Isolation',
      description: 'Which `docker run` flag disables all networking for a container?',
      difficulty: 'easy',
      kind: 'MCQ',
      options: [
        { id: 'a', text: '--network none' },
        { id: 'b', text: '--isolate' },
        { id: 'c', text: '--no-net' },
        { id: 'd', text: '--offline' },
      ],
      answerKey: 'a',
    },
    create: {
      id: IDS.problemDockerMcq,
      title: 'Docker Network Isolation',
      description: 'Which `docker run` flag disables all networking for a container?',
      difficulty: 'easy',
      kind: 'MCQ',
      options: [
        { id: 'a', text: '--network none' },
        { id: 'b', text: '--isolate' },
        { id: 'c', text: '--no-net' },
        { id: 'd', text: '--offline' },
      ],
      answerKey: 'a',
    },
  });

  // ---- Problem 4: Complete Binary Tree Nodes (INTEGER) ----
  await prisma.problem.upsert({
    where: { id: IDS.problemTreeInteger },
    update: {
      title: 'Complete Binary Tree Nodes',
      description:
        'A complete binary tree has height 4 (a lone root has height 0). How many nodes are in the tree in total?',
      difficulty: 'easy',
      kind: 'INTEGER',
      answerKey: '31',
    },
    create: {
      id: IDS.problemTreeInteger,
      title: 'Complete Binary Tree Nodes',
      description:
        'A complete binary tree has height 4 (a lone root has height 0). How many nodes are in the tree in total?',
      difficulty: 'easy',
      kind: 'INTEGER',
      answerKey: '31',
    },
  });

  // ---- Data-driven problems (apps/api/prisma/data/*.json) ----
  const dataProblems = loadDataFiles();
  for (const p of dataProblems) {
    await upsertDataProblem(p);
  }

  console.log('Seed complete:');
  console.log(
    `  users:     ${student.email} (STUDENT), ${teacher.email} (TEACHER)`,
  );
  console.log(
    '  problems:  Sum of Two Numbers, Echo Line, Docker Network Isolation (MCQ), Complete Binary Tree Nodes (INTEGER)',
  );
  console.log(
    '  testCases: 6 (incl. hidden rows + 1 ugly unicode/control-char row)',
  );
  console.log(
    `  ugly row bytes: ${Buffer.byteLength(UGLY_PAYLOAD)} (id ${IDS.tc.echoUgly})`,
  );
  console.log(`  data-driven problems loaded: ${dataProblems.length}`);
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
