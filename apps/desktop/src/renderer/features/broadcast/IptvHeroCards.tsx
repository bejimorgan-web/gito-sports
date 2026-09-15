import { useEffect, useState } from "react";

import type { DesktopChannel, DesktopMovie, DesktopSeries } from "../../../desktop-persistence-contract";

export type IptvHeroContentType = "live" | "movies" | "series" | "favorites";

interface IptvHeroCardsProps {
  providerId: string;
  selectedContentType: IptvHeroContentType;
  favoriteCount: number;
  onSelectContentType: (contentType: IptvHeroContentType) => void;
}

export function IptvHeroCards({ providerId, selectedContentType, favoriteCount, onSelectContentType }: IptvHeroCardsProps) {
  const [counts, setCounts] = useState({ live: 0, movies: 0, series: 0 });

  useEffect(() => {
    let cancelled = false;
    const desktopStorage = window.gito?.desktopStorage;
    if (!providerId || !desktopStorage?.channels?.list || !desktopStorage.movies?.list || !desktopStorage.series?.list) {
      setCounts({ live: 0, movies: 0, series: 0 });
      return () => { cancelled = true; };
    }

    void Promise.all([
      desktopStorage.channels.list(providerId),
      desktopStorage.movies.list(providerId),
      desktopStorage.series.list(providerId)
    ]).then(([channels, movies, series]) => {
      if (cancelled) return;
      setCounts({
        live: channels.filter((channel: DesktopChannel) => channel.contentType === "live").length,
        movies: (movies as DesktopMovie[]).length,
        series: (series as DesktopSeries[]).length
      });
    }).catch(() => {
      if (!cancelled) setCounts({ live: 0, movies: 0, series: 0 });
    });

    return () => { cancelled = true; };
  }, [providerId]);

  return (
    <div className="priority-strip simplified-priority-strip content-type-strip">
      {[
        { key: "live" as const, label: "Live TV", icon: "📺", count: `${counts.live} channels` },
        { key: "movies" as const, label: "Movies", icon: "🎬", count: `${counts.movies} movies` },
        { key: "series" as const, label: "Series", icon: "📺", count: `${counts.series} series` },
        { key: "favorites" as const, label: "Favorites", icon: "⭐", count: `${favoriteCount} saved` }
      ].map((option) => {
        const selected = selectedContentType === option.key;
        return (
          <button
            key={option.key}
            type="button"
            className={`priority-card ${selected ? "live" : ""}`}
            onClick={() => onSelectContentType(option.key)}
            style={{
              textAlign: "left",
              cursor: "pointer",
              border: selected ? "1px solid #4ad7ff" : "1px solid #243649",
              background: selected ? "rgba(74, 215, 255, 0.12)" : "rgba(8, 16, 24, 0.85)",
              boxShadow: selected && option.key === "favorites" ? "0 0 0 1px rgba(74, 215, 255, 0.2) inset" : undefined
            }}
          >
            <span style={{ fontSize: "1.1rem" }}>{option.icon}</span>
            <strong>{option.label}</strong>
            <span style={{ color: "#8fa1b3", fontSize: "0.8rem" }}>{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}
