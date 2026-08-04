import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { ApproveAnswerDto } from './dto/approve-answer.dto';
import { RejectAnswerDto } from './dto/reject-answer.dto';
import { EditAnswerDto } from './dto/edit-answer.dto';
import { ReviewService } from './review.service';

export interface AnswerActionResponse {
  id: string;
  state: string;
}

/** Teacher-only answer review actions (TEACHER-only via @Roles + RolesGuard). */
@Controller('answers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TEACHER')
export class AnswersController {
  constructor(private readonly review: ReviewService) {}

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveAnswerDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AnswerActionResponse> {
    await this.review.approve(id, user.id, dto.editedContent);
    return { id, state: 'APPROVED' };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectAnswerDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AnswerActionResponse> {
    await this.review.reject(id, user.id, dto.reason);
    return { id, state: 'REJECTED' };
  }

  @Post(':id/edit')
  @HttpCode(HttpStatus.OK)
  async edit(
    @Param('id') id: string,
    @Body() dto: EditAnswerDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AnswerActionResponse> {
    await this.review.edit(id, user.id, dto.editedContent);
    return { id, state: 'PENDING_REVIEW' };
  }
}
