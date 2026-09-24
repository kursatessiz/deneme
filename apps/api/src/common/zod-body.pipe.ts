import { BadRequestException, Body, PipeTransform, Query } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/** Validates with a shared Zod schema and returns 400 with field messages. */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Geçersiz istek',
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

export const ZodBody = <T extends ZodTypeAny>(schema: T) => Body(new ZodValidationPipe(schema));

/** Same as ZodBody for the whole query string. */
export const ZodQuery = <T extends ZodTypeAny>(schema: T) => Query(new ZodValidationPipe(schema));
