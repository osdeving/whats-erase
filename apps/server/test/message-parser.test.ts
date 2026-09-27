import { describe, expect, it } from 'vitest';

import { parseEvolutionDeletedKeys, parseEvolutionMessages } from '../src/services/message-parser.js';

describe('parseEvolutionMessages', () => {
  it('aceita mensagens enviadas nos dois eventos suportados', () => {
    const base = {
      instance: 'personal',
      data: {
        key: { id: 'ABC123', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true },
        messageType: 'conversation',
        messageTimestamp: 1_800_000_000,
        message: { conversation: 'conteudo que nao deve ser persistido' },
      },
    };

    for (const event of ['MESSAGES_UPSERT', 'send.message']) {
      expect(parseEvolutionMessages({ ...base, event })).toEqual([
        expect.objectContaining({
          instance: 'personal',
          remoteJid: '5511999999999@s.whatsapp.net',
          messageId: 'ABC123',
          messageType: 'text',
          textContent: 'conteudo que nao deve ser persistido',
          fromMe: true,
        }),
      ]);
    }
  });

  it('descarta mensagens recebidas, broadcasts, newsletters e protocolos', () => {
    const payload = (data: Record<string, unknown>) => ({ event: 'messages.upsert', instance: 'personal', data });
    expect(
      parseEvolutionMessages(
        payload({ key: { id: '1', remoteJid: '5511@s.whatsapp.net', fromMe: false }, messageType: 'conversation' }),
      ),
    ).toEqual([]);
    expect(
      parseEvolutionMessages(
        payload({ key: { id: '2', remoteJid: 'status@broadcast', fromMe: true }, messageType: 'conversation' }),
      ),
    ).toEqual([]);
    expect(
      parseEvolutionMessages(
        payload({ key: { id: '3', remoteJid: 'canal@newsletter', fromMe: true }, messageType: 'conversation' }),
      ),
    ).toEqual([]);
    expect(
      parseEvolutionMessages(
        payload({
          key: { id: '4', remoteJid: '5511@s.whatsapp.net', fromMe: true },
          message: { protocolMessage: { type: 'REVOKE' } },
        }),
      ),
    ).toEqual([]);
  });

  it('identifica o tipo real dentro de wrappers efemeros/view-once', () => {
    const messages = parseEvolutionMessages({
      event: 'messages.upsert',
      instance: 'personal',
      data: {
        key: { id: 'IMG1', remoteJid: '120363@g.us', participant: '5511@s.whatsapp.net', fromMe: true },
        messageType: 'ephemeralMessage',
        message: {
          ephemeralMessage: {
            message: { viewOnceMessageV2: { message: { imageMessage: { caption: 'foto' } } } },
          },
        },
      },
    });

    expect(messages).toEqual([
      expect.objectContaining({
        messageType: 'image',
        participant: '5511@s.whatsapp.net',
        textContent: 'foto',
      }),
    ]);
  });

  it('extrai texto estendido e captions sem carregar metadados da midia', () => {
    const payload = (id: string, message: Record<string, unknown>) => ({
      event: 'messages.upsert',
      instance: 'personal',
      data: { key: { id, remoteJid: '120363@g.us', fromMe: true }, message },
    });

    expect(
      parseEvolutionMessages(payload('TEXT', { extendedTextMessage: { text: 'lembrete', matchedText: 'privado' } }))[0]
        ?.textContent,
    ).toBe('lembrete');
    expect(
      parseEvolutionMessages(payload('DOC', { documentMessage: { caption: 'apagar: contrato', fileName: 'secreto.pdf' } }))[0]
        ?.textContent,
    ).toBe('apagar: contrato');
    expect(parseEvolutionMessages(payload('AUDIO', { audioMessage: { seconds: 3 } }))[0]?.textContent).toBeNull();
  });

  it('marca texto acima do limite como indisponivel em vez de avaliar um trecho', () => {
    const [message] = parseEvolutionMessages({
      event: 'messages.upsert',
      instance: 'personal',
      data: {
        key: { id: 'LONG', remoteJid: '120363@g.us', fromMe: true },
        message: { conversation: `${'a'.repeat(10_000)}FIM` },
      },
    });

    expect(message).toHaveProperty('textContent', undefined);
  });

  it('usa um horario seguro quando o timestamp e invalido', () => {
    const now = new Date('2026-09-26T17:00:00.000Z');
    const [message] = parseEvolutionMessages(
      {
        event: 'messages.upsert',
        instance: 'personal',
        date_time: 'invalido',
        data: {
          key: { id: 'A', remoteJid: '5511@s.whatsapp.net', fromMe: true },
          messageTimestamp: 'nao-e-numero',
          message: { conversation: 'x' },
        },
      },
      now,
    );
    expect(message?.sentAt).toEqual(now);
  });
});

describe('parseEvolutionDeletedKeys', () => {
  it('aceita as formas plana e aninhada emitidas pela Evolution 2.3.7', () => {
    expect(
      parseEvolutionDeletedKeys({
        event: 'MESSAGES_DELETE',
        instance: 'personal',
        data: [
          { id: 'FLAT', remoteJid: '5511@s.whatsapp.net', fromMe: true },
          { key: { id: 'NESTED', remoteJid: '120363@g.us', fromMe: true } },
        ],
      }),
    ).toEqual([
      { instance: 'personal', remoteJid: '5511@s.whatsapp.net', messageId: 'FLAT' },
      { instance: 'personal', remoteJid: '120363@g.us', messageId: 'NESTED' },
    ]);
  });
});
