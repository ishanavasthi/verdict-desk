import { IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_EDITED_CONTENT_CHARS } from '../../doubts/sanitize';

export class EditAnswerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_EDITED_CONTENT_CHARS)
  editedContent!: string;
}
