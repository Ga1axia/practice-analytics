const FIRM_EMAIL_SUFFIX = '@mdesignsarchitects.com';

export function isMDesignsWorkEmail(email: string | null | undefined): boolean {
  const norm = (email || '').trim().toLowerCase();
  return norm.endsWith(FIRM_EMAIL_SUFFIX);
}
