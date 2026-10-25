import { AgentGateway } from './agent.gateway';

interface SocketFixture {
  id: string;
  data: {
    auth: { business: { id: string } };
    profileId: string;
    manualState: string;
    lastPresenceState: string;
  };
}

describe('AgentGateway heartbeat', () => {
  const createGateway = (): {
    gateway: AgentGateway;
    routing: { drainForAgent: jest.Mock };
    events: { emit: jest.Mock };
  } => {
    const routing = { drainForAgent: jest.fn().mockResolvedValue(undefined) };
    const events = { emit: jest.fn() };
    const profiles = {
      getOrCreate: jest.fn().mockResolvedValue({ id: 'profile-1' }),
      presenceEvent: jest.fn().mockResolvedValue({ state: 'ONLINE', activeChats: 0 }),
    };
    const config = {
      get: jest.fn((key: string) => (key === 'DASHBOARD_URL' ? 'http://localhost:3000' : '')),
    };
    const gateway = new AgentGateway(
      {} as never,
      profiles as never,
      { refreshAgent: jest.fn().mockResolvedValue('ONLINE') } as never,
      {} as never,
      {} as never,
      events as never,
      routing as never,
      {} as never,
      config as never,
      {} as never,
    );
    return { gateway, routing, events };
  };

  const socket = (lastPresenceState: string): SocketFixture => ({
    id: 'socket-1',
    data: {
      auth: { business: { id: 'business-1' } },
      profileId: 'profile-1',
      manualState: 'ONLINE',
      lastPresenceState,
    },
  });

  it('does not drain the queue on a steady online heartbeat', async () => {
    const { gateway, routing } = createGateway();
    const acknowledge = jest.fn();

    await gateway.heartbeat(socket('ONLINE') as never, acknowledge);

    expect(routing.drainForAgent).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('drains once when a heartbeat restores availability', async () => {
    const { gateway, routing } = createGateway();
    const client = socket('BUSY');

    await gateway.heartbeat(client as never, jest.fn());
    await gateway.heartbeat(client as never, jest.fn());

    expect(routing.drainForAgent).toHaveBeenCalledTimes(1);
    expect(routing.drainForAgent).toHaveBeenCalledWith('business-1', 'profile-1');
    expect(client.data.lastPresenceState).toBe('ONLINE');
  });

  it('broadcasts presence only when a heartbeat changes it', async () => {
    const { gateway, events } = createGateway();
    const client = socket('BUSY');

    await gateway.heartbeat(client as never, jest.fn());
    await gateway.heartbeat(client as never, jest.fn());

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      'agent.presence.changed',
      expect.objectContaining({ state: 'ONLINE' }),
    );
  });
});
