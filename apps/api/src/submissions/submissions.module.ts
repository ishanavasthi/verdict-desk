import { Module } from '@nestjs/common';
import { SandboxModule } from '../sandbox/sandbox.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionQueueService } from './submission-queue.service';

@Module({
  imports: [SandboxModule],
  controllers: [SubmissionsController],
  providers: [SubmissionQueueService],
  exports: [SubmissionQueueService],
})
export class SubmissionsModule {}
