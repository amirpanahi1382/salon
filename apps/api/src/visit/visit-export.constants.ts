export const VISIT_EXPORT_MAX_ROWS = 5000;
export const VISIT_EXPORT_FILENAME = 'visits.xlsx';
export const VISIT_EXPORT_SHEET_NAME = 'مراجعات';
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const VISIT_EXPORT_HEADERS = [
  'نام مشتری',
  'خدمت انجام‌شده',
  'مبلغ دریافتی',
  'تاریخ مراجعه',
  'مدت زمان از مراجعه قبلی (روز)',
] as const;
