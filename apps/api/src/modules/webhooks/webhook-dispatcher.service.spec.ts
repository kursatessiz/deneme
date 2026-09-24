import { EventEmitter } from 'events';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';
import * as ssrfCheck from './ssrf-check';
import * as https from 'https';

jest.mock('./ssrf-check');
jest.mock('https');

const resolvePublicHttpsAddressesMock = ssrfCheck.resolvePublicHttpsAddresses as jest.Mock;
const httpsRequestMock = https.request as unknown as jest.Mock;

/**
 * A trustworthy webhook delivery must connect to the exact IP address that
 * was validated by resolvePublicHttpsAddresses(), not whatever address a
 * second, independent DNS lookup happens to return -- otherwise an attacker
 * who controls the endpoint hostname's DNS can answer the validation lookup
 * with a public IP and the connection's own lookup, moments later, with a
 * private one (DNS rebinding), defeating the SSRF check entirely.
 */
describe('WebhookDispatcherService - DNS rebinding protection', () => {
  let service: WebhookDispatcherService;
  let prisma: any;

  const pendingDelivery = {
    id: 'delivery-1',
    endpointId: 'endpoint-1',
    event: 'booking.created',
    payload: { hello: 'world' },
    attempt: 0,
    endpoint: { id: 'endpoint-1', url: 'https://example.com/hook', secret: 'whsec_test', isActive: true, failureCount: 0 },
  };

  function mockSuccessfulResponse() {
    const req = new EventEmitter() as any;
    req.write = jest.fn();
    req.end = jest.fn();
    req.destroy = jest.fn();

    httpsRequestMock.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      // Respond asynchronously, like a real socket would.
      process.nextTick(() => {
        callback(res);
        res.emit('data', Buffer.from('ok'));
        res.emit('end');
      });
      return req;
    });
    return req;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      webhookDelivery: { findMany: jest.fn(), update: jest.fn() },
      webhookEndpoint: { update: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
    service = new WebhookDispatcherService(prisma as unknown as PrismaService);
  });

  it('pins the connection to the address validated by resolvePublicHttpsAddresses, ignoring the hostname passed to lookup', async () => {
    resolvePublicHttpsAddressesMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([pendingDelivery]);
    mockSuccessfulResponse();

    await service.dispatchDue();

    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    const options = httpsRequestMock.mock.calls[0][0];
    expect(typeof options.lookup).toBe('function');

    // Whatever hostname is passed in (even a spoofed one an attacker's own
    // stack might substitute), the pinned lookup must answer with the one
    // address that was actually validated -- never re-resolve it.
    const callback = jest.fn();
    options.lookup('example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);

    const spoofed = jest.fn();
    options.lookup('some-other-hostname-an-attacker-might-substitute.test', {}, spoofed);
    expect(spoofed).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('never calls the DNS-validating resolver more than once per delivery attempt', async () => {
    resolvePublicHttpsAddressesMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([pendingDelivery]);
    mockSuccessfulResponse();

    await service.dispatchDue();

    expect(resolvePublicHttpsAddressesMock).toHaveBeenCalledTimes(1);
  });

  it('fails the delivery (never connects) when the resolved address is rejected as private', async () => {
    resolvePublicHttpsAddressesMock.mockRejectedValue(new Error('Webhook adresi özel veya ayrılmış bir IP adresine işaret edemez'));
    prisma.webhookDelivery.findMany.mockResolvedValue([pendingDelivery]);
    prisma.webhookDelivery.update.mockResolvedValue({});
    prisma.webhookEndpoint.update.mockResolvedValue({});

    const outcome = await service.dispatchDue();

    expect(httpsRequestMock).not.toHaveBeenCalled();
    expect(outcome.failed + outcome.abandoned).toBe(1);
  });
});
