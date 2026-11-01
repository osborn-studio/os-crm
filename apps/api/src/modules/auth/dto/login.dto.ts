import { IsString, IsNotEmpty, MinLength, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[A-Za-z][A-Za-z0-9_-]{1,29}$/)
  tenantCode?: string;

  @ApiProperty({ example: 'linxinlan', description: '登录用户名' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]{2,50}$/)
  username!: string;

  @ApiProperty({ example: 'Abc@2026', description: '密码' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(5, { message: '密码至少5位' })
  @MaxLength(128)
  password!: string;
}
