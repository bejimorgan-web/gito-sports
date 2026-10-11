import { resolveAssetUrl } from "./asset-url";

export function TeamCrest({ name, logoUrl }: { name: string; logoUrl?: string | null | undefined }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return (
    <span className="team-crest" aria-hidden="true">
      <span>{initials}</span>
      {logoUrl ? <img src={resolveAssetUrl(logoUrl)} alt="" onError={(event) => event.currentTarget.remove()} /> : null}
    </span>
  );
}