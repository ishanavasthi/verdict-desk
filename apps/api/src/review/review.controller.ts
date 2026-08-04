import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReviewQueueItem, ReviewService } from './review.service';

@Controller('review')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TEACHER')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  /** All PENDING_REVIEW answers joined to their doubts, newest first — data for a side-by-side review UI. */
  @Get('queue')
  async queue(): Promise<ReviewQueueItem[]> {
    return this.review.queue();
  }
}
