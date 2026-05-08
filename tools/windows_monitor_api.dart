import 'dart:async';
import 'dart:convert';
import 'dart:io';

const Duration sampleInterval = Duration(seconds: 10);
const Duration averageWindow = Duration(minutes: 5);

Future<void> main(List<String> args) async {
  if (!Platform.isWindows) {
    stderr.writeln('windows_monitor_api.dart only supports Windows.');
    exitCode = 1;
    return;
  }

  final monitor = ResourceMonitor(
    sampleInterval: sampleInterval,
    averageWindow: averageWindow,
  );
  await monitor.start();

  final port = _readPortFromArgs(args) ?? 11433;
  final server = await HttpServer.bind(InternetAddress.anyIPv4, port);
  stdout.writeln('Windows monitor API listening on http://0.0.0.0:$port');

  await for (final request in server) {
    await _handleRequest(request, monitor);
  }
}

Future<void> _handleRequest(HttpRequest request, ResourceMonitor monitor) async {
  final path = request.uri.path;
  if (request.method != 'GET') {
    _writeJson(
      request.response,
      HttpStatus.methodNotAllowed,
      {'error': 'Only GET is supported.'},
    );
    return;
  }

  if (path == '/getResourceUsage') {
    final usage = monitor.snapshot();
    _writeJson(request.response, HttpStatus.ok, usage);
    return;
  }

  if (path == '/isUserActive') {
    final isActive = await _isUserActive();
    _writeJson(request.response, HttpStatus.ok, {'isUserActive': isActive});
    return;
  }

  _writeJson(
    request.response,
    HttpStatus.notFound,
    {'error': 'Unknown endpoint.', 'path': path},
  );
}

void _writeJson(HttpResponse response, int statusCode, Map<String, Object?> body) {
  response.statusCode = statusCode;
  response.headers.contentType = ContentType.json;
  response.write(jsonEncode(body));
  response.close();
}

int? _readPortFromArgs(List<String> args) {
  for (final arg in args) {
    if (arg.startsWith('--port=')) {
      return int.tryParse(arg.substring('--port='.length));
    }
  }
  return null;
}

class ResourceMonitor {
  ResourceMonitor({
    required this.sampleInterval,
    required this.averageWindow,
  });

  final Duration sampleInterval;
  final Duration averageWindow;

  final List<_TimedSample> _cpuSamples = [];
  final List<_TimedSample> _gpuSamples = [];
  Timer? _timer;

  Future<void> start() async {
    await _sampleOnce();
    _timer = Timer.periodic(sampleInterval, (_) {
      _sampleOnce();
    });
  }

  Map<String, Object?> snapshot() {
    final cpuCurrent = _cpuSamples.isNotEmpty ? _cpuSamples.last.value : 0.0;
    final gpuCurrent = _gpuSamples.isNotEmpty ? _gpuSamples.last.value : 0.0;

    return {
      'cpuUsagePercent': {
        'current': _round2(cpuCurrent),
        'avg5m': _round2(_average(_cpuSamples)),
      },
      'gpuUsagePercent': {
        'current': _round2(gpuCurrent),
        'avg5m': _round2(_average(_gpuSamples)),
      },
      'windowSeconds': averageWindow.inSeconds,
      'sampleIntervalSeconds': sampleInterval.inSeconds,
    };
  }

  Future<void> _sampleOnce() async {
    final now = DateTime.now();
    try {
      final cpu = await _getCpuUsagePercent();
      final gpu = await _getGpuUsagePercent();
      _cpuSamples.add(_TimedSample(now, cpu));
      _gpuSamples.add(_TimedSample(now, gpu));
      _dropOldSamples(now);
    } catch (e) {
      stderr.writeln('Resource sampling failed: $e');
    }
  }

  void _dropOldSamples(DateTime now) {
    final cutoff = now.subtract(averageWindow);
    _cpuSamples.removeWhere((sample) => sample.time.isBefore(cutoff));
    _gpuSamples.removeWhere((sample) => sample.time.isBefore(cutoff));
  }

  double _average(List<_TimedSample> samples) {
    if (samples.isEmpty) {
      return 0.0;
    }
    final total = samples.fold<double>(0.0, (sum, sample) => sum + sample.value);
    return total / samples.length;
  }

  double _round2(double value) {
    return (value * 100).roundToDouble() / 100;
  }
}

class _TimedSample {
  _TimedSample(this.time, this.value);

  final DateTime time;
  final double value;
}

Future<double> _getCpuUsagePercent() async {
  final command = r'''(Get-Counter "\Processor(_Total)\% Processor Time").CounterSamples[0].CookedValue''';
  final output = await _runPowerShell(command);
  return _parseFirstDouble(output);
}

Future<double> _getGpuUsagePercent() async {
  final command = r'''$s=(Get-Counter "\GPU Engine(*)\Utilization Percentage").CounterSamples; ($s | Measure-Object -Property CookedValue -Sum).Sum''';
  final output = await _runPowerShell(command);
  final value = _parseFirstDouble(output);
  if (value < 0) {
    return 0.0;
  }
  return value;
}

Future<String> _runPowerShell(String command) async {
  final result = await Process.run(
    'powershell.exe',
    ['-NoProfile', '-Command', command],
    runInShell: false,
  );

  if (result.exitCode != 0) {
    throw ProcessException(
      'powershell.exe',
      ['-NoProfile', '-Command', command],
      '${result.stderr}',
      result.exitCode,
    );
  }

  return '${result.stdout}'.trim();
}

double _parseFirstDouble(String raw) {
  final cleaned = raw.replaceAll(',', '.');
  final match = RegExp(r'-?\d+(\.\d+)?').firstMatch(cleaned);
  if (match == null) {
    return 0.0;
  }
  return double.tryParse(match.group(0)!) ?? 0.0;
}

Future<bool> _isUserActive() async {
  const parsecLogFilePath = r'C:\ProgramData\Parsec\log.txt';
  final logFile = File(parsecLogFilePath);
  if (!await logFile.exists()) {
    stderr.writeln('Parsec log file not found: $parsecLogFilePath');
    return false;
  }

  _ConnectionEvent? latestEvent;
  final lines = await logFile.readAsLines();
  for (final line in lines) {
    final event = _parseConnectionEvent(line);
    if (event == null) {
      continue;
    }
    if (latestEvent == null || event.timestamp.isAfter(latestEvent.timestamp)) {
      latestEvent = event;
    }
  }

  if (latestEvent == null) {
    return false;
  }

  return latestEvent.status == 'connected';
}

_ConnectionEvent? _parseConnectionEvent(String line) {
  final match = RegExp(
    r'^\[I ([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2})\] .+ (connected|disconnected)\.$',
  ).firstMatch(line.trim());

  if (match == null) {
    return null;
  }

  final timestamp = DateTime.tryParse(match.group(1)!.replaceFirst(' ', 'T'));
  if (timestamp == null) {
    return null;
  }

  return _ConnectionEvent(
    timestamp: timestamp,
    status: match.group(2)!,
  );
}

class _ConnectionEvent {
  _ConnectionEvent({
    required this.timestamp,
    required this.status,
  });

  final DateTime timestamp;
  final String status;
}
