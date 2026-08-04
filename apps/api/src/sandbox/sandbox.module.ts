import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SandboxRunnerService } from './runner.service';
import { GradingService } from './grading.service';

@Module({
  imports: [AiModule],
  providers: [SandboxRunnerService, GradingService],
  exports: [SandboxRunnerService, GradingService],
})
export class SandboxModule {}
