/**
 * Seed de demonstração — TODOS os dados são fictícios (nomes, telefones, endereços e senhas).
 * Uso: pnpm db:seed            (não faz nada se a organização demo já existir)
 *      pnpm db:reset-demo      (apaga e recria a organização demo)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addMinutes, computeCleaningWindow, localToUtc, utcToLocalParts } from '@hostops/shared';
import { hashPassword } from '@hostops/shared/password';
import { encryptSecret, parseEncryptionKey } from '@hostops/shared/secrets';
import { DateTime } from 'luxon';
import { createPrismaClient, syncRolesAndPermissions, type Db } from './index';

try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'));
} catch {
  /* variáveis já presentes no ambiente */
}

const SLUG = 'hostops-demo';
const TZ = 'America/Sao_Paulo';
const ORG_TABLES = [
  'auditLog', 'calendarSyncEvent', 'integration', 'notification', 'aiInteraction', 'guestRequest', 'message', 'conversation',
  'knowledgeArticle', 'maintenanceTicket', 'cleaningPhoto', 'cleaningTask', 'checklistTemplate', 'reservation', 'icalFeed', 'guest', 'property',
] as const;

async function resetDemo(db: Db) {
  const org = await db.organization.findUnique({ where: { slug: SLUG } });
  if (!org) return;
  for (const table of ORG_TABLES) {
    await (db[table] as unknown as { deleteMany(args: object): Promise<unknown> }).deleteMany({ where: { organizationId: org.id } });
  }
  const members = await db.organizationUser.findMany({ where: { organizationId: org.id } });
  await db.organizationUser.deleteMany({ where: { organizationId: org.id } });
  await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) }, email: { endsWith: '@hostops.demo' } } });
  await db.organization.delete({ where: { id: org.id } });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não definida.');
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY não definida (necessária para cifrar os segredos de exemplo).');
  const key = parseEncryptionKey(process.env.ENCRYPTION_KEY);
  const password = process.env.SEED_DEMO_PASSWORD ?? 'HostOps@Demo2026';
  const db = createPrismaClient(databaseUrl);

  try {
    await syncRolesAndPermissions(db);
    if (process.argv.includes('--reset')) await resetDemo(db);
    if (await db.organization.findUnique({ where: { slug: SLUG } })) {
      console.log('Organização de demonstração já existe. Use "pnpm db:reset-demo" para recriá-la.');
      return;
    }

    const today = DateTime.now().setZone(TZ).startOf('day');
    const date = (offset: number) => today.plus({ days: offset }).toFormat('yyyy-LL-dd');
    const at = (offset: number, time: string) => localToUtc(date(offset), time, TZ);
    const now = new Date();

    const org = await db.organization.create({ data: { name: 'Hospedagens Demo', slug: SLUG, timezone: TZ } });
    const roles = Object.fromEntries((await db.role.findMany()).map((r) => [r.key, r.id]));
    const passwordHash = await hashPassword(password);
    const createUser = async (name: string, email: string, phone: string, role: string) => {
      const user = await db.user.create({ data: { name, email, phone, passwordHash } });
      await db.organizationUser.create({ data: { organizationId: org.id, userId: user.id, roleId: roles[role]! } });
      return user;
    };
    const owner = await createUser('Pedro Almeida (demo)', 'owner@hostops.demo', '+5531900000100', 'OWNER');
    const marina = await createUser('Marina Souza (demo)', 'marina@hostops.demo', '+5531900000101', 'CLEANER');
    const carla = await createUser('Carla Dias (demo)', 'carla@hostops.demo', '+5531900000102', 'CLEANER');

    const propertyData = [
      { code: 'LOFT402', name: 'Loft Jardim 402', addressLine: 'Rua das Acácias Fictícias, 120 — apto 402', maxGuests: 2, cleaner: marina.id, wifi: 'LoftJardim402' },
      { code: 'STUDIO71', name: 'Studio Mirante 71', addressLine: 'Av. do Mirante Imaginário, 71', maxGuests: 2, cleaner: carla.id, wifi: 'StudioMirante' },
      { code: 'CASALAGOA', name: 'Casa da Lagoa', addressLine: 'Alameda dos Ipês Inventados, 45', maxGuests: 6, cleaner: marina.id, wifi: 'CasaLagoa', cleaning: 240 },
      { code: 'APTO1203', name: 'Apto Central 1203', addressLine: 'Rua do Exemplo, 900 — apto 1203', maxGuests: 4, cleaner: carla.id, wifi: 'Apto1203' },
      { code: 'FLAT88', name: 'Flat Serra 88', addressLine: 'Rua Serra de Mentira, 88', maxGuests: 2, cleaner: null, wifi: 'FlatSerra88' },
    ];
    const properties = [];
    for (const [index, p] of propertyData.entries()) {
      properties.push(
        await db.property.create({
          data: {
            organizationId: org.id,
            code: p.code,
            name: p.name,
            addressLine: p.addressLine,
            city: 'Belo Horizonte',
            state: 'MG',
            checkInTime: '15:00',
            checkOutTime: '11:00',
            cleaningDurationMinutes: p.cleaning ?? 180,
            maxGuests: p.maxGuests,
            wifiName: p.wifi,
            wifiPasswordEnc: encryptSecret(`demo-wifi-${index + 1}-${p.code.toLowerCase()}`, key),
            accessCodeEnc: encryptSecret(`${4100 + index * 111}`, key),
            checkInInstructions:
              'Ao chegar, digite o código de acesso na fechadura eletrônica da porta e confirme com #. A portaria (fictícia) funciona 24h. Check-in a partir das 15h.',
            houseRules: 'Silêncio após as 22h. Proibido fumar no interior do imóvel. Não são permitidas festas.',
            defaultCleanerId: p.cleaner,
          },
        }),
      );
    }
    const [loft, studio, casa, apto, flat] = properties as [typeof properties[0], typeof properties[0], typeof properties[0], typeof properties[0], typeof properties[0]];

    const guestNames = ['Fernanda Moreira', 'Lucas Andrade', 'Beatriz Rocha', 'Carlos Teixeira', 'Juliana Prado', 'Rafael Nunes', 'Camila Barros'];
    const guests = [];
    for (const [i, name] of guestNames.entries()) {
      guests.push(
        await db.guest.create({
          data: { organizationId: org.id, name: `${name} (fictício)`, phone: `+55319000000${String(i + 1).padStart(2, '0')}`, email: `hospede${i + 1}@exemplo.test` },
        }),
      );
    }

    const template = await db.checklistTemplate.create({
      data: {
        organizationId: org.id,
        name: 'Checklist padrão de turnover',
        isDefault: true,
        items: {
          create: [
            'Trocar roupa de cama',
            'Trocar toalhas e repor amenities',
            'Higienizar banheiro',
            'Limpar cozinha e geladeira',
            'Aspirar e passar pano no piso',
            'Conferir controles e fechadura',
          ]
            .map((label, position) => ({ label, position, requiresPhoto: false }))
            .concat([{ label: 'Foto do imóvel pronto (sala e quarto)', position: 6, requiresPhoto: true }]),
        },
      },
      include: { items: { orderBy: { position: 'asc' } } },
    });

    type Seed = { property: typeof loft; guest: number | null; channel: 'AIRBNB' | 'BOOKING' | 'DIRECT'; in: number; out: number; status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'BLOCKED'; count?: number; ext?: string; notes?: string };
    const reservationSeeds: Seed[] = [
      { property: loft, guest: 0, channel: 'AIRBNB', in: -3, out: 0, status: 'CHECKED_IN', count: 2, ext: 'DEMO-AIR-1001' },
      { property: loft, guest: 1, channel: 'DIRECT', in: 0, out: 3, status: 'CONFIRMED', count: 2, notes: 'Troca no mesmo dia: limpeza entre 11h e 15h.' },
      { property: studio, guest: 2, channel: 'BOOKING', in: -1, out: 2, status: 'CHECKED_IN', count: 1, ext: 'DEMO-BKG-2001' },
      { property: studio, guest: 3, channel: 'DIRECT', in: 5, out: 8, status: 'CONFIRMED', count: 2 },
      { property: casa, guest: 4, channel: 'AIRBNB', in: -6, out: -2, status: 'CHECKED_OUT', count: 5, ext: 'DEMO-AIR-1002' },
      { property: casa, guest: 5, channel: 'AIRBNB', in: 1, out: 4, status: 'CONFIRMED', count: 4, ext: 'DEMO-AIR-1003' },
      { property: apto, guest: 6, channel: 'BOOKING', in: -4, out: -1, status: 'CHECKED_OUT', count: 3, ext: 'DEMO-BKG-2002' },
      { property: apto, guest: 0, channel: 'DIRECT', in: 2, out: 5, status: 'CONFIRMED', count: 2 },
      { property: flat, guest: 2, channel: 'DIRECT', in: 7, out: 10, status: 'PENDING', count: 2 },
      { property: flat, guest: 3, channel: 'BOOKING', in: 10, out: 12, status: 'CONFIRMED', count: 1, ext: 'DEMO-BKG-2003' },
      { property: flat, guest: null, channel: 'DIRECT', in: 20, out: 22, status: 'BLOCKED', notes: 'Bloqueio do proprietário (manutenção preventiva).' },
    ];
    const reservations = [];
    for (const r of reservationSeeds) {
      reservations.push(
        await db.reservation.create({
          data: {
            organizationId: org.id,
            propertyId: r.property.id,
            guestId: r.guest === null ? null : guests[r.guest]!.id,
            channel: r.channel,
            externalId: r.ext ?? null,
            checkIn: at(r.in, r.property.checkInTime),
            checkOut: at(r.out, r.property.checkOutTime),
            guestCount: r.count ?? 1,
            status: r.status,
            notes: r.notes ?? null,
          },
        }),
      );
    }

    // Tarefas de limpeza: uma por estadia, com a janela calculada pela mesma regra do sistema.
    const stays = reservations.filter((r) => r.status !== 'BLOCKED');
    for (const stay of stays) {
      const property = properties.find((p) => p.id === stay.propertyId)!;
      const next = stays.filter((s) => s.propertyId === stay.propertyId && s.checkIn >= stay.checkOut).sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())[0];
      const window = computeCleaningWindow({ checkOut: stay.checkOut, nextCheckIn: next?.checkIn, cleaningMinutes: property.cleaningDurationMinutes });
      const isCasaPast = stay.propertyId === casa.id && stay.status === 'CHECKED_OUT';
      const cleanerId = property.defaultCleanerId;
      // Casa da Lagoa: limpeza passada já concluída (com confirmação registrada). Apto 1203: atrasada, ainda aberta.
      const status = isCasaPast ? 'DONE' : cleanerId ? 'ASSIGNED' : 'PENDING';
      const startedAt = isCasaPast ? addMinutes(window.windowStart, 30) : null;
      const completedAt = isCasaPast ? addMinutes(window.windowStart, 250) : null;
      await db.cleaningTask.create({
        data: {
          organizationId: org.id,
          propertyId: property.id,
          reservationId: stay.id,
          nextReservationId: next?.id ?? null,
          cleanerId,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          estimatedMinutes: property.cleaningDurationMinutes,
          status,
          hasConflict: window.hasConflict,
          conflictReason: window.conflictReason,
          startedAt,
          completedAt,
          completedById: isCasaPast ? cleanerId : null,
          notes: isCasaPast ? 'Limpeza de demonstração concluída (sem arquivos de foto no seed).' : null,
          items: {
            create: template.items.map((item) => ({
              label: item.label,
              position: item.position,
              requiresPhoto: item.requiresPhoto,
              checkedAt: isCasaPast ? completedAt : null,
              checkedById: isCasaPast ? cleanerId : null,
            })),
          },
        },
      });
    }

    await db.knowledgeArticle.createMany({
      data: [
        { organizationId: org.id, propertyId: null, title: 'Horários de check-in e check-out', category: 'Estadia', content: 'O check-in é a partir das 15h e o check-out até as 11h. Pedidos de horário diferente precisam de aprovação da equipe.' },
        { organizationId: org.id, propertyId: null, title: 'Lixo e reciclagem', category: 'Casa', content: 'O lixo comum deve ser deixado na lixeira do andar. Recicláveis ficam no contêiner azul da garagem.' },
        { organizationId: org.id, propertyId: loft.id, title: 'Estacionamento', category: 'Prédio', content: 'O Loft Jardim 402 tem direito a uma vaga coberta, número 27 (fictícia), no subsolo 1.' },
        { organizationId: org.id, propertyId: casa.id, title: 'Churrasqueira e área externa', category: 'Casa', content: 'A churrasqueira pode ser usada até as 22h. O carvão não está incluso. A piscina não é aquecida.' },
        { organizationId: org.id, propertyId: studio.id, title: 'Ar-condicionado', category: 'Equipamentos', content: 'O controle fica na gaveta da mesa de cabeceira. Mantenha as janelas fechadas com o aparelho ligado.' },
      ],
    });

    await db.maintenanceTicket.createMany({
      data: [
        { organizationId: org.id, propertyId: flat.id, title: 'Ar-condicionado não gela', description: 'Aparelho liga mas não refrigera. Verificar gás antes da próxima reserva.', priority: 'HIGH', status: 'IN_PROGRESS', source: 'STAFF', reportedById: owner.id },
        { organizationId: org.id, propertyId: apto.id, title: 'Lâmpada da sala queimada', description: 'Trocar lâmpada do lustre principal.', priority: 'LOW', status: 'OPEN', source: 'STAFF', reportedById: carla.id },
      ],
    });

    // Conversa de exemplo (registros ilustrativos; nenhuma mensagem foi enviada de fato pelo WhatsApp).
    const guest = guests[1]!;
    const conversation = await db.conversation.create({
      data: {
        organizationId: org.id,
        guestId: guest.id,
        propertyId: loft.id,
        reservationId: reservations[1]!.id,
        contactPhone: guest.phone!,
        contactName: guest.name,
        status: 'HUMAN',
        handoffReason: 'Pedido de Check-in antecipado aguardando autorização humana.',
        lastMessageAt: addMinutes(now, -40),
      },
    });
    await db.message.createMany({
      data: [
        { organizationId: org.id, conversationId: conversation.id, direction: 'INBOUND', sender: 'GUEST', body: 'Olá! Consigo entrar às 12h hoje?', status: 'RECEIVED', externalId: 'wamid.DEMO-SEED-1', createdAt: addMinutes(now, -42) },
        { organizationId: org.id, conversationId: conversation.id, direction: 'OUTBOUND', sender: 'AI', body: '[exemplo do seed] Registrei seu pedido de check-in antecipado. Nossa equipe vai analisar e responde por aqui.', status: 'SENT', createdAt: addMinutes(now, -41) },
      ],
    });
    await db.guestRequest.create({
      data: {
        organizationId: org.id,
        conversationId: conversation.id,
        reservationId: reservations[1]!.id,
        propertyId: loft.id,
        guestId: guest.id,
        type: 'EARLY_CHECKIN',
        description: 'Hóspede pede para entrar às 12h (check-in padrão às 15h).',
        requiresHumanApproval: true,
      },
    });
    await db.auditLog.create({
      data: { organizationId: org.id, actorType: 'SYSTEM', action: 'seed.demo', entityType: 'Organization', entityId: org.id, metadata: { properties: 5, reservations: reservations.length } },
    });

    const local = utcToLocalParts(now, TZ);
    console.log(`\nSeed concluído (${local.date} ${local.time}, ${TZ}). Dados 100% fictícios.`);
    console.log('  Organização : Hospedagens Demo');
    console.log(`  Proprietário: owner@hostops.demo  /  ${password}`);
    console.log(`  Diaristas   : marina@hostops.demo e carla@hostops.demo  /  ${password}`);
    console.log(`  Imóveis: 5 · Hóspedes: ${guests.length} · Reservas: ${reservations.length} · Limpezas: ${stays.length}\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error('Falha no seed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
