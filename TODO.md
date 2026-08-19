# TODO

- Ableton device support is still unverified against a real Ableton
  instance - the fakes in `tests/test_ableton_device_handler.py` check the
  handler's own logic, not that the real Live API objects behave the way
  the fakes assume. Flag any issues here if it misbehaves.
- `CommandDispatcher.java`'s bare `ping` method is unreachable (found by
  `CommandDispatcherTest.ping_isActuallyUnreachable_theFormatCheckRunsBeforeTheSwitch`):
  `dispatch()` rejects any method without a "." before the switch
  statement's `case "ping"` is ever reached, so the PROTOCOL.md-documented
  bare `ping` call throws "Invalid method format" instead of returning
  `{"pong": true}`-shaped status. Zero current impact - `daw-client.ts`
  uses `project.getInfo` for connectivity checks, not `ping` - but it's a
  real bug. Needs a decision: fix `CommandDispatcher.java` (move the
  ping check above the format validation) or fix PROTOCOL.md to stop
  documenting a working bare `ping`.
