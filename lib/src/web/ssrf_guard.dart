import 'dart:io';

/// Blocks requests to private / loopback / link-local targets (§11).
///
/// Resolves DNS before connect so a public hostname that points at a
/// private address is also rejected.
class SsrfBlockedException implements Exception {
  SsrfBlockedException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Ensures [uri] is http(s) and every resolved address is publicly routable.
Future<void> assertPublicHttpUri(Uri uri) async {
  if (uri.scheme != 'http' && uri.scheme != 'https') {
    throw SsrfBlockedException(
      'Only http/https URLs are allowed (got ${uri.scheme}).',
    );
  }
  final host = uri.host.trim();
  if (host.isEmpty) {
    throw SsrfBlockedException('URL is missing a host.');
  }
  final lower = host.toLowerCase();
  if (lower == 'localhost' ||
      lower.endsWith('.localhost') ||
      lower.endsWith('.local') ||
      lower == 'metadata.google.internal' ||
      lower == 'metadata') {
    throw SsrfBlockedException('Host "$host" is blocked (local/metadata).');
  }

  // Literal IP in the URL.
  final literal = InternetAddress.tryParse(host);
  if (literal != null) {
    if (_isBlockedAddress(literal)) {
      throw SsrfBlockedException(
        'Address $host is private/loopback and blocked.',
      );
    }
    return;
  }

  List<InternetAddress> addresses;
  try {
    addresses = await InternetAddress.lookup(host);
  } catch (error) {
    throw SsrfBlockedException('DNS lookup failed for $host: $error');
  }
  if (addresses.isEmpty) {
    throw SsrfBlockedException('DNS lookup for $host returned no addresses.');
  }
  for (final addr in addresses) {
    if (_isBlockedAddress(addr)) {
      throw SsrfBlockedException(
        'Host $host resolves to blocked address ${addr.address}.',
      );
    }
  }
}

bool _isBlockedAddress(InternetAddress addr) {
  if (addr.isLoopback || addr.isLinkLocal) return true;
  switch (addr.type) {
    case InternetAddressType.IPv4:
      return _isBlockedIpv4(addr.rawAddress);
    case InternetAddressType.IPv6:
      return _isBlockedIpv6(addr);
    default:
      return true;
  }
}

bool _isBlockedIpv4(List<int> octets) {
  if (octets.length != 4) return true;
  final a = octets[0];
  final b = octets[1];
  // 0.0.0.0/8
  if (a == 0) return true;
  // 10.0.0.0/8
  if (a == 10) return true;
  // 127.0.0.0/8
  if (a == 127) return true;
  // 169.254.0.0/16 link-local
  if (a == 169 && b == 254) return true;
  // 172.16.0.0/12
  if (a == 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a == 192 && b == 168) return true;
  // 100.64.0.0/10 carrier-grade NAT
  if (a == 100 && b >= 64 && b <= 127) return true;
  return false;
}

bool _isBlockedIpv6(InternetAddress addr) {
  final bytes = addr.rawAddress;
  if (bytes.length != 16) return true;
  // ::1 already covered by isLoopback
  // Unique local fc00::/7
  if ((bytes[0] & 0xfe) == 0xfc) return true;
  // Link-local fe80::/10 already covered by isLinkLocal
  // IPv4-mapped ::ffff:x.x.x.x
  final isV4Mapped = bytes[0] == 0 &&
      bytes[1] == 0 &&
      bytes[2] == 0 &&
      bytes[3] == 0 &&
      bytes[4] == 0 &&
      bytes[5] == 0 &&
      bytes[6] == 0 &&
      bytes[7] == 0 &&
      bytes[8] == 0 &&
      bytes[9] == 0 &&
      bytes[10] == 0xff &&
      bytes[11] == 0xff;
  if (isV4Mapped) {
    return _isBlockedIpv4(bytes.sublist(12));
  }
  return false;
}
