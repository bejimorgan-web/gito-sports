class MobileStandingsRow {
  const MobileStandingsRow({
    required this.rank,
    required this.teamId,
    required this.teamName,
    required this.played,
    required this.won,
    required this.drawn,
    required this.lost,
    required this.goalsFor,
    required this.goalsAgainst,
    required this.goalDifference,
    required this.points,
  });

  final int rank;
  final String teamId;
  final String teamName;
  final int played;
  final int won;
  final int drawn;
  final int lost;
  final int goalsFor;
  final int goalsAgainst;
  final int goalDifference;
  final int points;

  factory MobileStandingsRow.fromJson(Map<String, dynamic> json) {
    final team = json['team'];
    if (team is! Map) {
      throw const FormatException('Standings row is missing its team.');
    }
    final teamMap = Map<String, dynamic>.from(team);
    return MobileStandingsRow(
      rank: _standingsInteger(json['rank'], 'rank'),
      teamId: _standingsString(teamMap['id'], 'team.id'),
      teamName: _standingsString(teamMap['name'], 'team.name'),
      played: _standingsInteger(json['played'], 'played'),
      won: _standingsInteger(json['won'], 'won'),
      drawn: _standingsInteger(json['drawn'], 'drawn'),
      lost: _standingsInteger(json['lost'], 'lost'),
      goalsFor: _standingsInteger(json['goalsFor'], 'goalsFor'),
      goalsAgainst: _standingsInteger(json['goalsAgainst'], 'goalsAgainst'),
      goalDifference:
          _standingsInteger(json['goalDifference'], 'goalDifference'),
      points: _standingsInteger(json['points'], 'points'),
    );
  }
}

class MobileStandings {
  const MobileStandings({
    required this.competitionId,
    required this.competitionName,
    required this.seasonId,
    required this.seasonName,
    required this.snapshotId,
    required this.snapshotSequence,
    required this.calculatedAt,
    required this.rulesetId,
    required this.rulesetVersion,
    required this.status,
    required this.explanation,
    required this.coverageStatus,
    required this.manifestVersion,
    required this.rows,
  });

  final String competitionId;
  final String competitionName;
  final String seasonId;
  final String seasonName;
  final String snapshotId;
  final int snapshotSequence;
  final String calculatedAt;
  final String rulesetId;
  final int rulesetVersion;
  final String status;
  final String? explanation;
  final String coverageStatus;
  final int? manifestVersion;
  final List<MobileStandingsRow> rows;

  factory MobileStandings.fromJson(Map<String, dynamic> json) {
    final competition = _standingsMap(json['competition'], 'competition');
    final season = _standingsMap(json['season'], 'season');
    final snapshot = _standingsMap(json['snapshot'], 'snapshot');
    final ruleset = _standingsMap(snapshot['ruleset'], 'snapshot.ruleset');
    final coverage = _standingsMap(json['coverage'], 'coverage');
    final rawRows = json['rows'];
    if (rawRows is! List) {
      throw const FormatException('Standings rows are missing.');
    }
    final status = _standingsString(json['status'], 'status');
    if (status != 'eligible' && status != 'provisional') {
      throw const FormatException('Standings status is invalid.');
    }
    return MobileStandings(
      competitionId: _standingsString(competition['id'], 'competition.id'),
      competitionName:
          _standingsString(competition['name'], 'competition.name'),
      seasonId: _standingsString(season['id'], 'season.id'),
      seasonName: _standingsString(season['name'], 'season.name'),
      snapshotId: _standingsString(snapshot['id'], 'snapshot.id'),
      snapshotSequence:
          _standingsInteger(snapshot['sequence'], 'snapshot.sequence'),
      calculatedAt:
          _standingsString(snapshot['calculatedAt'], 'snapshot.calculatedAt'),
      rulesetId: _standingsString(ruleset['id'], 'snapshot.ruleset.id'),
      rulesetVersion:
          _standingsInteger(ruleset['version'], 'snapshot.ruleset.version'),
      status: status,
      explanation: json['explanation'] is String
          ? (json['explanation'] as String).trim().isEmpty
              ? null
              : (json['explanation'] as String)
          : null,
      coverageStatus:
          _standingsString(coverage['status'], 'coverage.status'),
      manifestVersion: coverage['manifestVersion'] == null
          ? null
          : _standingsInteger(
              coverage['manifestVersion'], 'coverage.manifestVersion'),
      rows: rawRows
          .map((row) => MobileStandingsRow.fromJson(
              _standingsMap(row, 'rows[]')))
          .toList(growable: false),
    );
  }
}

Map<String, dynamic> _standingsMap(Object? value, String field) {
  if (value is Map) return Map<String, dynamic>.from(value);
  throw FormatException('Standings field $field is invalid.');
}

String _standingsString(Object? value, String field) {
  if (value is String && value.trim().isNotEmpty) return value;
  throw FormatException('Standings field $field is invalid.');
}

int _standingsInteger(Object? value, String field) {
  if (value is int) return value;
  if (value is num && value.isFinite && value == value.truncateToDouble()) {
    return value.toInt();
  }
  throw FormatException('Standings field $field is invalid.');
}


