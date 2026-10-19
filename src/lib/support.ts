/**
 * Support contact (batch B6). The email always shows. Discord shows only when
 * SUPPORT_DISCORD_URL is set to an https URL (unset until the invite is made public).
 */
export const SUPPORT_EMAIL = "galaxymind@mail.grokbot.com";

export function supportDiscordUrl(env: Record<string, string | undefined> = process.env): string | null {
  const u = (env.SUPPORT_DISCORD_URL ?? "").trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(u)) return null;
  try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; }
}

export type SupportInfo = { email: string; discord: string | null };
export function supportInfo(env: Record<string, string | undefined> = process.env): SupportInfo {
  return { email: SUPPORT_EMAIL, discord: supportDiscordUrl(env) };
}
