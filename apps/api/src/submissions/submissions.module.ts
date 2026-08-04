import { Module } from '@nestjs/common';
import { SandboxModule } from '../sandbox/sandbox.module';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionQueueService } from './submission-queue.service';

@Module({
  imports: [SandboxModule, AuthModule, AiModule],
  controllers: [SubmissionsController],
  providers: [SubmissionQueueService],
  exports: [SubmissionQueueService],
})
export class SubmissionsModule {}
