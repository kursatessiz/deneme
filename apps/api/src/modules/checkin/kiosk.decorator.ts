import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { KioskContext, KioskRequest } from './kiosk-context';

export const Kiosk = createParamDecorator((_data: unknown, ctx: ExecutionContext): KioskContext => {
  const kiosk = ctx.switchToHttp().getRequest<KioskRequest>().kiosk;
  if (!kiosk) throw new InternalServerErrorException('Kiosk used without KioskAuthGuard');
  return kiosk;
});
