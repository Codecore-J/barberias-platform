import { IsDateString, IsOptional } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;
}
