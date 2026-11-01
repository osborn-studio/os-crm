import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';

/** Public, constant-query probe. No tenant records, credentials or driver errors are returned. */
@Injectable()
export class ReadinessService {
  private inFlight?: Promise<boolean>;
  private sample?: { time: number; healthy: boolean };
  constructor(private readonly prisma: PrismaService) {}
  async check() {
    let probe: Promise<boolean>;
    if (this.sample && Date.now() - this.sample.time < 1000) probe = Promise.resolve(this.sample.healthy);
    else {
      // A slow database cannot create an unbounded queue of health queries.
      this.inFlight ??= Promise.resolve()
        .then(() => this.prisma.system.$queryRaw`SELECT 1`)
        .then(
          () => true,
          () => false,
        )
        .then((healthy) => {
          this.sample = { time: Date.now(), healthy };
          return healthy;
        })
        .finally(() => {
          this.inFlight = undefined;
        });
      probe = this.inFlight;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 2000);
    });
    try {
      if (!(await Promise.race([probe, timeout]))) throw new ServiceUnavailableException('服务尚未就绪');
      return { status: 'ready', service: 'partneros-crm-api', database: 'reachable' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
