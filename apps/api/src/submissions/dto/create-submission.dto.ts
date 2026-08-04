import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** 64 KB cap on submitted source — generous for a grading exercise, small enough to bound abuse. */
export const MAX_CODE_LENGTH = 64 * 1024;

export class CreateSubmissionDto {
  @IsUUID()
  problemId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @IsOptional()
  @IsIn(['JS'])
  language?: 'JS';

  /**
   * M1 STOPGAP ONLY: JWT auth is a later milestone. Until then, callers MAY
   * pass a `userId` explicitly (handy for tests / scripts/abuse-demo.sh);
   * otherwise the controller falls back to the seeded `student@verdict.dev`
   * user. Remove this field once real auth lands and derive the user from
   * the authenticated session instead.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
