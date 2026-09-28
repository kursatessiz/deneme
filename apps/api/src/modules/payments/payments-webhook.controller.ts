import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * Provider webhook receiver. No JWT: providers authenticate with their own
 * signature scheme, verified per adapter in PaymentsService.handleWebhook.
 * `:provider` picks the adapter (mock | iyzico | paytr) so a webhook from
 * any configured provider is verified against the right secret, whatever
 * the studio's own default provider is.
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private payments: PaymentsService) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ) {
    // Stripe's route is parsed by the raw-body middleware (body-parsers.ts):
    // its signature is computed over the exact bytes, which a re-serialised
    // JSON body would not reproduce. Every other provider keeps the JSON
    // parser's parsed body, re-stringified as before.
    const rawBody = Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body ?? {});
    return this.payments.handleWebhook(provider, headers, rawBody);
  }
}
