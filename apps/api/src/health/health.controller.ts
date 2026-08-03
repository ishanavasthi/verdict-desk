import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestId } from '../common/request-id.middleware';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(@Req() req: Request): Promise<{
    status: 'ok';
    db: 'up' | 'down';
    requestId: string;
  }> {
    const healthy = await this.prisma.isHealthy();
    return {
      status: 'ok',
      db: healthy ? 'up' : 'down',
      requestId: getRequestId(req),
    };
  }
}
