import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";
const EMPTY_FAVORITE_CHANNEL_IDS = [];
export function IptvCatalogueScreen({ providerId, onSelectChannel, onSelectPlaybackEntity, contentType: requestedContentType = "live", favoriteChannelIds = EMPTY_FAVORITE_CHANNEL_IDS, showContentTypeCounts = true, onPreviewMetadataChange }) {
    const [liveCategories, setLiveCategories] = useState([]);
    const [movieCategories, setMovieCategories] = useState([]);
    const [seriesCategories, setSeriesCategories] = useState([]);
    const [liveChannels, setLiveChannels] = useState([]);
    const [movies, setMovies] = useState([]);
    const [series, setSeries] = useState([]);
    const [contentType, setContentType] = useState(requestedContentType === "movies" ? "movie" : requestedContentType === "series" ? "series" : "live");
    const [selectedGroupId, setSelectedGroupId] = useState("");
    const [selectedGroupItems, setSelectedGroupItems] = useState([]);
    const [groupCounts, setGroupCounts] = useState({});
    const [selectedItem, setSelectedItem] = useState();
    const [selectedSeasonId, setSelectedSeasonId] = useState("");
    const [seasons, setSeasons] = useState([]);
    const [episodes, setEpisodes] = useState([]);
    const [guide, setGuide] = useState([]);
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
    const mapLiveItem = (item) => ({
        id: item.id,
        providerId: item.providerId,
        name: item.name,
        url: item.playbackReference,
        contentType: "live",
        status: item.status ?? "active",
        createdAt: "",
        updatedAt: "",
        ...(item.externalRef ? { externalRef: item.externalRef } : {}),
        ...(item.categoryId ? { categoryId: item.categoryId } : {}),
        ...(item.category?.name ? { groupName: item.category.name } : {}),
        ...(item.logoUrl ? { logoUrl: item.logoUrl } : {})
    });
    useEffect(() => {
        let cancelled = false;
        const requestProviderId = providerId;
        if (!requestProviderId) {
            setStatus("Select a saved IPTV provider to browse its catalogue.");
            return () => { cancelled = true; };
        }
        setStatus("Loading catalogue groups...");
        const localStorage = window.gito?.desktopStorage;
        const localCatalogueRuntime = window.gito?.desktopStorage;
        if (!localCatalogueRuntime?.categories?.list || !localCatalogueRuntime.movies?.list || !localCatalogueRuntime.series?.list) {
            setStatus("Desktop catalogue storage is unavailable.");
            return () => { cancelled = true; };
        }
        const movieCategoriesPromise = localCatalogueRuntime.categories.list(requestProviderId, "movie");
        const seriesCategoriesPromise = localCatalogueRuntime.categories.list(requestProviderId, "series");
        const moviesPromise = localCatalogueRuntime.movies.list(requestProviderId);
        const seriesPromise = localCatalogueRuntime.series.list(requestProviderId);
        void Promise.all([
            apiClient.listIptvCatalogueCategories(requestProviderId, "live"),
            movieCategoriesPromise,
            seriesCategoriesPromise,
            apiClient.listIptvChannels(requestProviderId),
            moviesPromise,
            seriesPromise
        ]).then(([live, movie, seriesGroup, liveItems, movieItems, seriesItems]) => {
            if (cancelled || requestProviderId !== providerId)
                return;
            const mapCategory = (category) => ({ id: category.id, name: category.name, providerCategoryId: category.externalReference ?? null });
            const mappedMovieCategories = movie.map(mapCategory);
            const mappedSeriesCategories = seriesGroup.map(mapCategory);
            const movieCategoryNames = new Map(mappedMovieCategories.map((category) => [category.id, category.name]));
            const seriesCategoryNames = new Map(mappedSeriesCategories.map((category) => [category.id, category.name]));
            const mappedMovies = movieItems.map((item) => ({ id: item.id, providerId: item.providerAccountId, title: item.name, description: item.description, categoryId: item.categoryId, ...(movieCategoryNames.get(item.categoryId) ? { category: { name: movieCategoryNames.get(item.categoryId) } } : {}), posterUrl: item.posterUrl }));
            const mappedSeries = seriesItems.map((item) => ({ id: item.id, providerId: item.providerAccountId, title: item.name, description: item.description, categoryId: item.categoryId, ...(seriesCategoryNames.get(item.categoryId) ? { category: { name: seriesCategoryNames.get(item.categoryId) } } : {}), posterUrl: item.posterUrl }));
            setCatalogueTotals({ live: liveItems.total, movie: mappedMovies.length, series: mappedSeries.length });
            setLiveCategories(live.items);
            setMovieCategories(mappedMovieCategories);
            setSeriesCategories(mappedSeriesCategories);
            const favoriteSet = new Set(favoriteChannelIds);
            setLiveChannels(liveItems.items.map(mapLiveItem).filter((channel) => requestedContentType !== "favorites" || favoriteSet.has(channel.id)));
            setMovies(mappedMovies);
            setSeries(mappedSeries);
            setStatus("Catalogue loaded from the provider catalogue.");
        }).catch((error) => {
            if (!cancelled && requestProviderId === providerId)
                setStatus(error instanceof Error ? error.message : "Unable to load IPTV catalogue data.");
        });
        return () => { cancelled = true; };
    }, [favoriteChannelIds, providerId, requestedContentType]);
    useEffect(() => {
        setSelectedItem(undefined);
        setSelectedGroupId("");
        setSelectedGroupItems([]);
        setSeasons([]);
        setEpisodes([]);
        setGuide([]);
        setGuideStatus("Select a channel or movie.");
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
            if (cancelled || requestProviderId !== providerId || requestSeriesId !== selectedItem.id)
                return;
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
            if (cancelled || requestProviderId !== providerId || requestSeasonId !== selectedSeasonId)
                return;
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
            if (cancelled || requestProviderId !== providerId || requestItemId !== selectedItem.id)
                return;
            const channel = channels.find((item) => item.name === requestItemName ||
                item.channelId === requestItemId ||
                item.externalReference === requestItemExternalRef);
            if (!channel) {
                if (cancelled || requestProviderId !== providerId || requestItemId !== selectedItem.id)
                    return;
                setGuide([]);
                setGuideStatus("No EPG data for this channel.");
                onPreviewMetadataChange?.({ title: requestItemName, guide: [] });
                return;
            }
            const programmes = await desktopStorage.epgProgrammes.list(requestProviderId, channel.id);
            if (cancelled || requestProviderId !== providerId || requestItemId !== selectedItem.id)
                return;
            const upcomingProgrammes = programmes
                .filter((programme) => programme.status === "active" && Date.parse(programme.startAt) > Date.now())
                .map((programme) => ({
                title: programme.title,
                description: programme.description,
                startAt: programme.startAt,
                endAt: programme.endAt,
                externalProgrammeId: programme.externalReference ?? programme.id
            }));
            setGuide(upcomingProgrammes);
            onPreviewMetadataChange?.({ title: requestItemName, guide: upcomingProgrammes });
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
    const groups = (categories, items) => categories.map((category) => ({
        ...category,
        items: items.filter((item) => item.category?.name === category.name || item.categoryId === category.id)
    }));
    const effectiveLiveCategories = useMemo(() => {
        if (liveCategories.length > 0)
            return liveCategories;
        const groups = new Map();
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
        items: liveChannels.filter((channel) => channel.categoryId === category.id ||
            channel.categoryId === category.providerCategoryId
            || (!channel.categoryId && channel.groupName === category.name))
    })), [effectiveLiveCategories, liveChannels]);
    const movieGroups = useMemo(() => groups(movieCategories, movies), [movieCategories, movies]);
    const seriesGroups = useMemo(() => groups(seriesCategories, series), [seriesCategories, series]);
    const counts = catalogueTotals;
    const activeGroups = contentType === "live"
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
            void apiClient.listIptvChannels(requestProviderId, categoryId).then((page) => {
                if (cancelled || requestProviderId !== providerId || categoryId !== selectedGroup.id)
                    return;
                const favoriteSet = new Set(favoriteChannelIds);
                const items = page.items.map(mapLiveItem).filter((channel) => requestedContentType !== "favorites" || favoriteSet.has(channel.id));
                setSelectedGroupItems(items);
                setGroupCounts((current) => ({ ...current, [categoryId]: requestedContentType === "favorites" ? items.length : page.total }));
            }).catch(() => { if (!cancelled && requestProviderId === providerId && categoryId === selectedGroup.id)
                setSelectedGroupItems([]); });
        }
        else if (contentType === "movie") {
            const items = movies.filter((movie) => movie.categoryId === categoryId || movie.category?.name === selectedGroup.name);
            setSelectedGroupItems(items);
            setGroupCounts((current) => ({ ...current, [categoryId]: items.length }));
        }
        else {
            const items = series.filter((item) => item.categoryId === categoryId || item.category?.name === selectedGroup.name);
            setSelectedGroupItems(items);
            setGroupCounts((current) => ({ ...current, [categoryId]: items.length }));
        }
        return () => { cancelled = true; };
    }, [contentType, favoriteChannelIds, movies, providerId, requestedContentType, selectedGroup?.id, selectedGroup?.name, series]);
    return (_jsxs("section", { className: "console-panel iptv-catalogue-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "IPTV Content Browser" }), _jsx("span", { children: status })] }), showContentTypeCounts ? _jsxs("div", { className: "iptv-catalogue-counts", children: [_jsxs("button", { type: "button", className: contentType === "live" ? "active" : "", onClick: () => setContentType("live"), children: [_jsx("strong", { children: counts.live }), _jsx("span", { children: "Channels" })] }), _jsxs("button", { type: "button", className: contentType === "movie" ? "active" : "", onClick: () => setContentType("movie"), children: [_jsx("strong", { children: counts.movie }), _jsx("span", { children: "Movies" })] }), _jsxs("button", { type: "button", className: contentType === "series" ? "active" : "", onClick: () => setContentType("series"), children: [_jsx("strong", { children: counts.series }), _jsx("span", { children: "Series" })] })] }) : null, _jsxs("div", { className: `iptv-browser-grid iptv-browser-${contentType}`, children: [_jsxs("aside", { className: "iptv-browser-groups", children: [_jsx("h4", { children: contentType === "live" ? "Channel Groups" : contentType === "movie" ? "Movie Groups" : "Series Groups" }), activeGroups.map((group) => (_jsxs("button", { type: "button", className: `iptv-group-button ${selectedGroup?.id === group.id ? "selected" : ""}`, onClick: () => { setSelectedGroupId(group.id); setSelectedItem(undefined); }, children: [_jsx("span", { children: group.name }), _jsx("small", { children: groupCounts[group.id] ?? group.items.length })] }, group.id))), !activeGroups.length ? _jsx("p", { className: "field-note", children: "No groups saved." }) : null] }), _jsxs("section", { className: "iptv-browser-items", children: [_jsxs("h4", { children: [selectedGroup?.name ?? "Items", " \u00B7 ", selectedGroup ? (groupCounts[selectedGroup.id] ?? selectedGroupItems.length) : 0, " ", contentType === "live" ? "channels" : contentType === "movie" ? "movies" : "series"] }), selectedGroupItems.map((item) => {
                                const itemId = "name" in item ? item.id : item.id;
                                const title = "name" in item ? item.name : item.title;
                                return _jsxs("button", { type: "button", className: selectedItem && selectedItem.id === itemId ? "selected" : "", onClick: () => {
                                        setSelectedItem(item);
                                        if (contentType === "live" && "url" in item)
                                            onSelectChannel?.(item);
                                        if (contentType === "movie") {
                                            const movie = item;
                                            onPreviewMetadataChange?.({ title: movie.title, description: movie.description ?? null, guide: [] });
                                            onSelectPlaybackEntity?.({ entityType: "movie", entityId: movie.id });
                                        }
                                    }, children: [_jsx("strong", { children: title }), _jsx("small", { children: "name" in item ? (item.groupName || "Uncategorized") : (item.category?.name || "Uncategorized") })] }, itemId);
                            })] }), contentType === "series" ? _jsxs("aside", { className: "iptv-channel-guide", children: [_jsx("h4", { children: "Series Guide" }), contentType === "series" && selectedItem ? _jsxs("select", { value: selectedSeasonId, onChange: (event) => setSelectedSeasonId(event.target.value), children: [_jsx("option", { value: "", children: "Select season" }), seasons.map((season) => _jsx("option", { value: season.id, children: season.name || `Season ${season.seasonNumber ?? ""}` }, season.id))] }) : null, contentType === "series" ? episodes.map((episode) => _jsx("button", { type: "button", className: "iptv-guide-entry", onClick: () => onSelectPlaybackEntity?.({ entityType: "episode", entityId: episode.id }), children: _jsxs("strong", { children: ["Episode ", episode.episodeNumber ?? "", ": ", episode.title || "Untitled"] }) }, episode.id)) : guide.length ? guide.map((programme) => _jsxs("div", { className: "iptv-guide-entry", children: [_jsx("strong", { children: programme.title }), _jsx("small", { children: programme.startAt ? new Date(programme.startAt).toLocaleString() : "" }), _jsx("span", { children: programme.description || "" })] }, programme.externalProgrammeId)) : selectedItem && contentType === "movie" ? _jsx("p", { children: selectedItem.description || "No description supplied by the provider." }) : _jsx("p", { className: "field-note", children: guideStatus })] }) : null] })] }));
}
