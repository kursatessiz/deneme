import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { apiError, apiErrorWithCode, codedError, hasApiErrorCode } from './api-error';
import { withStatusCode } from '../modules/error-reporting/error-capture.filter';

describe('apiError', () => {
  it('carries the key as code and the Turkish text as message', () => {
    expect(apiError('apiErrors.common.memberNotFound')).toEqual({ code: 'apiErrors.common.memberNotFound', message: 'Üye bulunamadı' });
  });

  it('interpolates params into the message and passes them on', () => {
    const body = apiError('apiErrors.growth.invalidOperator', { op: 'foo' });
    expect(body).toEqual({ code: 'apiErrors.growth.invalidOperator', message: 'Geçersiz işlem: foo', params: { op: 'foo' } });
  });

  it('picks the plural form from count', () => {
    expect(apiError('apiErrors.members.freezeDaysExceeded', { count: 30 }).message).toBe('Bu paket en fazla 30 gün dondurulabilir.');
  });

  it('is sent unchanged as the exception response', () => {
    const exception = new NotFoundException(apiError('apiErrors.common.memberNotFound'));
    expect(exception.getResponse()).toEqual({ code: 'apiErrors.common.memberNotFound', message: 'Üye bulunamadı' });
    expect(exception.message).toBe('Üye bulunamadı');
    expect(exception.getStatus()).toBe(404);
  });
});

describe('apiErrorWithCode', () => {
  it('keeps the older code and puts the key in messageKey', () => {
    expect(apiErrorWithCode('TRANSLATION_JOB_ACTIVE', 'apiErrors.ai.translationJobActive', undefined, { jobId: 'j1' })).toEqual({
      jobId: 'j1',
      code: 'TRANSLATION_JOB_ACTIVE',
      messageKey: 'apiErrors.ai.translationJobActive',
      message: 'Bu dil için süren bir çeviri işi var.',
    });
  });
});

describe('codedError', () => {
  it('takes the Turkish message from the translation the code already has', () => {
    const body = codedError('RETAIL_PRODUCT_NOT_FOUND', { statusCode: 404 });
    expect(body).toEqual({ statusCode: 404, code: 'RETAIL_PRODUCT_NOT_FOUND', message: 'Ürün bulunamadı.' });
  });

  it('falls back to the code for an unknown one', () => {
    expect(codedError('SOMETHING_ELSE').message).toBe('SOMETHING_ELSE');
  });
});

describe('hasApiErrorCode', () => {
  it('matches the code of an HttpException body', () => {
    const exception = new BadRequestException(apiError('apiErrors.schedules.sessionFull'));
    expect(hasApiErrorCode(exception, 'apiErrors.schedules.sessionFull')).toBe(true);
    expect(hasApiErrorCode(exception, 'apiErrors.common.memberNotFound')).toBe(false);
    expect(hasApiErrorCode(new Error('x'), 'apiErrors.schedules.sessionFull')).toBe(false);
    expect(hasApiErrorCode(new BadRequestException('plain'), 'apiErrors.schedules.sessionFull')).toBe(false);
  });
});

describe('withStatusCode', () => {
  it('adds the statusCode to a coded body that has none', () => {
    const wrapped = withStatusCode(new NotFoundException(apiError('apiErrors.common.memberNotFound')));
    expect(wrapped).toBeInstanceOf(HttpException);
    expect((wrapped as HttpException).getResponse()).toEqual({ statusCode: 404, code: 'apiErrors.common.memberNotFound', message: 'Üye bulunamadı' });
    expect((wrapped as HttpException).getStatus()).toBe(404);
  });

  it('leaves other errors untouched', () => {
    const plain = new NotFoundException('x');
    const hasStatus = new BadRequestException({ statusCode: 400, code: 'X', message: 'm' });
    const other = new Error('boom');
    expect(withStatusCode(plain)).toBe(plain);
    expect(withStatusCode(hasStatus)).toBe(hasStatus);
    expect(withStatusCode(other)).toBe(other);
  });
});
