import { ShutdownState } from './shutdown-state';

export function bindShutdownSignals(state: ShutdownState, graceMs: number): void {
  const beginDrain = (): void => {
    if (state.isDraining()) {
      return;
    }
    state.markDraining();
    setTimeout(() => {
      process.exit(1);
    }, graceMs).unref();
  };

  process.on('SIGTERM', beginDrain);
  process.on('SIGINT', beginDrain);
}
