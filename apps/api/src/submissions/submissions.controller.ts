import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionQueueService } from './submission-queue.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';

// M1 STOPGAP: JWT auth is a later milestone (see CreateSubmissionDto.userId doc).
const STOPGAP_STUDENT_EMAIL = 'student@verdict.dev';

export interface CreateSubmissionResponse {
  id: string;
  status: string;
}

export interface TestResultView {
  testCaseId: string;
  status: string;
  stdout: string;
  stderr: string;
  timeMs: number;
}

export interface SubmissionView {
  id: string;
  problemId: string;
  status: string;
  score: number | null;
  results: TestResultView[];
}

@Controller('submissions')
export class SubmissionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: SubmissionQueueService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateSubmissionDto): Promise<CreateSubmissionResponse> {
    const userId = dto.userId ?? (await this.resolveStopgapUserId());

    const submission = await this.prisma.submission.create({
      data: {
        problemId: dto.problemId,
        userId,
        code: dto.code,
        language: dto.language ?? 'JS',
        status: 'QUEUED',
      },
    });

    this.queue.enqueue(submission.id);

    return { id: submission.id, status: submission.status };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<SubmissionView> {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { testResults: true },
    });
    if (!submission) {
      throw new NotFoundException(`submission ${id} not found`);
    }

    return {
      id: submission.id,
      problemId: submission.problemId,
      status: submission.status,
      score: submission.score,
      // TODO(M2): redact hidden test cases (join TestCase.hidden and strip stdout/stderr/input for hidden rows).
      results: submission.testResults.map((r) => ({
        testCaseId: r.testCaseId,
        status: r.status,
        stdout: r.stdout,
        stderr: r.stderr,
        timeMs: r.timeMs,
      })),
    };
  }

  /**
   * M1 STOPGAP: no JWT auth yet. Resolve the fixed seeded student so
   * `POST /submissions` works end-to-end today; a later milestone replaces
   * this with the authenticated user from the request.
   */
  private async resolveStopgapUserId(): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email: STOPGAP_STUDENT_EMAIL } });
    if (!user) {
      throw new NotFoundException(
        `seeded stopgap user "${STOPGAP_STUDENT_EMAIL}" not found — run \`pnpm --filter @verdict/api seed\` or pass an explicit userId`,
      );
    }
    return user.id;
  }
}
