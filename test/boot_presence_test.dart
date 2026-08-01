import 'dart:io';

import 'package:egon_bot/src/discord/boot_presence.dart';
import 'package:egon_bot/src/package_meta.dart';
import 'package:nyxx/nyxx.dart';
import 'package:test/test.dart';

void main() {
  group('buildBootPresence', () {
    late Directory root;

    setUp(() {
      root = Directory.systemTemp.createTempSync('egon-presence-');
    });

    tearDown(() {
      if (root.existsSync()) root.deleteSync(recursive: true);
    });

    test('uses deployment version as custom status', () {
      File('${root.path}/deployment.json')
          .writeAsStringSync('{"version": "1.7.3"}');
      File('${root.path}/pubspec.yaml')
          .writeAsStringSync('name: egon_bot\nversion: 0.3.0\n');

      final presence =
          buildBootPresence(packageMeta: PackageMeta(packageRoot: root));
      expect(presence.status, CurrentUserStatus.online);
      expect(presence.isAfk, isFalse);
      expect(presence.activities, hasLength(1));
      final activity = presence.activities!.single;
      expect(activity.type, ActivityType.custom);
      expect(activity.state, 'v1.7.3');
    });

    test('falls back to package version', () {
      File('${root.path}/pubspec.yaml')
          .writeAsStringSync('name: egon_bot\nversion: 0.3.0\n');

      final presence =
          buildBootPresence(packageMeta: PackageMeta(packageRoot: root));
      expect(presence.activities!.single.state, 'v0.3.0');
    });

    test('omits activity when no version is available', () {
      final presence =
          buildBootPresence(packageMeta: PackageMeta(packageRoot: root));
      expect(presence.activities, isEmpty);
      expect(presence.status, CurrentUserStatus.online);
    });
  });
}
