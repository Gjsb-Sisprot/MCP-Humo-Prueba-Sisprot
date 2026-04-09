
export interface ConversationEvent {
  
  type: 'status_changed' | 'new_message' | 'specialist_action';
  
  sessionId: string;
  
  data: Record<string, unknown>;
  
  timestamp: string;
}

type EventHandler = (event: ConversationEvent) => void;

const subscribers = new Map<string, Set<EventHandler>>();

const globalSubscribers = new Set<EventHandler>();

export function subscribe(sessionId: string, handler: EventHandler): () => void {
  let handlers = subscribers.get(sessionId);
  if (!handlers) {
    handlers = new Set();
    subscribers.set(sessionId, handlers);
  }
  handlers.add(handler);

  return () => {
    handlers!.delete(handler);
    if (handlers!.size === 0) {
      subscribers.delete(sessionId);
    }
  };
}

export function subscribeAll(handler: EventHandler): () => void {
  globalSubscribers.add(handler);
  return () => {
    globalSubscribers.delete(handler);
  };
}

export function emit(event: ConversationEvent): void {
  const handlers = subscribers.get(event.sessionId);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
      }
    }
  }

  for (const handler of globalSubscribers) {
    try {
      handler(event);
    } catch (err) {
    }
  }
}

export function emitStatusChange(
  sessionId: string,
  newStatus: string,
  extra?: Record<string, unknown>
): void {
  emit({
    type: 'status_changed',
    sessionId,
    data: { status: newStatus, ...extra },
    timestamp: new Date().toISOString(),
  });
}

export function getEventBusStats(): { sessionSubscribers: number; globalSubscribers: number } {
  return {
    sessionSubscribers: subscribers.size,
    globalSubscribers: globalSubscribers.size,
  };
}
