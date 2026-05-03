/**
 * Admin email allowlist. Comma-separated list of emails authorized to perform
 * site-wide moderator actions (e.g. flipping any feedback post's status).
 *
 * Reads `NEXT_PUBLIC_ADMIN_EMAILS` so both server and client share the same
 * source of truth — the FE uses it to gate UI, the API still re-checks
 * authoritatively against the signed-in user's email.
 *
 * Defaults to `ksy@egongegong.com` so an unset env in dev still works.
 */
const RAW = process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "ksy@egongegong.com";

export const ADMIN_EMAILS: readonly string[] = RAW.split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
