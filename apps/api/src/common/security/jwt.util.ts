import * as crypto from 'node:crypto';
import { UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { JwtAuthPayload, UserRole } from '@tutrago/shared-types';

const DEV_EPHEMERAL_JWT_SECRET = crypto
  .createHash('sha256')
  .update(`tutrago-jwt-dev-${process.cwd()}`)
  .digest('hex');

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim().length >= 16) {
    return secret.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new InternalServerErrorException(
      'Configuración crítica faltante: JWT_SECRET debe estar definido en producción.'
    );
  }
  return DEV_EPHEMERAL_JWT_SECRET;
}

export function normalizeUserRole(rawRole?: string): UserRole {
  const upper = (rawRole || '').trim().toUpperCase();
  if (upper === 'INCUBATIO_ADMIN' || upper === 'SUPERADMIN') {
    return UserRole.INCUBATIO_ADMIN;
  }
  if (upper === 'VENUE_ADMIN' || upper === 'OWNER' || upper === 'ADMIN') {
    return UserRole.VENUE_ADMIN;
  }
  if (upper === 'BAR_OPERATOR' || upper === 'BARTENDER' || upper === 'OPERATOR') {
    return UserRole.BAR_OPERATOR;
  }
  return UserRole.CONSUMER;
}

export function signAuthJwt(
  payload: Omit<JwtAuthPayload, 'iat' | 'exp'>,
  expiresInSeconds = 24 * 3600
): string {
  const secret = getJwtSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;
  const resolvedBarId = payload.assignedBarId ?? payload.barId ?? null;
  const fullPayload: JwtAuthPayload = {
    ...payload,
    role: normalizeUserRole(payload.role),
    barId: resolvedBarId,
    assignedBarId: resolvedBarId,
    iat,
    exp,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

export function verifyAuthJwt(token: string): JwtAuthPayload {
  const secret = getJwtSecret();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedException('Formato de token JWT inválido.');
  }

  const [b64Header, b64Payload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new UnauthorizedException('Firma criptográfica de JWT inválida.');
  }

  let payload: JwtAuthPayload;
  try {
    payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
  } catch {
    throw new UnauthorizedException('Payload de JWT corrupto.');
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException('El token de sesión ha expirado.');
  }

  const resolvedBarId = payload.assignedBarId ?? payload.barId ?? null;
  return {
    ...payload,
    role: normalizeUserRole(payload.role),
    barId: resolvedBarId,
    assignedBarId: resolvedBarId,
  };
}

export function safeComparePin(providedPin?: string, expectedPin?: string): boolean {
  if (!providedPin || !expectedPin) return false;
  const a = Buffer.from(String(providedPin).trim(), 'utf8');
  const b = Buffer.from(String(expectedPin).trim(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

