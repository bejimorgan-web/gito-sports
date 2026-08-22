import 'package:flutter_test/flutter_test.dart';

import '../lib/models/mobile_models.dart';

void main() {
  test('parses possible lineup formations, starters, substitutes, and photos', () {
    final lineup = MobileLineup.fromJson({
      'teamId': 'team-home',
      'status': 'possible',
      'formation': {
        'name': '4-3-3',
        'formation': '4-3-3',
        'positions': [
          {'x': 50, 'y': 90, 'label': 'GK'},
        ],
      },
      'starters': [
        {'playerId': 'player-1', 'name': 'Alex Keeper', 'slotIndex': 0, 'shirtNumber': 1, 'photoUrl': 'https://example.test/alex.jpg', 'position': 'goalkeeper', 'availability': 'injured'},
      ],
      'substitutes': [
        {'playerId': 'player-2', 'name': 'Sam Forward', 'shirtNumber': 9, 'position': 'forward'},
      ],
    });

    expect(lineup.statusLabel, 'Possible Lineup');
    expect(lineup.formation, '4-3-3');
    expect(lineup.positions.single['label'], 'GK');
    expect(lineup.starters.single.photoUrl, 'https://example.test/alex.jpg');
    expect(lineup.starters.single.availability, 'injured');
    expect(lineup.substitutes.single.shirtNumber, 9);
  });

  test('renders unavailable and confirmed lineup status labels', () {
    final base = {
      'teamId': 'team-home',
      'formation': {'name': '4-4-2', 'formation': '4-4-2', 'positions': []},
      'starters': [],
      'substitutes': [],
    };

    expect(MobileLineup.fromJson({...base, 'status': 'not_available'}).statusLabel, 'Lineups not available yet.');
    expect(MobileLineup.fromJson({...base, 'status': 'confirmed'}).statusLabel, 'Confirmed Lineup');
  });
}
