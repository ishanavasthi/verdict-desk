import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewController } from './review.controller';
import { AnswersController } from './answers.controller';
import { ReviewService } from './review.service';

// PrismaService is provided by the @Global PrismaModule. AuthModule is
// imported so JwtAuthGuard/RolesGuard can be injected into both controllers.
@Module({
  imports: [AuthModule],
  controllers: [ReviewController, AnswersController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
