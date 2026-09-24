import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { PartnersWebhookService } from './partners-webhook.service';

/**
 * Inbound partner webhook receiver. No JWT: the partner authenticates with
 * its own HMAC signature (x-partner-signature, x-partner-timestamp),
 * verified against the connection's stored secret. `:connectionId` picks
 * which studio and credentials to verify against; `:provider` is checked
 * against the connection's own provider so a URL cannot be reused across
 * providers.
 */
@Controller('partners/:provider/webhook/:connectionId')
export class PartnersWebhookController {
  constructor(private readonly webhook: PartnersWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Param('connectionId') connectionId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ) {
    const rawBody = JSON.stringify(body ?? {});
    return this.webhook.handle(provider, connectionId, headers, rawBody);
  }
}
