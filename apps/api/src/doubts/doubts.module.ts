import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { DoubtsController } from './doubts.controller';
import { AiDraftPipeline } from './ai-draft.pipeline';

// PrismaService is provided by the @Global PrismaModule (imported in
// AppModule). AiModule is imported so LlmService can be injected into
// AiDraftPipeline; AuthModule so JwtAuthGuard can be injected into
// DoubtsController.
@Module({
  imports: [AuthModule, AiModule],
  controllers: [DoubtsController],
  providers: [AiDraftPipeline],
  exports: [AiDraftPipeline],
})
export class DoubtsModule {}
