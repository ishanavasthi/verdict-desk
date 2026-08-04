import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { AiFeedbackService } from './feedback.service';

// PrismaService is provided by the @Global PrismaModule (imported in
// AppModule), so it doesn't need to be re-imported here.
@Module({
  providers: [LlmService, AiFeedbackService],
  exports: [LlmService, AiFeedbackService],
})
export class AiModule {}
