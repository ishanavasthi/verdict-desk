import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_EDITED_CONTENT_CHARS } from '../../doubts/sanitize';

export class ApproveAnswerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_EDITED_CONTENT_CHARS)
  editedContent?: string;
}
