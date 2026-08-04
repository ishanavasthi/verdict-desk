import { Module } from '@nestjs/common';
import { SandboxRunnerService } from './runner.service';
import { GradingService } from './grading.service';

@Module({
  providers: [SandboxRunnerService, GradingService],
  exports: [SandboxRunnerService, GradingService],
})
export class SandboxModule {}
