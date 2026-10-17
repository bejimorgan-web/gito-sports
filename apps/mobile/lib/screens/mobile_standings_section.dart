import 'package:flutter/material.dart';

import '../models/mobile_models.dart';
import '../services/mobile_api_service.dart';

class MobileStandingsSection extends StatefulWidget {
  const MobileStandingsSection({
    required this.competitionId,
    required this.seasonId,
    required this.api,
    super.key,
  });

  final String competitionId;
  final String seasonId;
  final MobileApiService api;

  @override
  State<MobileStandingsSection> createState() => _MobileStandingsSectionState();
}

class _MobileStandingsSectionState extends State<MobileStandingsSection> {
  late Future<MobileStandings> _standings;

  @override
  void initState() {
    super.initState();
    _standings = _load();
  }

  @override
  void didUpdateWidget(covariant MobileStandingsSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.competitionId != widget.competitionId ||
        oldWidget.seasonId != widget.seasonId ||
        oldWidget.api != widget.api) {
      _standings = _load();
    }
  }

  Future<MobileStandings> _load() async {
    final standings = await widget.api.getPublicStandings(
      competitionId: widget.competitionId,
      seasonId: widget.seasonId,
    );
    if (standings.competitionId != widget.competitionId ||
        standings.seasonId != widget.seasonId) {
      throw const FormatException('Standings scope does not match selection.');
    }
    return standings;
  }

  void _refresh() {
    final refreshed = _load();
    setState(() {
      _standings = refreshed;
    });
  }

  String _errorMessage(Object error) {
    if (error is MobileApiException &&
        error.statusCode == 404 &&
        error.message == 'standings_snapshot_not_found') {
      return 'Standings are not available yet for this season.';
    }
    return 'Unable to load standings. Check your connection and try again.';
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<MobileStandings>(
        future: _standings,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(
              child: CircularProgressIndicator(
                semanticsLabel: 'Loading standings',
              ),
            );
          }

          if (snapshot.hasError) {
            final message = _errorMessage(snapshot.error!);
            final noSnapshot =
                message == 'Standings are not available yet for this season.';
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(message, textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: _refresh,
                      icon: const Icon(Icons.refresh),
                      label: Text(noSnapshot ? 'Refresh' : 'Retry'),
                    ),
                  ],
                ),
              ),
            );
          }

          final standings = snapshot.data!;
          if (standings.rows.isEmpty) {
            return Column(
              children: [
                _StandingsHeader(standings: standings, onRefresh: _refresh),
                const Expanded(
                  child: Center(
                    child: Text('No standings rows are available yet.'),
                  ),
                ),
              ],
            );
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _StandingsHeader(standings: standings, onRefresh: _refresh),
              Expanded(
                child: SingleChildScrollView(
                  key: const ValueKey('standings-horizontal-scroll'),
                  scrollDirection: Axis.horizontal,
                  child: SingleChildScrollView(
                    child: DataTable(
                      columnSpacing: 18,
                      columns: const [
                        DataColumn(label: Text('#')),
                        DataColumn(label: Text('Team')),
                        DataColumn(label: Text('P')),
                        DataColumn(label: Text('W')),
                        DataColumn(label: Text('D')),
                        DataColumn(label: Text('L')),
                        DataColumn(label: Text('GF')),
                        DataColumn(label: Text('GA')),
                        DataColumn(label: Text('GD')),
                        DataColumn(label: Text('Pts')),
                      ],
                      rows: standings.rows
                          .map(
                            (row) => DataRow(
                              key: ValueKey('standings-row-${row.teamId}'),
                              cells: [
                                DataCell(Text('${row.rank}')),
                                DataCell(
                                  ConstrainedBox(
                                    constraints:
                                        const BoxConstraints(maxWidth: 170),
                                    child: Text(
                                      row.teamName,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ),
                                DataCell(Text('${row.played}')),
                                DataCell(Text('${row.won}')),
                                DataCell(Text('${row.drawn}')),
                                DataCell(Text('${row.lost}')),
                                DataCell(Text('${row.goalsFor}')),
                                DataCell(Text('${row.goalsAgainst}')),
                                DataCell(Text('${row.goalDifference}')),
                                DataCell(Text('${row.points}')),
                              ],
                            ),
                          )
                          .toList(growable: false),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      );
}

class _StandingsHeader extends StatelessWidget {
  const _StandingsHeader({
    required this.standings,
    required this.onRefresh,
  });

  final MobileStandings standings;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final provisional = standings.status == 'provisional';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${standings.competitionName} · ${standings.seasonName}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton(
                tooltip: 'Refresh standings',
                onPressed: onRefresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          if (provisional) ...[
            const SizedBox(height: 4),
            Text(
              'PROVISIONAL STANDINGS',
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 4),
            Text(standings.explanation ??
                'Coverage explanation is unavailable; these standings are provisional.'),
          ] else
            const Text('ELIGIBLE STANDINGS'),
          const SizedBox(height: 4),
          Text(
            'Snapshot ${standings.snapshotSequence} · '
            'Coverage: ${standings.coverageStatus}'
            '${standings.manifestVersion == null ? '' : ' · Manifest v${standings.manifestVersion}'}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
