import type { trMCheckIn } from '../tr/mCheckIn';

export const enMCheckIn: Record<keyof typeof trMCheckIn, string> = {
  'mCheckIn.cameraPermissionRequired': 'Camera permission required',
  'mCheckIn.grantPermission': 'Grant permission',
  'mCheckIn.checkedIn': 'Checked in',
  'mCheckIn.newScan': 'New scan',
  'mCheckIn.cancel': 'Cancel',
  'mCheckIn.ok': 'OK',
  'mCheckIn.errors.checkInFailed': 'Check-in failed.',
  'mCheckIn.errors.qrFetchFailed': 'QR code could not be retrieved.',
  'mCheckIn.errors.qrScanFailed': 'QR code could not be read.',
  'mCheckIn.qrIleGiris.title': 'Check in with QR',
  'mCheckIn.qrIleGiris.subtitle': 'Have reception or the kiosk scan this code. It refreshes automatically.',
  'mCheckIn.qrIleGiris.scanStudioQr': "Scan the studio's QR",
  'mCheckIn.studyoQrTara.permissionHint': 'Grant camera access to scan the studio QR code.',
  'mCheckIn.studyoQrTara.bookingMarkedCheckedIn': 'Your booking has been marked as checked in.',
  'mCheckIn.studyoQrTara.alignQr': 'Align the QR code at the studio entrance within the frame.',
  'mCheckIn.resepsiyonTarama.memberBookingCheckedIn': "The member's booking has been marked as checked in.",
  'mCheckIn.resepsiyonTarama.todaysBookings': "Today's bookings",
  'mCheckIn.resepsiyonTarama.multipleBookingsHint': 'The member has more than one matching booking, pick one.',
  'mCheckIn.resepsiyonTarama.alignMemberQr': "Align the member's app QR code within the frame.",
};
