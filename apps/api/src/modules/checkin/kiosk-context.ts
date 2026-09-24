/** Resolved by KioskAuthGuard for /kiosk/* routes. Distinct from TenantContext:
 * a kiosk is a device, not a staff member, and can only reach kiosk endpoints. */
export interface KioskContext {
  deviceId: string;
  studioId: string;
  branchId: string;
}

export interface KioskRequest {
  kiosk?: KioskContext;
  headers: Record<string, string | string[] | undefined>;
}

export interface KioskTokenClaims {
  sub: string;
  typ: 'kiosk';
  studioId: string;
  branchId: string;
}
