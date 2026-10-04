import { WindowChannel, type BroadcastChannelLike } from '../windowChannel';
import type { WindowRole } from '../../models/windowMessages';

type Listener = (event: MessageEvent) => void;

/** An in-memory BroadcastChannel: every transport but the sender receives a structured copy, synchronously. */
export class FakeWindowBus {
  private readonly transports = new Set<FakeTransport>();
  private clock = 0;

  readonly now = (): number => {
    this.clock += 1;
    return this.clock;
  };

  createTransport = (): BroadcastChannelLike => {
    const transport = new FakeTransport(this);
    this.transports.add(transport);
    return transport;
  };

  deliver(sender: FakeTransport, message: unknown): void {
    const copy = JSON.parse(JSON.stringify(message)) as unknown;
    for (const transport of Array.from(this.transports)) {
      if (transport !== sender) {
        transport.receive(copy);
      }
    }
  }

  remove(transport: FakeTransport): void {
    this.transports.delete(transport);
  }

  /** Pass a `target` to give the channel a browser window, e.g. one whose `opener` is another target. */
  createWindow(id: string, type: WindowRole = 'bible', target?: FakeWindowTarget): WindowChannel {
    const channel = new WindowChannel({
      id,
      type,
      createTransport: this.createTransport,
      now: this.now,
    });
    channel.start(target as unknown as Window | undefined);
    return channel;
  }
}

export interface FakeWindowTarget {
  name: string;
  opener: FakeWindowTarget | null;
  closed: boolean;
  __marginaliaWindowId?: string;
  focus(): void;
  addEventListener(): void;
  removeEventListener(): void;
}

export const fakeWindowTarget = (opener: FakeWindowTarget | null = null): FakeWindowTarget => ({
  name: '',
  opener,
  closed: false,
  focus: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
});

class FakeTransport implements BroadcastChannelLike {
  private readonly listeners = new Set<Listener>();
  private closed = false;

  constructor(private readonly bus: FakeWindowBus) {}

  postMessage(message: unknown): void {
    if (!this.closed) {
      this.bus.deliver(this, message);
    }
  }

  addEventListener(_type: 'message', listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: Listener): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.bus.remove(this);
  }

  receive(data: unknown): void {
    for (const listener of Array.from(this.listeners)) {
      listener({ data } as MessageEvent);
    }
  }
}
