import { IsOptional, IsUUID } from 'class-validator';

export class ListSubmissionsQueryDto {
  @IsOptional()
  @IsUUID()
  problemId?: string;
}
