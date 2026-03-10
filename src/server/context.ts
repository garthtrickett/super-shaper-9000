import { Elysia } from 'elysia';
import { Effect, Schema } from 'effect';
import { validateToken } from '../lib/server/JwtService';
import { getTenantDb, centralDb } from '../db/client';
import { config } from '../lib/server/Config';
import type { Tenant } from '../types/generated/central/public/Tenant';
import type { PlatformAdminId } from '../types/generated/central/public/PlatformAdmin';
import { PublicUserSchema, type PublicUser } from '../lib/shared/schemas';
import { ROLE_PERMISSIONS } from '../lib/shared/permissions';

/**
 * Grug extract subdomain from host string.
 * app.localhost:3000 -> app
 */
export const getRequestedSubdomain = (host: string | null): string | null => {
    if (!host) return null;
    const rootDomain = config.app.rootDomain;
    const hostname = host.split(':')[0] || '';

    if (hostname === rootDomain || hostname === '127.0.0.1') return null;
    if (hostname.endsWith('.' + rootDomain)) {
        return hostname.replace('.' + rootDomain, '');
    }
    return null;
};

/**
 * Grug look at permissions and guess what to call user.
 */
export const deriveRole = (permissions: string[] | null): string => {
    if (!permissions || permissions.length === 0) return "GUEST";
    
    const userPerms = [...permissions].sort();
    
    for (const [role, rolePerms] of Object.entries(ROLE_PERMISSIONS)) {
        const targetPerms = [...rolePerms].sort();
        if (JSON.stringify(userPerms) === JSON.stringify(targetPerms)) {
            return role;
        }
    }
    
    // Fallbacks
    if (permissions.includes("user:invite")) {
        return "ADMIN";
    }
    if (permissions.includes("note:create")) {
        return "MEMBER";
    }
    
    return "GUEST";
};

/**
 * Big middleware. Figure out who user is, what tenant they want, 
 * and if they are allowed to be there.
 */
export const userContext = (app: Elysia) => app.derive(
    { as: 'global' },
    async ({ request }) => {
        const host = request.headers.get('host');
        const headerSubdomain = request.headers.get('x-life-io-subdomain');
        const requestedSubdomain = headerSubdomain || getRequestedSubdomain(host);

        let tenant: Tenant | undefined;
        let userDb = null;

        const authHeader = request.headers.get('authorization');
        let user: PublicUser | null = null;
        let currentRole: string | null = null;
        let isPlatformAdmin = false;

        // 1. Authenticate JWT
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            const result = await Effect.runPromise(Effect.either(validateToken(token)));
            
            if (result._tag === 'Right') {
                const tokenUser = result.right;

                // Check if this is a Platform Admin (Global Overlord)
                const adminRecord = await centralDb
                    .selectFrom('platform_admin')
                    .select('id')
                    .where('id', '=', tokenUser.id as unknown as PlatformAdminId)
                    .executeTakeFirst();

                if (adminRecord) {
                    isPlatformAdmin = true;
                    user = tokenUser;
                    currentRole = 'PLATFORM_OWNER';
                } else {
                    user = tokenUser;
                }
            }
        }

        // 2. Resolve Tenant
        if (requestedSubdomain) {
            tenant = await centralDb
                .withSchema('public')
                .selectFrom('tenant')
                .selectAll()
                .where('subdomain', '=', requestedSubdomain)
                .executeTakeFirst();
        } else if (isPlatformAdmin || config.app.nodeEnv === 'development') {
            // Platform admin on root domain gets access to latest tenant for convenience
            tenant = await centralDb
                .withSchema('public')
                .selectFrom('tenant')
                .selectAll()
                .orderBy('created_at', 'desc')
                .limit(1)
                .executeTakeFirst();
        }

        if (tenant) {
            userDb = getTenantDb({
                id: tenant.id,
                tenant_strategy: (tenant.tenant_strategy || 'schema') as 'schema' | 'database',
                database_name: tenant.database_name,
                schema_name: tenant.schema_name
            });
        }

        // 3. Shadow Provisioning
        // If Platform Admin or Dev, ensure they have a record in the tenant user table
        // so permissions and sync work.
        if (user && userDb && (isPlatformAdmin || (!requestedSubdomain && config.app.nodeEnv === 'development'))) {
             try {
                // Grug fix: Handle email conflict. If admin@site.com exists with wrong ID,
                // we force the ID to match Central Auth so Replicache sync doesn't explode.
                await userDb
                    .insertInto('user')
                    .values({
                        id: user.id,
                        email: user.email,
                        password_hash: "shadow-admin-managed", 
                        email_verified: true,
                        permissions: [...ROLE_PERMISSIONS.OWNER], 
                        created_at: new Date(),
                        avatar_url: user.avatar_url
                    })
                    .onConflict((oc) => oc.column('email').doUpdateSet({
                        id: user?.id,
                        permissions: [...ROLE_PERMISSIONS.OWNER]
                    }))
                    .execute();
             } catch (e) {
                 // Non-fatal, usually happens if user already exists perfectly
                 console.error("[Context] Failed to provision shadow admin:", e);
             }
        }

        // 4. Load Tenant-Specific User Data
        if (user && !isPlatformAdmin && userDb) {
            try {
                const localUser = await userDb
                    .selectFrom('user')
                    .selectAll()
                    .where('id', '=', user.id)
                    .executeTakeFirst();

                if (localUser) {
                    user = Schema.decodeUnknownSync(PublicUserSchema)({
                        ...localUser,
                        created_at: localUser.created_at,
                    });
                    currentRole = deriveRole(localUser.permissions);
                } else {
                    // Authenticated globally but not a member of this tenant
                    user = null;
                    currentRole = null;
                }
            } catch (e) {
                const err = e as { code?: string };
                if (err.code !== '42P01') {
                    console.error('[Context] Local DB query failed:', e);
                }
            }
        } else if (user && !isPlatformAdmin && !userDb) {
             currentRole = "GUEST";
        }
// Scaffolding removed for Phase 1
export {};
