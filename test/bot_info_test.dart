import 'dart:io';

import 'package:egon_bot/src/package_meta.dart';
import 'package:egon_bot/src/tools/builtin/bot_info_tool.dart';
import 'package:egon_bot/src/tools/tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('PackageMeta', () {
    late Directory root;

    setUp(() {
      root = Directory.systemTemp.createTempSync('egon-meta-');
    });

    tearDown(() {
      if (root.existsSync()) root.deleteSync(recursive: true);
    });

    test('reads package and deployment versions', () {
      File('${root.path}/pubspec.yaml').writeAsStringSync(
        'name: egon_bot\nversion: 9.8.7+1\n',
      );
      File('${root.path}/deployment.json').writeAsStringSync(
        '{"version": "1.2.3", "name": "egon"}\n',
      );

      final meta = PackageMeta(packageRoot: root);
      expect(meta.packageVersion(), '9.8.7+1');
      expect(meta.deploymentVersion(), '1.2.3');
    });

    test('returns null when files are missing', () {
      final meta = PackageMeta(packageRoot: root);
      expect(meta.packageVersion(), isNull);
      expect(meta.deploymentVersion(), isNull);
    });
  });

  group('BotInfoTool', () {
    test('returns identity and config without secrets', () async {
      final started = DateTime.utc(2026, 8, 1, 12);
      final root = Directory.systemTemp.createTempSync('egon-bot-info-');
      addTearDown(() {
        if (root.existsSync()) root.deleteSync(recursive: true);
      });
      File('${root.path}/pubspec.yaml').writeAsStringSync(
        'name: egon_bot\nversion: 0.3.0\n',
      );
      File('${root.path}/deployment.json').writeAsStringSync(
        '{"version": "1.7.3"}\n',
      );

      final services = testServices(
        tools: [BotInfoTool(packageMeta: PackageMeta(packageRoot: root))],
        startedAt: started,
      );
      final result = await BotInfoTool(
        packageMeta: PackageMeta(packageRoot: root),
      ).execute(contextFor(services, owner: true, isDm: true), {});

      expect(result.isError, isFalse);
      final json = result.json!;
      expect(json['package_version'], '0.3.0');
      expect(json['deployment_version'], '1.7.3');
      expect(json['repository'], BotInfoTool.repositoryUrl);
      expect(json['started_at'], started.toIso8601String());
      expect(json['timezone'], 'Europe/Berlin');
      expect(json['owner_user_id'], ownerId);
      expect(json['allowed_channel_ids'], ['42']);
      expect(json['data_dir'], services.config.dataDir);
      expect(json['ollama'], {
        'base_url': 'http://localhost:1',
        'model': 'big-model',
        'utility_model': 'small-model',
      });
      expect(json['gpu_gate'], isA<Map>());
      expect((json['gpu_gate'] as Map)['enabled'], isFalse);
      expect(json['integrations'], isA<Map>());
      expect(json['tool_count'], 1);
      expect(json.toString(), isNot(contains('token')));
      expect(json.toString().toLowerCase(), isNot(contains('password')));
    });

    test('is personal access', () {
      expect(BotInfoTool().access, ToolAccess.personal);
    });
  });
}
