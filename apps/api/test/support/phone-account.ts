import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import type { PrismaClient } from '@salon/database';
import { createId, type UserRole } from '@salon/shared';
import request from 'supertest';

const used = new Set<string>();

/** Synthetic Iranian mobile. Unique inside this process. Not a real subscriber. */
export function syntheticMobile(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const phone = `09${randomInt(0, 1_000_000_000).toString().padStart(9, '0')}`;
    if (!used.has(phone)) {
      used.add(phone);
      return phone;
    }
  }
  throw new Error('Could not allocate a synthetic mobile number');
}

export async function hashTestPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

type HttpServer = Parameters<typeof request>[0];

export async function createProductOwnerSession(
  prisma: PrismaClient,
  http: HttpServer,
  input: {
    salonName?: string;
    ownerName?: string;
    password?: string;
    email?: string | null;
    additionalUsersAllowed?: boolean;
    accessState?: 'PRODUCT' | 'AWAITING_AGREEMENT' | 'AWAITING_PAYMENT';
  } = {},
) {
  const phone = syntheticMobile();
  const password = input.password ?? 'correct-horse-battery';
  const ownerName = input.ownerName ?? 'Owner';
  const salonId = createId();
  const userId = createId();
  const now = new Date();
  await prisma.salon.create({
    data: {
      id: salonId,
      name: input.salonName ?? 'Niloofar Salon',
      status: 'ACTIVE',
      accessState: input.accessState ?? 'PRODUCT',
      additionalUsersAllowed: input.additionalUsersAllowed ?? true,
      updatedAt: now,
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      salonId,
      name: ownerName,
      email: input.email ?? null,
      phone,
      passwordHash: await hashTestPassword(password),
      role: 'OWNER',
      status: 'ACTIVE',
      updatedAt: now,
    },
  });
  const login = await request(http).post('/auth/login/phone').send({ phone, password }).expect(201);
  return {
    phone,
    password,
    salonId,
    userId,
    accessToken: login.body.accessToken as string,
    body: {
      accessToken: login.body.accessToken as string,
      accessState: login.body.accessState as string,
      sessionScope: login.body.sessionScope as string,
      accountKind: login.body.accountKind as string,
      user: {
        id: userId,
        tenantId: salonId,
        name: ownerName,
        email: input.email ?? null,
        role: 'OWNER' as const,
      },
    },
  };
}

export async function createLoginUser(
  prisma: PrismaClient,
  input: {
    salonId: string;
    name: string;
    role: UserRole;
    password: string;
    email?: string | null;
    phone?: string;
  },
) {
  const phone = input.phone ?? syntheticMobile();
  const userId = createId();
  await prisma.user.create({
    data: {
      id: userId,
      salonId: input.salonId,
      name: input.name,
      email: input.email ?? null,
      phone,
      passwordHash: await hashTestPassword(input.password),
      role: input.role,
      status: 'ACTIVE',
      updatedAt: new Date(),
    },
  });
  return { phone, password: input.password, userId };
}

export function staffRequest(input: {
  name: string;
  role: UserRole;
  password: string;
  email?: string;
  phone?: string;
}) {
  return {
    name: input.name,
    role: input.role,
    password: input.password,
    phone: input.phone ?? syntheticMobile(),
    ...(input.email ? { email: input.email } : {}),
  };
}

export async function loginWithPhone(http: HttpServer, phone: string, password: string) {
  return request(http).post('/auth/login/phone').send({ phone, password });
}

export async function createPlatformAdminSession(
  prisma: PrismaClient,
  http: HttpServer,
  input: { name?: string; password?: string; email?: string | null } = {},
) {
  const phone = syntheticMobile();
  const password = input.password ?? 'platform-admin-password';
  const name = input.name ?? 'Platform Admin';
  const adminId = createId();
  await prisma.platformAdmin.create({
    data: {
      id: adminId,
      phone,
      email: input.email ?? null,
      name,
      passwordHash: await hashTestPassword(password),
      updatedAt: new Date(),
    },
  });
  const login = await request(http).post('/auth/login/phone').send({ phone, password }).expect(201);
  return {
    phone,
    password,
    adminId,
    accessToken: login.body.accessToken as string,
    body: login.body as {
      accessToken: string;
      accountKind: string;
      admin: { id: string; name: string };
    },
  };
}
