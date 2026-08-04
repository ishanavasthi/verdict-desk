import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Persisted to `Answer.reviewNote` — see ReviewService.reject. 8 KB cap,
 * matching the other review free-text inputs (editedContent).
 */
export const MAX_REJECT_REASON_CHARS = 8 * 1024;

export class RejectAnswerDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REJECT_REASON_CHARS)
  reason?: string;
}
