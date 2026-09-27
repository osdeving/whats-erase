import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EvolutionClient,
  extractConnectionState,
  extractGroups,
  extractQrCode,
  summarizeDeleteAcknowledgement,
  TRACKED_WEBHOOK_EVENTS,
} from '../src/services/evolution-client.js';

const connection = { baseUrl: 'http://evolution:8080', apiKey: 'super-secret', instanceName: 'personal' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EvolutionClient', () => {
  it('configura o webhook no contrato da Evolution 2.3.7', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await new EvolutionClient(connection).configureWebhook('http://app:3000/api/webhooks/evolution', 'jwt-secret');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://evolution:8080/webhook/set/personal');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({ apikey: 'super-secret', 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      webhook: {
        enabled: true,
        url: 'http://app:3000/api/webhooks/evolution',
        headers: { jwt_key: 'jwt-secret' },
        byEvents: false,
        base64: false,
        events: [...TRACKED_WEBHOOK_EVENTS],
      },
    });
  });

  it('envia a chave exata para apagar para todos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await new EvolutionClient(connection).deleteForEveryone({
      id: 'MSG-1',
      remoteJid: '120363@g.us',
      participant: '5511@s.whatsapp.net',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://evolution:8080/chat/deleteMessageForEveryone/personal');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({
      id: 'MSG-1',
      remoteJid: '120363@g.us',
      fromMe: true,
      participant: '5511@s.whatsapp.net',
    });
  });

  it('busca grupos sem solicitar participantes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await new EvolutionClient(connection).fetchGroups();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://evolution:8080/group/fetchAllGroups/personal?getParticipants=false');
    expect(init.headers).toMatchObject({ apikey: 'super-secret' });
  });

  it('nao aceita uma base URL capaz de vazar a API key', () => {
    for (const baseUrl of [
      'ftp://evolution.local',
      'https://usuario:senha@evolution.local',
      'https://evolution.local?redirect=evil',
      'https://evolution.local/#fragmento',
    ]) {
      expect(() => new EvolutionClient({ ...connection, baseUrl })).toThrowError(
        expect.objectContaining({ code: 'INVALID_EVOLUTION_URL' }),
      );
    }
  });

  it('classifica falhas de autenticacao para pausar o daemon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(new EvolutionClient(connection).verifyCredentials()).rejects.toEqual(
      expect.objectContaining({
        code: 'EVOLUTION_HTTP_401',
        status: 401,
        permanent: false,
        pausesDaemon: true,
      }),
    );
  });
});

describe('extractGroups', () => {
  it('expoe somente identificador, nome e quantidade e ignora itens que nao sao grupos', () => {
    expect(
      extractGroups([
        {
          id: '1203632@g.us',
          subject: 'Equipe B',
          size: 8,
          participants: [{ id: '5511999@s.whatsapp.net', admin: 'admin' }],
          owner: '5511888@s.whatsapp.net',
        },
        { id: '5511777@s.whatsapp.net', subject: 'Contato' },
        { jid: '1203631@g.us', name: 'Equipe A', participantCount: 4 },
      ]),
    ).toEqual([
      { jid: '1203631@g.us', name: 'Equipe A', participantCount: 4 },
      { jid: '1203632@g.us', name: 'Equipe B', participantCount: 8 },
    ]);
  });

  it('recusa uma resposta sem uma lista em vez de simular que nao ha grupos', () => {
    expect(() => extractGroups({ status: 'open' })).toThrowError(
      expect.objectContaining({ code: 'EVOLUTION_INVALID_GROUPS_RESPONSE', status: 502 }),
    );
  });
});

describe('extractQrCode', () => {
  it('extrai base64 dos dois formatos usuais', () => {
    const qr = 'data:image/png;base64,abcdefghijklmnopqrstuvwxyz';
    expect(extractQrCode({ qrcode: { base64: qr } })).toBe(qr);
    expect(extractQrCode({ data: { qr } })).toBe(qr);
    expect(extractQrCode({ state: 'open' })).toBeNull();
  });
});

describe('extractConnectionState', () => {
  it('le o estado sem expor o restante da resposta da Evolution', () => {
    expect(extractConnectionState({ instance: { state: 'open', apikey: 'secret' } })).toBe('open');
    expect(extractConnectionState({ data: { status: 'connecting' } })).toBe('connecting');
    expect(extractConnectionState({ qrcode: { base64: 'abc' } })).toBeNull();
  });
});

describe('summarizeDeleteAcknowledgement', () => {
  it('mantem somente indicadores seguros do protocolo de revogacao', () => {
    expect(
      summarizeDeleteAcknowledgement({
        key: { id: 'ACK-1', remoteJid: 'grupo@g.us' },
        message: { protocolMessage: { type: 0, key: { id: 'MSG-1', remoteJid: 'grupo@g.us' } } },
      }),
    ).toEqual({ responseReceived: true, hasProtocolRevoke: true });
    expect(summarizeDeleteAcknowledgement(null)).toEqual({
      responseReceived: false,
      hasProtocolRevoke: false,
    });
  });
});
