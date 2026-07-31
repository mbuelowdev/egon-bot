import 'dart:io';

import '../config.dart';

/// Reads the supervisor's vault readiness marker (§13).
///
/// - Marker `ready` → available
/// - Marker `unavailable` → not available
/// - Missing marker (local `dart run`) → available if the vault directory
///   exists or can be created
bool resolveVaultAvailable(Config config) {
  final marker = File('${config.dataDir}/state/vault_status');
  if (marker.existsSync()) {
    final status = marker.readAsStringSync().trim();
    return status == 'ready';
  }

  final dir = Directory(config.obsidianVaultDir);
  if (!dir.existsSync()) {
    dir.createSync(recursive: true);
  }
  return true;
}
