import 'dart:convert';
import 'dart:io';

/// Reads non-secret identity metadata from files shipped with the package.
class PackageMeta {
  PackageMeta({Directory? packageRoot})
      : packageRoot = packageRoot ?? Directory.current;

  final Directory packageRoot;

  /// `version` from `pubspec.yaml`, or null if missing/unreadable.
  String? packageVersion() {
    final file = File('${packageRoot.path}/pubspec.yaml');
    if (!file.existsSync()) return null;
    final match = RegExp(
      r'^version:\s*(\S+)',
      multiLine: true,
    ).firstMatch(file.readAsStringSync());
    return match?.group(1);
  }

  /// `version` from `deployment.json`, or null if missing/unreadable.
  String? deploymentVersion() {
    final file = File('${packageRoot.path}/deployment.json');
    if (!file.existsSync()) return null;
    try {
      final json = jsonDecode(file.readAsStringSync());
      if (json is Map && json['version'] is String) {
        return json['version'] as String;
      }
    } on FormatException {
      return null;
    }
    return null;
  }
}
