import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { ReadinessService } from './readiness.service';

@ApiTags('系统')
@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}
  @Get('health/ready')
  @Public()
  @ApiOperation({ summary: '数据库就绪检查；故障或超时返回503' })
  ready() {
    return this.readiness.check();
  }
  @Get('health')
  @Public()
  @ApiOperation({ summary: '健康检查' })
  check() {
    return {
      status: 'ok',
      service: 'partneros-crm-api',
      version: '0.2.0-demo.2',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
