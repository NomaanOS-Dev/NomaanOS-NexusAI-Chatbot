import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { hashPassword } from '../src/services/password.js';
import { config } from '../src/config/env.js';

describe('Day 3: Authentication, Authorization, and Tenant Isolation Security Suite', () => {
  const app = createApp();

  // Test data identifiers
  const tenantAEmail = `tenant-a-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const tenantBEmail = `tenant-b-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const memberCEmail = `member-c-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const securePassword = 'TestPassword123!';

  let tenantAToken: string;
  let tenantBToken: string;
  let memberCToken: string;

  let tenantAUserId: string;
  let tenantBUserId: string;
  let memberCUserId: string;

  let tenantAWorkspaceId: string;
  let tenantBWorkspaceId: string;

  let tenantAApplicationId: string;
  let tenantBApplicationId: string;

  let tenantAAssistantId: string;
  let tenantBAssistantId: string;

  let tenantAKnowledgeSpaceId: string;
  let tenantBKnowledgeSpaceId: string;

  let tenantACredentialId: string;

  afterAll(async () => {
    // Clean up test data by deleting organizations created for these emails
    try {
      await pool.query(
        `DELETE FROM users WHERE email IN ($1, $2, $3);`,
        [tenantAEmail, tenantBEmail, memberCEmail]
      );
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('1. Unauthenticated Access Controls', () => {
    it('Rejects unauthenticated requests to protected endpoints with 401', async () => {
      const endpoints = [
        { method: 'get', url: '/api/v1/auth/me' },
        { method: 'get', url: '/api/v1/workspaces' },
        { method: 'get', url: '/api/v1/workspaces/00000000-0000-0000-0000-000000000000' },
        { method: 'post', url: '/api/v1/workspaces' },
      ];

      for (const ep of endpoints) {
        const res = await (request(app) as any)[ep.method](ep.url);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
      }
    });

    it('Rejects requests with malformed or tampered Bearer token with 401', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token-12345');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });

  describe('2. User Registration & Session Management', () => {
    it('Registers Tenant A, creates user, org, and workspace, returns session token and cookie', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: tenantAEmail,
          password: securePassword,
          fullName: 'Alice Tenant A',
          organizationName: 'Alpha Corp',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ok');
      expect(res.body.user.email).toBe(tenantAEmail);
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.workspace.name).toBe('Default Workspace');
      expect(res.body.token).toBeDefined();

      tenantAToken = res.body.token;
      tenantAUserId = res.body.user.id;
      tenantAWorkspaceId = res.body.workspace.id;

      // Verify Set-Cookie header contains HttpOnly session token
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      expect(cookieStr).toContain(config.auth.sessionCookieName);
      expect(cookieStr.toLowerCase()).toContain('httponly');
    });

    it('Registers Tenant B independently', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: tenantBEmail,
          password: securePassword,
          fullName: 'Bob Tenant B',
          organizationName: 'Beta Inc',
        });

      expect(res.status).toBe(201);
      tenantBToken = res.body.token;
      tenantBUserId = res.body.user.id;
      tenantBWorkspaceId = res.body.workspace.id;

      expect(tenantBWorkspaceId).not.toBe(tenantAWorkspaceId);
    });

    it('Registers Member C (for RBAC testing)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: memberCEmail,
          password: securePassword,
          fullName: 'Charlie Member C',
          organizationName: 'Charlie Freelance',
        });

      expect(res.status).toBe(201);
      memberCToken = res.body.token;
      memberCUserId = res.body.user.id;
    });

    it('Rejects duplicate email registration with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: tenantAEmail,
          password: securePassword,
          fullName: 'Duplicate Alice',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Conflict');
    });

    it('Enforces password complexity (min 8 chars, mixed case, number)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: `weak-${crypto.randomUUID().slice(0, 6)}@example.com`,
          password: 'weak',
          fullName: 'Weak Password User',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('Authenticates valid user via /login', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: tenantAEmail,
          password: securePassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(tenantAEmail);
      expect(res.body.token).toBeDefined();
    });

    it('Rejects invalid password with generic error message and 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: tenantAEmail,
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password.');
    });

    it('Returns authenticated user profile via /auth/me without password hash', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(tenantAUserId);
      expect(res.body.user.email).toBe(tenantAEmail);
      expect(res.body.user.passwordHash).toBeUndefined();
    });
  });

  describe('3. Multi-Tenant Workspace & Resource Isolation', () => {
    it('Tenant A lists only their own workspaces; Tenant B workspaces are not visible', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.workspaces.map((w: any) => w.id);
      expect(ids).toContain(tenantAWorkspaceId);
      expect(ids).not.toContain(tenantBWorkspaceId);
    });

    it('Tenant B cannot access Tenant A workspace (Anti-enumeration returns 404)', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      // Must be 404, NOT 403, to prevent workspace UUID enumeration
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFound');
    });

    it('Tenant A creates an application in Workspace A', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${tenantAWorkspaceId}/applications`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          name: 'Alpha Customer Portal',
          appKey: 'alpha-portal',
          allowedOrigins: ['https://alpha.example.com'],
        });

      expect(res.status).toBe(201);
      expect(res.body.application.name).toBe('Alpha Customer Portal');
      expect(res.body.application.workspaceId).toBe(tenantAWorkspaceId);
      tenantAApplicationId = res.body.application.id;
    });

    it('Tenant B cannot read, update, or delete Tenant A application (404)', async () => {
      // Read
      const getRes = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}/applications/${tenantAApplicationId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(getRes.status).toBe(404);

      // Attempt access using B's workspace ID and A's app ID
      const spoofRes = await request(app)
        .get(`/api/v1/workspaces/${tenantBWorkspaceId}/applications/${tenantAApplicationId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(spoofRes.status).toBe(404);

      // Delete
      const delRes = await request(app)
        .delete(`/api/v1/workspaces/${tenantAWorkspaceId}/applications/${tenantAApplicationId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(delRes.status).toBe(404);
    });

    it('Tenant A creates an assistant in Workspace A', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${tenantAWorkspaceId}/assistants`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          name: 'Alpha Guide',
          assistantKey: 'alpha-guide',
          systemPrompt: 'You are the Alpha AI assistant for customer service.',
          modelPolicy: 'cloud-preferred',
          applicationId: tenantAApplicationId,
          publicEmbedAllowed: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.assistant.name).toBe('Alpha Guide');
      expect(res.body.assistant.workspace_id).toBe(tenantAWorkspaceId);
      tenantAAssistantId = res.body.assistant.id;
    });

    it('Tenant B cannot access or modify Tenant A assistant', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}/assistants/${tenantAAssistantId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(res.status).toBe(404);

      const delRes = await request(app)
        .delete(`/api/v1/workspaces/${tenantBWorkspaceId}/assistants/${tenantAAssistantId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(delRes.status).toBe(404);
    });

    it('Tenant A creates a knowledge space in Workspace A', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${tenantAWorkspaceId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          name: 'Alpha Documentation',
          slug: 'alpha-docs',
          description: 'Official Alpha documentation space',
        });

      expect(res.status).toBe(201);
      expect(res.body.knowledgeSpace.slug).toBe('alpha-docs');
      expect(res.body.knowledgeSpace.workspace_id).toBe(tenantAWorkspaceId);
      tenantAKnowledgeSpaceId = res.body.knowledgeSpace.id;
    });

    it('Tenant B cannot read or delete Tenant A knowledge space', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}/knowledge-spaces/${tenantAKnowledgeSpaceId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(res.status).toBe(404);

      const delRes = await request(app)
        .delete(`/api/v1/workspaces/${tenantBWorkspaceId}/knowledge-spaces/${tenantAKnowledgeSpaceId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(delRes.status).toBe(404);
    });
  });

  describe('4. Cross-Tenant Association & Reference Protection', () => {
    beforeAll(async () => {
      // Create resources in Tenant B's workspace for cross-tenant injection tests
      const appRes = await request(app)
        .post(`/api/v1/workspaces/${tenantBWorkspaceId}/applications`)
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({
          name: 'Beta Storefront',
          appKey: 'beta-store',
          allowedOrigins: ['https://beta.example.com'],
        });
      tenantBApplicationId = appRes.body.application.id;

      const ksRes = await request(app)
        .post(`/api/v1/workspaces/${tenantBWorkspaceId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({
          name: 'Beta Internal Wiki',
          slug: 'beta-wiki',
        });
      tenantBKnowledgeSpaceId = ksRes.body.knowledgeSpace.id;

      const asstRes = await request(app)
        .post(`/api/v1/workspaces/${tenantBWorkspaceId}/assistants`)
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({
          name: 'Beta Agent',
          assistantKey: 'beta-agent',
          systemPrompt: 'You are the Beta agent assisting users.',
        });
      tenantBAssistantId = asstRes.body.assistant.id;
    });

    it('Rejects creating an assistant in Workspace A linked to Tenant B application', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${tenantAWorkspaceId}/assistants`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          name: 'Cross-Tenant Malicious Assistant',
          assistantKey: 'bad-assistant',
          systemPrompt: 'Should fail immediately due to cross-tenant application ID.',
          applicationId: tenantBApplicationId, // Cross-tenant!
        });

      // Must fail with 400 or 404, preventing cross-tenant linkage
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('does not exist in this workspace');
    });

    it('Rejects linking Tenant B knowledge space to Tenant A assistant', async () => {
      const res = await request(app)
        .post(
          `/api/v1/workspaces/${tenantAWorkspaceId}/assistants/${tenantAAssistantId}/knowledge-spaces/${tenantBKnowledgeSpaceId}`
        )
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found in this workspace');
    });

    it('Successfully links legitimate intra-workspace knowledge space to assistant', async () => {
      const res = await request(app)
        .post(
          `/api/v1/workspaces/${tenantAWorkspaceId}/assistants/${tenantAAssistantId}/knowledge-spaces/${tenantAKnowledgeSpaceId}`
        )
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('successfully linked');

      // Verify it appears in assistant's knowledge spaces
      const listRes = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}/assistants/${tenantAAssistantId}/knowledge-spaces`)
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.knowledgeSpaces.length).toBe(1);
      expect(listRes.body.knowledgeSpaces[0].id).toBe(tenantAKnowledgeSpaceId);
    });
  });

  describe('5. Hierarchical RBAC & Privilege Escalation Protection', () => {
    it('Owner adds Charlie to Workspace A with role viewer', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${tenantAWorkspaceId}/members`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          userId: memberCUserId,
          role: 'viewer',
        });

      expect(res.status).toBe(201);
      expect(res.body.member.role).toBe('viewer');
    });

    it('Viewer (Charlie) CAN read workspace resources', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}/applications`)
        .set('Authorization', `Bearer ${memberCToken}`);

      expect(res.status).toBe(200);
      expect(res.body.applications.length).toBeGreaterThanOrEqual(1);
    });

    it('Viewer (Charlie) CANNOT create applications (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${tenantAWorkspaceId}/applications`)
        .set('Authorization', `Bearer ${memberCToken}`)
        .send({
          name: 'Unauthorized App',
          appKey: 'unauth-app',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('Viewer (Charlie) CANNOT delete assistants (403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/api/v1/workspaces/${tenantAWorkspaceId}/assistants/${tenantAAssistantId}`)
        .set('Authorization', `Bearer ${memberCToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('Viewer (Charlie) CANNOT promote himself or change member roles (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${tenantAWorkspaceId}/members/${memberCUserId}`)
        .set('Authorization', `Bearer ${memberCToken}`)
        .send({
          role: 'owner',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('Sole Owner cannot remove themselves from workspace', async () => {
      const res = await request(app)
        .delete(`/api/v1/workspaces/${tenantAWorkspaceId}/members/${tenantAUserId}`)
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cannot remove the sole owner');
    });

    it('Sole Owner cannot demote themselves to viewer', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${tenantAWorkspaceId}/members/${tenantAUserId}`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          role: 'viewer',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cannot demote the sole owner');
    });
  });

  describe('6. Encrypted Provider Credentials & Masking Security', () => {
    const rawApiKey = 'sk-proj-testSecretApiKey1234567890abcdefghijklmnopqrstuvwxyz';

    it('Admin saves provider credential; returns masked fingerprint and never plaintext', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${tenantAWorkspaceId}/credentials`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          provider: 'openai',
          keyName: 'Production OpenAI Key',
          apiKey: rawApiKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.credential.provider).toBe('openai');
      expect(res.body.credential.keyFingerprint).toBeDefined();
      expect(res.body.credential.keyFingerprint).not.toBe(rawApiKey);
      expect(res.body.credential.keyFingerprint).toContain('...');
      expect(res.body.credential.apiKey).toBeUndefined();
      expect(res.body.credential.encryptedApiKey).toBeUndefined();

      tenantACredentialId = res.body.credential.id;
    });

    it('Database stores ciphertext, NOT plaintext API key', async () => {
      const dbRes = await pool.query(
        `SELECT encrypted_api_key, key_fingerprint FROM provider_credentials WHERE id = $1;`,
        [tenantACredentialId]
      );

      expect(dbRes.rows.length).toBe(1);
      const row = dbRes.rows[0];
      // Ciphertext should not match raw API key
      expect(row.encrypted_api_key).not.toBe(rawApiKey);
      // Ciphertext must be IV:AuthTag:Ciphertext format (hex colon-separated)
      expect(row.encrypted_api_key.split(':').length).toBe(3);
    });

    it('Listing credentials returns masked fingerprints only (zero secret leakage)', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}/credentials`)
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.credentials.length).toBe(1);
      const cred = res.body.credentials[0];
      expect(cred.keyFingerprint).toBeDefined();
      expect(cred.apiKey).toBeUndefined();
      expect(cred.encryptedApiKey).toBeUndefined();
    });

    it('Viewer (Charlie) CANNOT access credentials (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}/credentials`)
        .set('Authorization', `Bearer ${memberCToken}`);

      expect(res.status).toBe(403);
    });

    it('Tenant B CANNOT access Tenant A credentials (404 Anti-enumeration)', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${tenantAWorkspaceId}/credentials`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('7. Public Assistant Configuration Endpoint (Widget-Safe)', () => {
    it('Public assistant config returns safe widget properties without credentials or system prompt', async () => {
      const res = await request(app).get(`/api/v1/assistants/${tenantAAssistantId}/config`);

      expect(res.status).toBe(200);
      expect(res.body.assistantId).toBe(tenantAAssistantId);
      expect(res.body.name).toBe('Alpha Guide');
      expect(res.body.capabilities.streaming).toBe(true);

      // CRITICAL: MUST NEVER leak internal prompt or secrets
      expect(res.body.systemPrompt).toBeUndefined();
      expect(res.body.system_prompt).toBeUndefined();
      expect(res.body.apiKey).toBeUndefined();
      expect(res.body.modelPolicy).toBeUndefined();
    });

    it('Private assistant config rejects unauthenticated caller with 404', async () => {
      // Create a private assistant (publicEmbedAllowed = false)
      const privateAsstRes = await request(app)
        .post(`/api/v1/workspaces/${tenantAWorkspaceId}/assistants`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          name: 'Private Internal HR Bot',
          assistantKey: 'private-hr-bot',
          systemPrompt: 'Confidential internal instructions.',
          publicEmbedAllowed: false,
        });

      const privateId = privateAsstRes.body.assistant.id;

      // Unauthenticated request should be 404
      const res = await request(app).get(`/api/v1/assistants/${privateId}/config`);
      expect(res.status).toBe(404);

      // Authenticated member of workspace CAN access
      const authRes = await request(app)
        .get(`/api/v1/assistants/${privateId}/config`)
        .set('Authorization', `Bearer ${tenantAToken}`);
      expect(authRes.status).toBe(200);
      expect(authRes.body.name).toBe('Private Internal HR Bot');
    });
  });

  describe('8. Audit Trail Verification & Zero-Secret Logging', () => {
    it('Audit log contains recorded security events without sensitive credential leaks', async () => {
      const auditRes = await pool.query(
        `SELECT action, resource_type, details FROM audit_events 
         WHERE workspace_id = $1 
         ORDER BY created_at DESC;`,
        [tenantAWorkspaceId]
      );

      expect(auditRes.rows.length).toBeGreaterThanOrEqual(3);
      const actions = auditRes.rows.map((r: any) => r.action);
      expect(actions).toContain('application_created');
      expect(actions).toContain('assistant_created');
      expect(actions).toContain('provider_credential_saved');

      // Verify no raw API key or password is saved in details
      for (const row of auditRes.rows) {
        const detailsStr = JSON.stringify(row.details || {});
        expect(detailsStr).not.toContain('sk-proj-testSecretApiKey');
        expect(detailsStr).not.toContain('TestPassword123!');
      }
    });
  });

  describe('9. Rate Limiting Protection', () => {
    it('Enforces sliding-window rate limit and returns 429 Too Many Requests when threshold exceeded', async () => {
      let hitRateLimit = false;

      // authRateLimiter has maxRequests: 15
      for (let i = 0; i < 18; i++) {
        const res = await request(app)
          .post('/api/v1/auth/login')
          .set('x-test-rate-limit', 'true')
          .set('X-Forwarded-For', '203.0.113.199')
          .send({
            email: 'rate-limit-test@example.com',
            password: 'BadPassword123!',
          });

        if (res.status === 429) {
          hitRateLimit = true;
          expect(res.body.error).toBe('TooManyRequests');
          expect(res.headers['retry-after']).toBeDefined();
          break;
        }
      }

      expect(hitRateLimit).toBe(true);
    });
  });
});
