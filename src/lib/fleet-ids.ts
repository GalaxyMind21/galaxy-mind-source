/**
 * fleet-ids · our marketplace listing ids, read from server-only env when the module loads. The repository carries
 * none (pre-public cleanup, 2026-10-19).
 *
 *   GALAXY_MIND_RIG_IDS      every listing the /hashrate desk reads, in roster order, comma-separated. A house machine
 *                            that is not an S21 XP carries its model: "123456=Avalon Q".
 *   GALAXY_MIND_XP_UNIT_IDS  the 270 TH/s units (#01-#30) in fleet order, comma-separated. The only ids a per-unit
 *                            link may carry (lib/mrr-units.ts).
 *
 * An entry that is not exactly six digits is dropped, and so is a repeat. Unset = an empty roster: the pages show no
 * machines rather than invented ones. Order matters (bays and units are numbered by position).
 */
const ID = /^\d{6}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;

export type RigRoster = { ids: string[]; hardware: Record<string, string> };

export function parseRigRoster(raw: string | undefined): RigRoster {
  const ids: string[] = [];
  const hardware: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [idRaw, ...rest] = part.split("=");
    const id = (idRaw ?? "").trim();
    if (!ID.test(id) || ids.includes(id)) continue;
    ids.push(id);
    const model = rest.join("=").trim();
    if (model && MODEL.test(model)) hardware[id] = model;
  }
  return { ids, hardware };
}

export function parseIdList(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const id = part.trim();
    if (ID.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export const RIG_ROSTER: RigRoster = parseRigRoster(process.env.GALAXY_MIND_RIG_IDS);
export const XP_UNIT_IDS_FROM_ENV: readonly string[] = parseIdList(process.env.GALAXY_MIND_XP_UNIT_IDS);
