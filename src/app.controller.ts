import { Controller, Get } from '@nestjs/common';

/**
 * Liveness endpoints.
 *
 * The platform pings the service root to decide whether it is up. With no route
 * mapped there, every one of those pings was logged as an unhandled
 * NotFoundException, which buried real errors in the deploy log.
 */
@Controller()
export class AppController {
  @Get()
  root(): { service: string; status: string } {
    return { service: 'connect-four-server', status: 'ok' };
  }

  @Get('health')
  health(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
