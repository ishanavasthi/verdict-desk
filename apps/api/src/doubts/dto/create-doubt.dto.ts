import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const MAX_DOUBT_TITLE_LENGTH = 200;
/** Cap on doubt body length — generous for a question, small enough to bound abuse. */
export const MAX_DOUBT_BODY_LENGTH = 4000;

export class CreateDoubtDto {
  @IsOptional()
  @IsUUID()
  problemId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_DOUBT_TITLE_LENGTH)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_DOUBT_BODY_LENGTH)
  body!: string;
}
