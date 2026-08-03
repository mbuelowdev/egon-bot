import '../package_meta.dart';

/// Computes the next patch version for a self-extension deploy bump.
String nextDeploymentVersion({PackageMeta? meta}) {
  final current = (meta ?? PackageMeta()).deploymentVersion() ??
      (meta ?? PackageMeta()).packageVersion() ??
      '0.0.0';
  return bumpPatch(current);
}

/// Increments the patch segment of a semver-ish string (`1.2.3` → `1.2.4`).
String bumpPatch(String version) {
  final clean = version.split('+').first.split('-').first.trim();
  final parts = clean.split('.');
  if (parts.length < 3) {
    final major = int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? 0;
    final minor = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0;
    return '$major.$minor.1';
  }
  final major = int.tryParse(parts[0]) ?? 0;
  final minor = int.tryParse(parts[1]) ?? 0;
  final patch = int.tryParse(parts[2]) ?? 0;
  return '$major.$minor.${patch + 1}';
}
