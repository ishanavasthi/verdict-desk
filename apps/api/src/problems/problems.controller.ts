import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: string | null;
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
}
