export type CataloguePreviewMetadata = { title?: string; description?: string | null; currentProgramme?: GuideProgramme | null; guide: GuideProgramme[] };
import { useEffect, useMemo, useState } from "react";
import type { Channel } from "@gito/shared";
import React from "react";

interface Props {
  providerId: string;
  selectedChannel?: Channel | undefined;
  onSelectChannel?: (channel: Channel) => void;
  onSelectPlaybackEntity?: (entity: { entityType: "movie" | "episode"; entityId: string }) => void;
  contentType?: "live" | "movies" | "series" | "favorites";
  favoriteChannelIds?: string[];
  showContentTypeCounts?: boolean;
  onPreviewMetadataChange?: (metadata: CataloguePreviewMetadata) => void;
}
type Category = { id: string; name: string; providerCategoryId?: string | null; externalReference?: string | null; slug?: string | null };
type Item = { id: string; providerId?: string; title: string; description?: string | null; categoryId?: string | null; category?: { name: string } | null; posterUrl?: string | null };
type LiveItem = Channel;
type Season = { id: string; seriesId: string; seasonNumber?: number | null; name?: string | null };
type Episode = { id: string; seriesId: string; seasonId: string | null; title?: string | null; episodeNumber?: number | null };
type GuideProgramme = { title: string; description?: string | null; startAt?: string | null; endAt?: string | null; externalProgrammeId: string };
const EMPTY_FAVORITE_CHANNEL_IDS: string[] = [];

export function IptvCatalogueScreen({ providerId, selectedChannel, onSelectChannel, onSelectPlaybackEntity, contentType: requestedContentType = "live", favoriteChannelIds = EMPTY_FAVORITE_CHANNEL_IDS, showContentTypeCounts = true, onPreviewMetadataChange }: Props) {
  const [liveCategories, setLiveCategories] = useState<Category[]>([]);
  const [movieCategories, setMovieCategories] = useState<Category[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<Category[]>([]);
  const [liveChannels, setLiveChannels] = useState<LiveItem[]>([]);
  const [movies, setMovies] = useState<Item[]>([]);
  const [series, setSeries] = useState<Item[]>([]);
  const [contentType, setContentType] = useState<"live" | "movie" | "series">(requestedContentType === "movies" ? "movie" : requestedContentType === "series" ? "series" : "live");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedGroupItems, setSelectedGroupItems] = useState<Array<Item | LiveItem>>([]);
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});
  const [selectedItem, setSelectedItem] = useState<Item | LiveItem>();
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [guide, setGuide] = useState<GuideProgramme[]>([]);
  const [catalogueTotals, setCatalogueTotals] = useState({ live: 0, movie: 0, series: 0 });
  const [guideStatus, setGuideStatus] = useState("Select a channel or movie.");
  const [status, setStatus] = useState("Loading catalogue groups...");
  useEffect(() => {
    setContentType(requestedContentType === "movies" ? "movie" : requestedContentType === "series" ? "series" : "live");
  }, [requestedContentType]);

  useEffect(() => {
    setStatus(`Loading ${providerId ? "catalogue" : "provider"}...`);
    setLiveCategories([]);
    setMovieCategories([]);
    setSeriesCategories([]);
    setLiveChannels([]);
    setMovies([]);
    setSeries([]);
    setSelectedGroupId("");
    setSelectedGroupItems([]);
    setGroupCounts({});
    setSelectedItem(undefined);
    setSelectedSeasonId("");
    setSeasons([]);
    setEpisodes([]);
    setGuide([]);
    setGuideStatus("Select a channel or movie.");
    onPreviewMetadataChange?.({ guide: [] });
    setCatalogueTotals({ live: 0, movie: 0, series: 0 });
  }, [onPreviewMetadataChange, providerId]);

  const mapLiveItem = (
    item: {
      id: string;
      providerId?: string;
      providerAccountId?: string;
      externalRef?: string | null;
      externalReference?: string | null;
      name: string;
      categoryId?: string | null;
      category?: { name: string } | null;
      groupName?: string | null;
      playbackReference?: string | null;
      playbackUrl?: string | null;
      url?: string | null;
      logoUrl?: string | null;
      metadataJson?: string | null;
      status?: string;
    },
    liveCategories: Category[] = []
  ): LiveItem => {
    const categoryMatch = liveCategories.find((category) =>
      (category.externalReference && item.groupName === category.externalReference) ||
      category.name === item.groupName ||
      category.id === item.groupName
    );
    const providerId = item.providerId ?? item.providerAccountId ?? "";
    const categoryId = item.categoryId ?? categoryMatch?.id ?? null;
    const groupName = categoryMatch?.name ?? item.category?.name ?? item.groupName ?? item.categoryId ?? null;
    const externalRef = item.externalRef ?? item.externalReference ?? undefined;
    const mapped: LiveItem = {
      id: item.id,
      providerId,
      name: item.name,
      url: item.url ?? item.playbackReference ?? item.playbackUrl ?? "",
      contentType: "live",
      status: (item.status as Channel["status"]) ?? "active",
      createdAt: "",
      updatedAt: "",
      ...(categoryId ? { categoryId } : {}),
      ...(groupName ? { groupName } : {}),
      ...(item.logoUrl ? { logoUrl: item.logoUrl } : {})
    };
    if (item.metadataJson) {
      try {
        const metadata = JSON.parse(item.metadataJson) as { playbackHeaders?: Channel["playbackHeaders"] };
        if (metadata.playbackHeaders) mapped.playbackHeaders = metadata.playbackHeaders;
      } catch {
        // Ignore malformed optional playback metadata.
      }
    }

    if (externalRef) {
      mapped.externalRef = externalRef;
    }

    return mapped;
  };

  useEffect(() => {
    let cancelled = false;
    const requestProviderId = providerId;
    if (!requestProviderId) {
      setStatus("Select a saved IPTV provider to browse its catalogue.");
      return () => { cancelled = true; };
    }

    setStatus("Loading catalogue groups...");
    const localCatalogueRuntime = window.gito?.desktopStorage as any;
    const liveChannelsPromise = localCatalogueRuntime?.channels?.list
      ? localCatalogueRuntime.channels.list(requestProviderId) : Promise.resolve([]);
    const liveCategoriesPromise = localCatalogueRuntime?.categories?.list
      ? localCatalogueRuntime.categories.list(requestProviderId, "live") : Promise.resolve([]);
    void Promise.all([liveCategoriesPromise, liveChannelsPromise]).then(([live, liveItems]) => {
      if (cancelled || requestProviderId !== providerId) return;
      const mapCategory = (category: { id: string; name: string; externalReference?: string | null }) => ({ id: category.id, name: category.name, providerCategoryId: category.externalReference ?? null, externalReference: category.externalReference ?? null });
      const mappedLiveCategories = live.map(mapCategory);
      const mappedLiveChannels = liveItems.map((item: any) => mapLiveItem(item, mappedLiveCategories)).filter((channel: LiveItem) => requestedContentType !== "favorites" || favoriteChannelIds.includes(channel.id));
      setCatalogueTotals({ live: mappedLiveChannels.length, movie: 0, series: 0 });
      setLiveCategories(mappedLiveCategories);
      setLiveChannels(mappedLiveChannels);
      setMovieCategories([]);
      setSeriesCategories([]);
      setMovies([]);
      setSeries([]);
      const activeChannel = selectedChannel && mappedLiveChannels.find((channel: LiveItem) => channel.id === selectedChannel.id);
      if (activeChannel) {
        setSelectedItem(activeChannel);
        setSelectedGroupId(activeChannel.categoryId ?? activeChannel.groupName ?? "");
      }
      setStatus("Catalogue loaded from the desktop provider catalogue.");
    }).catch((error) => {
      if (!cancelled && requestProviderId === providerId) setStatus(error instanceof Error ? error.message : "Unable to load IPTV catalogue data.");
    });
    return () => { cancelled = true; };
  }, [favoriteChannelIds, providerId, requestedContentType, selectedChannel]);

  useEffect(() => {
    if (!selectedChannel || selectedChannel.providerId !== providerId) return;
    const activeChannel = liveChannels.find((channel) => channel.id === selectedChannel.id);
    if (!activeChannel) return;
    setSelectedItem(activeChannel);
    setSelectedGroupId(activeChannel.categoryId ?? activeChannel.groupName ?? "");
  }, [liveChannels, providerId, selectedChannel]);

  useEffect(() => {
    setSelectedItem(undefined);
    setSelectedGroupId("");
    setSelectedGroupItems([]);
    setSeasons([]);
    setEpisodes([]);
    setGuide([]);
    setGuideStatus("Select a live channel.");
    onPreviewMetadataChange?.({ guide: [] });
  }, [contentType, onPreviewMetadataChange, providerId]);

  useEffect(() => {
    if (contentType !== "series" || !selectedItem || !("title" in selectedItem)) {
      setSeasons([]);
      setSelectedSeasonId("");
      return;
    }

    const requestProviderId = providerId;
    const requestSeriesId = selectedItem.id;
    let cancelled = false;

    const localStorage = window.gito?.desktopStorage;
    if (!localStorage?.seasons.list) {
      setSeasons([]);
      setSelectedSeasonId("");
      return () => { cancelled = true; };
    }
    void localStorage.seasons.list(requestProviderId, requestSeriesId).then((data) => {
      if (cancelled || requestProviderId !== providerId || requestSeriesId !== selectedItem.id) return;
      setSeasons(data);
      setSelectedSeasonId(data[0]?.id ?? "");
    }).catch(() => {
      if (!cancelled && requestProviderId === providerId && requestSeriesId === selectedItem.id) {
        setSeasons([]);
        setSelectedSeasonId("");
      }
    });

    return () => { cancelled = true; };
  }, [contentType, providerId, selectedItem]);

  useEffect(() => {
    if (contentType !== "series" || !selectedSeasonId) {
      setEpisodes([]);
      return;
    }

    const requestProviderId = providerId;
    const requestSeasonId = selectedSeasonId;
    let cancelled = false;

    const localStorage = window.gito?.desktopStorage;
    if (!localStorage?.episodes.list) {
      setEpisodes([]);
      return () => { cancelled = true; };
    }
    void localStorage.episodes.list(requestProviderId, selectedItem && "title" in selectedItem ? selectedItem.id : undefined, requestSeasonId).then((data) => {
      if (cancelled || requestProviderId !== providerId || requestSeasonId !== selectedSeasonId) return;
      setEpisodes(data.map((episode) => ({ id: episode.id, seriesId: episode.seriesId, seasonId: episode.seasonId, title: episode.name, episodeNumber: episode.episodeNumber })));
    }).catch(() => {
      if (!cancelled && requestProviderId === providerId && requestSeasonId === selectedSeasonId) {
        setEpisodes([]);
      }
    });

    return () => { cancelled = true; };
  }, [contentType, providerId, selectedItem, selectedSeasonId]);

  useEffect(() => {
    if (contentType !== "live" || !selectedItem || !("name" in selectedItem)) {
      setGuide([]);
      setGuideStatus("Select a channel or movie.");
      return;
    }

    const requestProviderId = providerId;
    const requestItemId = selectedItem.id;
    const requestItemName = selectedItem.name;
    const requestItemExternalRef = "externalRef" in selectedItem ? selectedItem.externalRef : undefined;
    let cancelled = false;

    setGuideStatus("Loading EPG...");
    const desktopStorage = window.gito?.desktopStorage;
    if (!desktopStorage?.epgChannels?.list || !desktopStorage?.epgProgrammes?.list) {
      setGuide([]);
      setGuideStatus("Unable to load EPG.");
      onPreviewMetadataChange?.({ title: requestItemName, guide: [] });
      return () => { cancelled = true; };
    }

    void desktopStorage.epgChannels.list(requestProviderId).then(async (channels) => {
      if (cancelled || requestProviderId !== providerId || requestItemId !== selectedItem.id) return;
      const channel = channels.find((item) =>
        item.name === requestItemName ||
        item.channelId === requestItemId ||
        item.externalReference === requestItemExternalRef
      );
      if (!channel) {
        if (cancelled || requestProviderId !== providerId || requestItemId !== selectedItem.id) return;
        setGuide([]);
        setGuideStatus("No EPG data for this channel.");
        onPreviewMetadataChange?.({ title: requestItemName, guide: [] });
        return;
      }
      const programmes = await desktopStorage.epgProgrammes.list(requestProviderId, channel.id);
      if (cancelled || requestProviderId !== providerId || requestItemId !== selectedItem.id) return;
      const now = Date.now();
      const upcomingProgrammes = programmes
        .filter((programme) => programme.status === "active" && Date.parse(programme.endAt) > now)
        .map((programme) => ({
          title: programme.title,
          description: programme.description,
          startAt: programme.startAt,
          endAt: programme.endAt,
          externalProgrammeId: programme.externalReference ?? programme.id
        }));
      setGuide(upcomingProgrammes);
      const currentProgramme = upcomingProgrammes.find((programme) => Date.parse(programme.startAt ?? "") <= now);
      onPreviewMetadataChange?.({ title: requestItemName, currentProgramme: currentProgramme ?? null, guide: upcomingProgrammes });
      setGuideStatus(upcomingProgrammes.length ? "Upcoming programmes" : "No upcoming programmes.");
    }).catch(() => {
      if (!cancelled && requestProviderId === providerId && requestItemId === selectedItem.id) {
        setGuide([]);
        setGuideStatus("Unable to load EPG.");
        onPreviewMetadataChange?.({ title: requestItemName, guide: [] });
      }
    });

    return () => { cancelled = true; };
  }, [contentType, onPreviewMetadataChange, providerId, selectedItem]);

  const groups = (categories: Category[], items: Item[]) => categories.map((category) => ({
    ...category,
    items: items.filter((item) => item.category?.name === category.name || item.categoryId === category.id)
  }));

  const effectiveLiveCategories = useMemo(() => {
    if (liveCategories.length > 0) return liveCategories;
    const groups = new Map<string, Category>();
    for (const channel of liveChannels) {
      const groupId = channel.categoryId ?? channel.groupName;
      const groupName = channel.groupName ?? channel.categoryId;
      if (groupId && groupName && !groups.has(groupId)) {
        groups.set(groupId, { id: groupId, providerCategoryId: groupId, name: groupName });
      }
    }
    return [...groups.values()];
  }, [liveCategories, liveChannels]);
  const liveGroups = useMemo(() => effectiveLiveCategories.map((category) => ({
    ...category,
    items: liveChannels.filter((channel) =>
      channel.categoryId === category.id ||
      channel.categoryId === category.providerCategoryId
      || (!channel.categoryId && channel.groupName === category.name)
    )
  })), [effectiveLiveCategories, liveChannels]);
  const movieGroups = useMemo(() => groups(movieCategories, movies), [movieCategories, movies]);
  const seriesGroups = useMemo(() => {
    const categorizedGroups = groups(seriesCategories, series);
    const uncategorizedItems = series.filter((item) => !item.categoryId && !item.category);
    if (uncategorizedItems.length === 0) return categorizedGroups;
    return [...categorizedGroups, { id: "series-uncategorized", name: "Uncategorized", items: uncategorizedItems }];
  }, [seriesCategories, series]);
  const counts = catalogueTotals;
  const activeGroups: Array<Category & { items: Array<Item | LiveItem> }> = contentType === "live"
    ? liveGroups
    : contentType === "movie"
    ? movieGroups
    : seriesGroups;
  const selectedGroup = activeGroups.find((group) => group.id === selectedGroupId) ?? activeGroups[0];

  useEffect(() => {
    if (selectedGroup && selectedGroup.id !== selectedGroupId) {
      setSelectedGroupId(selectedGroup.id);
    }
  }, [selectedGroup?.id, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroup) {
      setSelectedGroupItems([]);
      return;
    }

    const requestProviderId = providerId;
    const categoryId = selectedGroup.id;
    let cancelled = false;
    setSelectedGroupItems([]);

    if (contentType === "live") {
      const favoriteSet = new Set(favoriteChannelIds);
      const items = liveChannels
        .filter((channel) => channel.groupName === selectedGroup.name)
        .filter((channel) => requestedContentType !== "favorites" || favoriteSet.has(channel.id));
      setSelectedGroupItems(items);
      setGroupCounts((current) => ({ ...current, [categoryId]: items.length }));
    } else if (contentType === "movie") {
      const items = movies.filter((movie) => movie.categoryId === categoryId || movie.category?.name === selectedGroup.name);
      setSelectedGroupItems(items);
      setGroupCounts((current) => ({ ...current, [categoryId]: items.length }));
    } else {
      const items = series.filter((item) => categoryId === "series-uncategorized"
        ? !item.categoryId && !item.category
        : item.categoryId === categoryId || item.category?.name === selectedGroup.name);
      setSelectedGroupItems(items);
      setGroupCounts((current) => ({ ...current, [categoryId]: items.length }));
    }
    return () => { cancelled = true; };
  }, [contentType, favoriteChannelIds, liveCategories, movies, providerId, requestedContentType, selectedGroup?.id, selectedGroup?.name, series]);

  return (
    <section className="console-panel iptv-catalogue-panel">
      <div className="panel-heading">
        <h3>Live Sports Channels</h3>
        <span>{status}</span>
      </div>
      {showContentTypeCounts ? <div className="iptv-catalogue-counts">
        <button type="button" className={contentType === "live" ? "active" : ""} onClick={() => setContentType("live")}><strong>{counts.live}</strong><span>Channels</span></button>
      </div> : null}
      <div className={`iptv-browser-grid iptv-browser-${contentType}`}>
        <aside className="iptv-browser-groups">
          <h4>{contentType === "live" ? "Channel Groups" : contentType === "movie" ? "Movie Groups" : "Series Groups"}</h4>
          {activeGroups.map((group) => (
            <button type="button" key={group.id} className={`iptv-group-button ${selectedGroup?.id === group.id ? "selected" : ""}`} onClick={() => { setSelectedGroupId(group.id); setSelectedItem(undefined); }}>
              <span>{group.name}</span><small>{groupCounts[group.id] ?? group.items.length}</small>
            </button>
          ))}
          {!activeGroups.length ? <p className="field-note">No groups saved.</p> : null}
        </aside>
        <section className="iptv-browser-items">
          <h4>{selectedGroup?.name ?? "Items"} · {selectedGroup ? (groupCounts[selectedGroup.id] ?? selectedGroupItems.length) : 0} {contentType === "live" ? "channels" : contentType === "movie" ? "movies" : "series"}</h4>
          {selectedGroupItems.map((item) => {
            const itemId = "name" in item ? item.id : item.id;
            const title = "name" in item ? item.name : item.title;
            return <button type="button" key={itemId} className={selectedItem && selectedItem.id === itemId ? "selected" : ""} onClick={() => {
              setSelectedItem(item);
              if (contentType === "live" && "url" in item) onSelectChannel?.(item);
              if (contentType === "movie") {
                const movie = item as Item;
                onPreviewMetadataChange?.({ title: movie.title, description: movie.description ?? null, guide: [] });
                onSelectPlaybackEntity?.({ entityType: "movie", entityId: movie.id });
              }
            }}><strong>{title}</strong><small>{"name" in item ? (item.groupName || "Uncategorized") : (item.category?.name || "Uncategorized")}</small></button>;
          })}
        </section>
        {contentType === "series" ? <aside className="iptv-channel-guide">
          <h4>Series Guide</h4>
          {contentType === "series" && selectedItem ? <select value={selectedSeasonId} onChange={(event) => setSelectedSeasonId(event.target.value)}><option value="">Select season</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name || `Season ${season.seasonNumber ?? ""}`}</option>)}</select> : null}
          {contentType === "series" ? episodes.map((episode) => <button type="button" className="iptv-guide-entry" key={episode.id} onClick={() => onSelectPlaybackEntity?.({ entityType: "episode", entityId: episode.id })}><strong>Episode {episode.episodeNumber ?? ""}: {episode.title || "Untitled"}</strong></button>) : guide.length ? guide.map((programme) => <div className="iptv-guide-entry" key={programme.externalProgrammeId}><strong>{programme.title}</strong><small>{programme.startAt ? new Date(programme.startAt).toLocaleString() : ""}</small><span>{programme.description || ""}</span></div>) : selectedItem && contentType === "movie" ? <p>{(selectedItem as Item).description || "No description supplied by the provider."}</p> : <p className="field-note">{guideStatus}</p>}
        </aside> : null}
      </div>
    </section>
  );
}
