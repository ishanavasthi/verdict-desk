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
}
