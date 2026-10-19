// "Need help?" line (batch B6). Email always; Discord only when SUPPORT_DISCORD_URL is an
// https URL (passed in from the server, so the browser never reads env).
import type { SupportInfo } from "@/lib/support";

export function SupportLine({ support, className = "" }: { support: SupportInfo; className?: string }) {
  return (
    <p className={`text-center text-[13px] leading-relaxed text-[var(--text-tertiary)] ${className}`} data-support-line>
      Need help?{" "}
      <a href={`mailto:${support.email}`} className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]">
        {support.email}
      </a>
      {support.discord && (
        <>
          {" "}<span aria-hidden>·</span>{" "}
          <a href={support.discord} target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]">
            Discord
          </a>
        </>
      )}
    </p>
  );
}
