import 'dart:io';

import 'config.dart';

/// Records a healthy boot for the supervisor's crash-loop quarantine (§3).
///
/// Written after Discord connects so a tool that crashes during startup never
/// updates the "last good" marker. The supervisor compares tool mtimes against
/// this timestamp when deciding whether to quarantine.
void markHealthyBoot(Config config) {
  final stateDir = Directory('${config.dataDir}/state')
    ..createSync(recursive: true);
  File('${stateDir.path}/last_good_boot')
      .writeAsStringSync(DateTime.now().toUtc().toIso8601String());
}
