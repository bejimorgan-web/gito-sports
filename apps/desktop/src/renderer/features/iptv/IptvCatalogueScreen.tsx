import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";

interface Props {
  providerId: string;
}

type Category = { id: string; name: string; slug?: string | null };
type Item = { id: string; title: string; description?: string | null; categoryId?: string | null; category?: { name: string } | null; posterUrl?: string | null };
type LiveItem = { id: string; name: string; groupName?: string; categoryId?: string | null };
type Season = { id: string; seriesId: string; seasonNumber?: number | null; name?: string | null };
type Episode = { id: string; title?: string | null; episodeNumber?: number | null; playbackReference: string };
type GuideProgramme = { title: string; description?: string | null; startAt?: string | null; endAt?: string | null; externalProgrammeId: string };

export function IptvCatalogueScreen({ providerId }: Props) {
  const [liveCategories, setLiveCategories] = useState<Category[]>([]);
  const [movieCategories, setMovieCategories] = useState<Category[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<Category[]>([]);
  const [liveChannels, setLiveChannels] = useState<LiveItem[]>([]);
  const [movies, setMovies] = useState<Item[]>([]);
  const [series, setSeries] = useState<Item[]>([]);
  const [contentType, setContentType] = useState<"live" | "movie" | "series">("live");
  const [selectedItem, setSelectedItem] = useState<Item | LiveItem>();
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [guide, setGuide] = useState<GuideProgramme[]>([]);
  const [catalogueTotals, setCatalogueTotals] = useState({ live: 0, movie: 0, series: 0 });
  const [guideStatus, setGuideStatus] = useState("Select a channel or movie.");
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
      setCatalogueTotals({ live: liveItems.total, movie: movieItems.total, series: seriesItems.total });
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
      setStatus("Catalogue loaded from the provider catalogue.");
    }).catch(() => {
      if (!cancelled) setStatus("Unable to load catalogue groups.");
    });
    return () => { cancelled = true; };
  }, [providerId]);

  useEffect(() => {
    setSelectedItem(undefined);
    setSeasons([]);
    setEpisodes([]);
    setGuide([]);
    setGuideStatus("Select a channel or movie.");
  }, [contentType, providerId]);

  useEffect(() => {
    if (contentType !== "series" || !selectedItem || !("title" in selectedItem)) return;
    void apiClient.listIptvSeasons(providerId, selectedItem.id).then((data) => {
      setSeasons(data);
      setSelectedSeasonId(data[0]?.id ?? "");
    }).catch(() => setSeasons([]));
  }, [contentType, providerId, selectedItem]);

  useEffect(() => {
    if (contentType !== "series" || !selectedSeasonId) {
      setEpisodes([]);
      return;
    }
    void apiClient.listIptvEpisodes(providerId, selectedSeasonId).then((data) => setEpisodes(data.items)).catch(() => setEpisodes([]));
  }, [contentType, providerId, selectedSeasonId]);

  useEffect(() => {
    if (contentType !== "live" || !selectedItem || !("name" in selectedItem)) {
      setGuide([]);
      return;
    }
    setGuideStatus("Loading EPG...");
    void apiClient.listIptvEpgChannels(providerId).then(async (channels) => {
      const channel = channels.items.find((item) => item.name === selectedItem.name || item.channelId === selectedItem.id);
      if (!channel) {
        setGuide([]);
        setGuideStatus("No EPG data for this channel.");
        return;
      }
      const programmes = await apiClient.listIptvEpgProgrammes(providerId, channel.id, false, true);
      setGuide(programmes.items);
      setGuideStatus(programmes.items.length ? "Upcoming programmes" : "No upcoming programmes.");
    }).catch(() => setGuideStatus("Unable to load EPG."));
  }, [contentType, providerId, selectedItem]);

  const groups = (categories: Category[], items: Item[]) => categories.map((category) => ({
    ...category,
    items: items.filter((item) => item.category?.name === category.name || item.categoryId === category.id)
  }));

  const liveGroups = useMemo(() => liveCategories.map((category) => ({
    ...category,
    items: liveChannels.filter((channel) => channel.groupName === category.name || channel.categoryId === category.id)
  })), [liveCategories, liveChannels]);
  const movieGroups = useMemo(() => groups(movieCategories, movies), [movieCategories, movies]);
  const seriesGroups = useMemo(() => groups(seriesCategories, series), [seriesCategories, series]);
  const counts = catalogueTotals;
  const activeGroups: Array<Category & { items: Array<Item | LiveItem> }> = contentType === "live"
    ? liveGroups
    : contentType === "movie"
    ? movieGroups
    : seriesGroups;
  const activeTotal = contentType === "live" ? counts.live : contentType === "movie" ? counts.movie : counts.series;

  return (
    <section className="console-panel iptv-catalogue-panel">
      <div className="panel-heading">
        <h3>IPTV Content Browser</h3>
        <span>{status}</span>
      </div>
      <div className="iptv-catalogue-counts">
        <button type="button" className={contentType === "live" ? "active" : ""} onClick={() => setContentType("live")}><strong>{counts.live}</strong><span>Channels</span></button>
        <button type="button" className={contentType === "movie" ? "active" : ""} onClick={() => setContentType("movie")}><strong>{counts.movie}</strong><span>Movies</span></button>
        <button type="button" className={contentType === "series" ? "active" : ""} onClick={() => setContentType("series")}><strong>{counts.series}</strong><span>Series</span></button>
      </div>
      <div className={`iptv-browser-grid iptv-browser-${contentType}`}>
        <aside className="iptv-browser-groups">
          <h4>{contentType === "live" ? "Channel Groups" : contentType === "movie" ? "Movie Groups" : "Series Groups"}</h4>
          {activeGroups.map((group) => (
            <button type="button" key={group.id} className="iptv-group-button">
              <span>{group.name}</span><small>{group.items.length}</small>
            </button>
          ))}
          {!activeGroups.length ? <p className="field-note">No groups saved.</p> : null}
        </aside>
        <section className="iptv-browser-items">
          <h4>{activeTotal} {contentType === "live" ? "channels" : contentType === "movie" ? "movies" : "series"}</h4>
          {activeGroups.flatMap((group) => group.items).map((item) => {
            const itemId = "name" in item ? item.id : item.id;
            const title = "name" in item ? item.name : item.title;
            return <button type="button" key={itemId} className={selectedItem && selectedItem.id === itemId ? "selected" : ""} onClick={() => setSelectedItem(item)}><strong>{title}</strong><small>{"name" in item ? (item.groupName || "Uncategorized") : (item.category?.name || "Uncategorized")}</small></button>;
          })}
        </section>
        <aside className="iptv-channel-guide">
          <h4>{contentType === "live" ? "Channel Guide" : contentType === "movie" ? "Movie Guide" : "Series Guide"}</h4>
          {contentType === "series" && selectedItem ? <select value={selectedSeasonId} onChange={(event) => setSelectedSeasonId(event.target.value)}><option value="">Select season</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name || `Season ${season.seasonNumber ?? ""}`}</option>)}</select> : null}
          {contentType === "series" ? episodes.map((episode) => <div className="iptv-guide-entry" key={episode.id}><strong>Episode {episode.episodeNumber ?? ""}: {episode.title || "Untitled"}</strong><small>{episode.playbackReference}</small></div>) : guide.length ? guide.map((programme) => <div className="iptv-guide-entry" key={programme.externalProgrammeId}><strong>{programme.title}</strong><small>{programme.startAt ? new Date(programme.startAt).toLocaleString() : ""}</small><span>{programme.description || ""}</span></div>) : selectedItem && contentType === "movie" ? <p>{(selectedItem as Item).description || "No description supplied by the provider."}</p> : <p className="field-note">{guideStatus}</p>}
        </aside>
      </div>
    </section>
  );
}
