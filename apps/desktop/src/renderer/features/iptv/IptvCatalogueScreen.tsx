import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";

interface Props {
  providerId: string;
}

type Category = { id: string; name: string; slug?: string | null };
type Item = { id: string; title: string; categoryId?: string | null; category?: { name: string } | null; posterUrl?: string | null };
type LiveItem = { id: string; name: string; groupName?: string; categoryId?: string | null };

export function IptvCatalogueScreen({ providerId }: Props) {
  const [liveCategories, setLiveCategories] = useState<Category[]>([]);
  const [movieCategories, setMovieCategories] = useState<Category[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<Category[]>([]);
  const [liveChannels, setLiveChannels] = useState<LiveItem[]>([]);
  const [movies, setMovies] = useState<Item[]>([]);
  const [series, setSeries] = useState<Item[]>([]);
  const [status, setStatus] = useState("Loading catalogue groups...");

  useEffect(() => {
    let cancelled = false;
    setStatus("Loading catalogue groups...");
    void Promise.all([
      apiClient.listIptvCatalogueCategories(providerId, "live"),
      apiClient.listIptvCatalogueCategories(providerId, "movie"),
      apiClient.listIptvCatalogueCategories(providerId, "series"),
      apiClient.listChannelPage(providerId, { page: 1, pageSize: 100 }),
      apiClient.listIptvMovies(providerId),
      apiClient.listIptvSeries(providerId)
    ]).then(([live, movie, seriesGroup, liveItems, movieItems, seriesItems]) => {
      if (cancelled) return;
      setLiveCategories(live.items);
      setMovieCategories(movie.items);
      setSeriesCategories(seriesGroup.items);
      setLiveChannels(liveItems.items.map((channel) => {
        const categoryId = (channel as typeof channel & { categoryId?: string }).categoryId;
        return {
          id: channel.id,
          name: channel.name,
          ...(channel.groupName ? { groupName: channel.groupName } : {}),
          ...(categoryId ? { categoryId } : {})
        };
      }));
      setMovies(movieItems.items);
      setSeries(seriesItems.items);
      setStatus("Catalogue groups loaded from the canonical database.");
    }).catch(() => {
      if (!cancelled) setStatus("Unable to load catalogue groups.");
    });
    return () => { cancelled = true; };
  }, [providerId]);

  const groups = (categories: Category[], items: Item[]) => categories.map((category) => ({
    ...category,
    items: items.filter((item) => item.category?.name === category.name || item.categoryId === category.id)
  }));

  return (
    <section className="console-panel iptv-catalogue-panel">
      <div className="panel-heading">
        <h3>Provider Catalogue Groups</h3>
        <span>{status}</span>
      </div>
      <div className="iptv-catalogue-columns">
        <CatalogueGroup title="Live Groups" groups={liveCategories.map((category) => ({ ...category, items: liveChannels.filter((channel) => channel.groupName === category.name || channel.categoryId === category.id).map((channel) => ({ id: channel.id, title: channel.name })) }))} />
        <CatalogueGroup title="Movie Groups" groups={groups(movieCategories, movies)} />
        <CatalogueGroup title="Series Groups" groups={groups(seriesCategories, series)} />
      </div>
    </section>
  );
}

function CatalogueGroup({ title, groups }: { title: string; groups: Array<Category & { items: Item[] }> }) {
  return (
    <article className="iptv-catalogue-column">
      <h4>{title}</h4>
      {groups.length === 0 ? <p className="field-note">No groups saved.</p> : groups.map((group) => (
        <div className="iptv-catalogue-group" key={group.id}>
          <strong>{group.name}</strong>
          <small>{group.items.length} item{group.items.length === 1 ? "" : "s"}</small>
          {group.items.slice(0, 8).map((item) => <span key={item.id}>{item.title}</span>)}
        </div>
      ))}
    </article>
  );
}
