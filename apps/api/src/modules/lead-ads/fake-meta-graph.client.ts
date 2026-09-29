import { Injectable } from '@nestjs/common';
import type { MetaLead } from '@platform/shared';
import type { FetchLeadResult, MetaGraphClient, PageSubscriptionResult } from './meta-graph.client';

/**
 * In-memory Graph client for tests: leads are registered by id, a lead can
 * be told to fail (transient or permanent) a number of times, and every
 * call is recorded. Nothing here touches the network.
 */
@Injectable()
export class FakeMetaGraphClient implements MetaGraphClient {
  readonly fetchCalls: { accessToken: string; leadgenId: string }[] = [];
  readonly subscriptionCalls: { accessToken: string; pageId: string }[] = [];
  private readonly leads = new Map<string, MetaLead>();
  private readonly failures = new Map<string, { remaining: number; transient: boolean; status: number }>();
  private readonly subscribed = new Map<string, boolean>();

  addLead(lead: MetaLead): void {
    this.leads.set(lead.id, lead);
  }

  /** The next `times` fetches of this lead fail; `transient` decides whether a retry is worthwhile. */
  failLead(leadgenId: string, times: number, transient: boolean, status = transient ? 503 : 403): void {
    this.failures.set(leadgenId, { remaining: times, transient, status });
  }

  setSubscribed(pageId: string, value: boolean): void {
    this.subscribed.set(pageId, value);
  }

  reset(): void {
    this.fetchCalls.length = 0;
    this.subscriptionCalls.length = 0;
    this.leads.clear();
    this.failures.clear();
    this.subscribed.clear();
  }

  async fetchLead(accessToken: string, leadgenId: string): Promise<FetchLeadResult> {
    this.fetchCalls.push({ accessToken, leadgenId });
    const failure = this.failures.get(leadgenId);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      return { ok: false, transient: failure.transient, status: failure.status, message: `Graph HTTP ${failure.status}` };
    }
    const lead = this.leads.get(leadgenId);
    if (!lead) return { ok: false, transient: false, status: 404, message: 'Graph HTTP 404' };
    return { ok: true, lead };
  }

  async checkPageSubscription(accessToken: string, pageId: string): Promise<PageSubscriptionResult> {
    this.subscriptionCalls.push({ accessToken, pageId });
    return { ok: true, subscribed: this.subscribed.get(pageId) ?? false };
  }
}
