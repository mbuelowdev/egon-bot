/// Process exit codes understood by `supervisor/entrypoint.sh` (§3).
abstract final class ProcessExit {
  /// Clean shutdown — supervisor exits the container.
  static const clean = 0;

  /// Restart requested (new tool installed, restart_self) — supervisor
  /// restarts immediately with no backoff.
  static const restart = 42;
}
