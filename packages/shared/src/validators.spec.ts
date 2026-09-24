import {
  LoginSchema,
  CreateMemberSchema,
  CreatePackageDefinitionSchema,
  CreateScheduleSchema,
  BookSessionSchema,
  CancelBookingSchema,
  EntitlementKind,
  PaymentMethod,
} from './index';

describe('Shared Zod Validators', () => {
  describe('LoginSchema', () => {
    it('should validate valid email and password', () => {
      const input = {
        emailOrPhone: 'elif@zenpilates.com',
        password: 'password123',
      };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate valid phone and password', () => {
      const input = {
        emailOrPhone: '05551112233',
        password: 'password123',
      };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should fail if password is too short (< 6 chars)', () => {
      const input = {
        emailOrPhone: '05551112233',
        password: '123',
      };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('en az 6 karakter');
      }
    });
  });

  describe('CreateMemberSchema', () => {
    const validMember = {
      studioId: '123e4567-e89b-12d3-a456-426614174000',
      firstName: 'Ayşe',
      lastName: 'Demir',
      phone: '05553334455',
      email: 'ayse@example.com',
      medicalConditions: 'L4-L5 Bel Fıtığı başlangıcı',
    };

    it('should validate a full valid member profile', () => {
      const result = CreateMemberSchema.safeParse(validMember);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for studioId', () => {
      const result = CreateMemberSchema.safeParse({
        ...validMember,
        studioId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should normalize the phone number to E.164', () => {
      const result = CreateMemberSchema.parse(validMember);
      expect(result.phone).toBe('+905553334455');
    });

    it('should reject invalid phone format if too short', () => {
      const result = CreateMemberSchema.safeParse({
        ...validMember,
        phone: '123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreatePackageDefinitionSchema', () => {
    const base = {
      studioId: '123e4567-e89b-12d3-a456-426614174000',
      name: '10 Seans Birebir',
      entitlementKind: EntitlementKind.SESSION_COUNT,
      totalUnits: 10,
      validityDays: 60,
      price: 12000,
      services: [{ serviceTypeId: '123e4567-e89b-12d3-a456-426614174001', unitCost: 1 }],
    };

    it('should validate a session-count package', () => {
      expect(CreatePackageDefinitionSchema.safeParse(base).success).toBe(true);
    });

    it('should allow a time-based unlimited package without units', () => {
      const { totalUnits: _omit, ...rest } = base;
      const result = CreatePackageDefinitionSchema.safeParse({
        ...rest,
        entitlementKind: EntitlementKind.TIME_UNLIMITED,
      });
      expect(result.success).toBe(true);
    });

    it('should require units for credit packages', () => {
      const { totalUnits: _omit, ...rest } = base;
      const result = CreatePackageDefinitionSchema.safeParse({ ...rest, entitlementKind: EntitlementKind.CREDIT });
      expect(result.success).toBe(false);
    });

    it('should reject negative price and empty service list', () => {
      expect(CreatePackageDefinitionSchema.safeParse({ ...base, price: -500 }).success).toBe(false);
      expect(CreatePackageDefinitionSchema.safeParse({ ...base, services: [] }).success).toBe(false);
    });
  });

  describe('CancelBookingSchema', () => {
    it('should accept valid cancellation request', () => {
      const input = {
        bookingId: '123e4567-e89b-12d3-a456-426614174000',
        cancelledBy: 'MEMBER',
        reason: 'Hastalık mazereti',
      };
      const result = CancelBookingSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});

import { PinSchema, isWeakPin } from './validators';

describe('PIN rules', () => {
  it.each(['000000', '111111', '123456', '234567', '890123', '654321', '109876'])('rejects weak PIN %s', (pin) => {
    expect(isWeakPin(pin)).toBe(true);
    expect(PinSchema.safeParse(pin).success).toBe(false);
  });

  it.each(['482915', '100200', '731946'])('accepts %s', (pin) => {
    expect(PinSchema.safeParse(pin).success).toBe(true);
  });

  it.each(['12345', '1234567', 'abcdef', '12 345'])('rejects malformed %s', (pin) => {
    expect(PinSchema.safeParse(pin).success).toBe(false);
  });
});
