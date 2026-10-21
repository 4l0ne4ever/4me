import type { LiveEvent } from "@4me/shared";
import type { Live } from "../env";

/** Anything that can be sent text: a `ws` socket on Node, a fake one in tests. */
export type Socket = { send(data: string): void; readonly readyState: number };
const OPEN = 1;

/**
 * Live connections kept in this process: local development (Node) and tests. On Workers the Hub Durable Object
 * does the same job; both follow the same rules: one socket, a fixed set of topics, presence counted per page.
 */
export class MemoryHub implements Live {
  private sockets = new Map<Socket, string[]>();

  add(socket: Socket, topics: string[]) {
    this.sockets.set(socket, topics);
    socket.send(JSON.stringify({ type: "hello" } satisfies LiveEvent));
    for (const t of topics) if (t.startsWith("entry:")) this.presence(t);
    this.awake();
  }

  remove(socket: Socket) {
    const topics = this.sockets.get(socket) ?? [];
    this.sockets.delete(socket);
    for (const t of topics) if (t.startsWith("entry:")) this.presence(t);
    this.awake();
  }

  /** Everyone with 4me open: the lit windows on the skyline. */
  private awake() {
    let n = 0;
    for (const s of this.sockets.keys()) if (s.readyState === OPEN) n++;
    this.publish(["tonight"], { type: "awake", n });
  }

  publish(topics: string[], event: LiveEvent) {
    const msg = JSON.stringify(event);
    for (const [socket, mine] of this.sockets) {
      if (socket.readyState === OPEN && mine.some((t) => topics.includes(t))) socket.send(msg);
    }
  }

  private presence(topic: string) {
    let reading = 0;
    for (const [s, mine] of this.sockets) if (s.readyState === OPEN && mine.includes(topic)) reading++;
    this.publish([topic], { type: "presence", entryId: Number(topic.slice("entry:".length)), reading });
  }
}
