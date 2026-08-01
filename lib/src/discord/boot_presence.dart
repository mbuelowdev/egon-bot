import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../package_meta.dart';

/// Builds the Discord presence shown under the bot's name.
///
/// Prefers `deployment.json` version (what gets bumped on ship), falls back
/// to `pubspec.yaml`, then a plain "online" with no activity.
PresenceBuilder buildBootPresence({PackageMeta? packageMeta}) {
  final meta = packageMeta ?? PackageMeta();
  final version = meta.deploymentVersion() ?? meta.packageVersion();
  return PresenceBuilder(
    status: CurrentUserStatus.online,
    isAfk: false,
    activities: version == null
        ? const []
        : [
            ActivityBuilder(
              // Required by Discord; not shown for custom status.
              name: 'Custom Status',
              type: ActivityType.custom,
              state: 'v$version',
            ),
          ],
  );
}

/// Sets the bot's Discord status (online + optional version custom status).
///
/// Presence updates are best-effort: Discord/gateway flakiness must not abort
/// an otherwise healthy session.
bool applyBootPresence(NyxxGateway client, {PackageMeta? packageMeta}) {
  final meta = packageMeta ?? PackageMeta();
  final version = meta.deploymentVersion() ?? meta.packageVersion();
  try {
    client.updatePresence(buildBootPresence(packageMeta: meta));
    if (version != null) {
      stdout.writeln('Discord presence set to v$version.');
    }
    return true;
  } catch (error, stackTrace) {
    stderr.writeln('Discord presence update failed (continuing): $error');
    stderr.writeln(stackTrace);
    return false;
  }
}
