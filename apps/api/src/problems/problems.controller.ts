import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: string | null;
}

export interface SampleTestCase {
  input: string;
  expectedOutput: string;
}

export interface ProblemDetail {
  id: string;
  title: string;
  description: string;
  difficulty: string | null;
  sampleTestCases: SampleTestCase[];
}

@Controller('problems')
export class ProblemsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<ProblemSummary[]> {
    const problems = await this.prisma.problem.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, difficulty: true },
    });
    return problems;
  }

  /**
   * PUBLIC. `sampleTestCases` is ONLY the non-hidden test cases — hidden
   * cases' input/expectedOutput must never be exposed here.
   */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ProblemDetail> {
    const problem = await this.prisma.problem.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        difficulty: true,
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
      sampleTestCases: problem.testCases,
    };
  }
}
