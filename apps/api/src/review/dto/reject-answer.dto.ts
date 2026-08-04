import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Not persisted anywhere (the fixed M0 schema's ReviewAudit has no free-text column) — see ReviewService.reject. */
export const MAX_REJECT_REASON_CHARS = 1000;

export class RejectAnswerDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REJECT_REASON_CHARS)
  reason?: string;
}
