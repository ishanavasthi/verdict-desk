import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: string | null;
  kind: string;
}

export interface SampleTestCase {
  input: string;
  expectedOutput: string;
}

export interface McqOption {
  id: string;
  text: string;
}

export interface ProblemDetail {
  id: string;
  title: string;
  description: string;
  difficulty: string | null;
  kind: string;
  options: McqOption[] | null;
  sampleTestCases: SampleTestCase[];
}

@Controller('problems')
export class ProblemsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<ProblemSummary[]> {
    const problems = await this.prisma.problem.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, difficulty: true, kind: true },
    });
    return problems;
  }

  /**
   * PUBLIC. `sampleTestCases` is ONLY the non-hidden test cases — hidden
   * cases' input/expectedOutput must never be exposed here. `answerKey` is a
   * server-side secret (same status as hidden expected outputs) and is NEVER
   * selected. `options` is returned as-is for MCQ, null otherwise.
   *
   * `ParseUUIDPipe` rejects a malformed id with a 400 BEFORE it reaches
   * Postgres — otherwise the driver raises a P2023 whose message carries
   * internal detail. This route is UNAUTHENTICATED, so it is the most exposed
   * place that could happen.
   */
  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<ProblemDetail> {
    const problem = await this.prisma.problem.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        difficulty: true,
        kind: true,
        options: true,
        testCases: {
          where: { hidden: false },
          orderBy: { ordering: 'asc' },
          select: { input: true, expectedOutput: true },
        },
      },
    });
    if (!problem) {
      throw new NotFoundException(`problem ${id} not found`);
    }

    return {
      id: problem.id,
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      kind: problem.kind,
      options: problem.kind === 'MCQ' ? (problem.options as unknown as McqOption[]) : null,
      sampleTestCases: problem.testCases,
    };
  }
}
