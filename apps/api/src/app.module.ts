import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { ProblemsModule } from './problems/problems.module';
import { SandboxModule } from './sandbox/sandbox.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { DoubtsModule } from './doubts/doubts.module';
import { ReviewModule } from './review/review.module';
import { AppLogger } from './common/app-logger.service';
import { RequestIdMiddleware } from './common/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    ProblemsModule,
    SandboxModule,
    SubmissionsModule,
    AiModule,
    AuthModule,
    DoubtsModule,
    ReviewModule,
  ],
  providers: [AppLogger],
  exports: [AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
