import { Injectable, Logger } from '@nestjs/common';
import { sourcemapPathCandidates } from '@platform/shared';
import { symbolicateStack } from './sourcemap-decoder';
import { SourcemapStoreService } from './sourcemap-store.service';

/**
 * Resolves the minified stack of a client (web or mobile) event with the
 * source maps uploaded for its release. Never throws: no maps, an unknown
 * release or a malformed map simply leave the stack unresolved (null).
 */
@Injectable()
export class SymbolicationService {
  private readonly logger = new Logger(SymbolicationService.name);

  constructor(private readonly maps: SourcemapStoreService) {}

  async symbolicate(event: { source: string; release: string; stack: string | null }): Promise<string | null> {
    if (!event.stack || (event.source !== 'web' && event.source !== 'mobile')) return null;
    const platform = event.source;
    try {
      return await symbolicateStack(event.stack, (url) => this.maps.find(platform, event.release, sourcemapPathCandidates(url)));
    } catch (err) {
      this.logger.warn(`Symbolication failed: ${err instanceof Error ? err.name : 'unknown'}`);
      return null;
    }
  }
}
