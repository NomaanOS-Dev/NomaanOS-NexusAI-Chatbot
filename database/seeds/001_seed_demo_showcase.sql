-- ============================================================================
-- Seed Data for Phase 1 Universal Widget Showcase
-- Provides 3 Host Applications, Assistants, and Grounded Knowledge Spaces
-- ============================================================================

DO $$
DECLARE
    v_org_id UUID := '00000000-0000-0000-0000-000000000001';
    v_ws_id UUID := '00000000-0000-0000-0000-000000000002';
    v_app_sentinel UUID := '00000000-0000-0000-0000-000000000010';
    v_app_docs UUID := '00000000-0000-0000-0000-000000000020';
    v_app_cloud UUID := '00000000-0000-0000-0000-000000000030';
    
    v_asst_sentinel UUID := '4f9d1462-8321-4f11-8be8-2d83ba32d1e0';
    v_asst_docs UUID := '91a82f04-8b1e-4509-a1b4-ff70f7d4e320';
    v_asst_cloud UUID := 'e81a9f04-1111-4509-a1b4-ff70f7d4e320';

    v_ks_sentinel UUID := '00000000-0000-0000-0000-000000000101';
    v_ks_docs UUID := '00000000-0000-0000-0000-000000000102';
    v_ks_cloud UUID := '00000000-0000-0000-0000-000000000103';

    v_ds_sentinel UUID := '00000000-0000-0000-0000-000000000201';
    v_ds_docs UUID := '00000000-0000-0000-0000-000000000202';
    v_ds_cloud UUID := '00000000-0000-0000-0000-000000000203';

    v_dv_sentinel UUID := '00000000-0000-0000-0000-000000000301';
    v_dv_docs UUID := '00000000-0000-0000-0000-000000000302';
    v_dv_cloud UUID := '00000000-0000-0000-0000-000000000303';
BEGIN
    -- 1. Showcase Organization
    INSERT INTO organizations (id, name, slug, status)
    VALUES (v_org_id, 'NomaanOS Ecosystem', 'nomaanos-showcase', 'active')
    ON CONFLICT (id) DO NOTHING;

    -- 2. Showcase Workspace
    INSERT INTO workspaces (id, organization_id, name, slug, status)
    VALUES (v_ws_id, v_org_id, 'NomaanOS Showcase Workspace', 'showcase-workspace', 'active')
    ON CONFLICT (id) DO NOTHING;

    -- 3. Host Applications
    INSERT INTO applications (id, workspace_id, name, app_key, status, allowed_origins)
    VALUES 
        (v_app_sentinel, v_ws_id, 'Sentinel SOC Application', 'nomaanos-sentinel', 'active', ARRAY['http://localhost:5173', 'http://127.0.0.1:5173']),
        (v_app_docs, v_ws_id, 'Developer Docs Application', 'nomaanos-docs', 'active', ARRAY['http://localhost:5173', 'http://127.0.0.1:5173']),
        (v_app_cloud, v_ws_id, 'Cloud Operations Application', 'nomaanos-cloud', 'active', ARRAY['http://localhost:5173', 'http://127.0.0.1:5173'])
    ON CONFLICT (id) DO NOTHING;

    -- 4. Assistants (Sentinel, Docs, Cloud)
    INSERT INTO assistants (
        id, workspace_id, application_id, name, assistant_key, description,
        system_prompt, model_policy, public_embed_allowed,
        greeting_message, suggested_prompts, theme, status
    ) VALUES 
    (
        v_asst_sentinel,
        v_ws_id,
        v_app_sentinel,
        'Sentinel Cyber Copilot',
        'nexus-sentinel-copilot',
        'Real-time enterprise threat monitoring, SIEM telemetry, and incident triage.',
        'You are the Sentinel cyber copilot. You assist security engineers with threat triage, IOC lookup, and telemetry analysis.',
        'cloud-preferred',
        TRUE,
        'Greetings, Operator. Sentinel Cyber Copilot is online. How can I assist with threat triage or SOC telemetry today?',
        '["Analyze threat telemetry for anomaly alert #9021", "Explain recent brute-force attempts on SSH port 22", "Generate incident response summary for cluster alpha"]'::jsonb,
        '{"primaryColor": "#06b6d4", "darkMode": true}'::jsonb,
        'active'
    ),
    (
        v_asst_docs,
        v_ws_id,
        v_app_docs,
        'Nexus Documentation Guide',
        'nexus-docs-guide',
        'Official developer documentation assistant for NomaanOS Nexus AI APIs and SDKs.',
        'You are the Nexus documentation guide. You explain widget integration, SDK usage, and REST endpoints.',
        'cloud-preferred',
        TRUE,
        'Hello developer! I am your Nexus AI Documentation Guide. What integration or API questions can I answer?',
        '["How do I embed the chat widget on an external site?", "Show me an example SSE streaming request in curl", "What authentication methods does the Nexus API support?"]'::jsonb,
        '{"primaryColor": "#3b82f6", "darkMode": false}'::jsonb,
        'active'
    ),
    (
        v_asst_cloud,
        v_ws_id,
        v_app_cloud,
        'Cloud Operations Assistant',
        'nexus-cloud-ops',
        'Cloud infrastructure monitoring, pod autoscaling, and cluster diagnostics.',
        'You are the Cloud Operations Assistant. You assist DevOps engineers with Kubernetes health and cloud deployments.',
        'cloud-preferred',
        TRUE,
        'System monitoring active. Cloud Operations Assistant ready. Which infrastructure metrics or cluster events need review?',
        '["Check Kubernetes cluster health and replica status", "Explain auto-scaling configuration for API pods", "Review database connection pool utilization"]'::jsonb,
        '{"primaryColor": "#10b981", "darkMode": true}'::jsonb,
        'active'
    )
    ON CONFLICT (id) DO UPDATE SET
        public_embed_allowed = TRUE,
        status = 'active',
        greeting_message = EXCLUDED.greeting_message,
        suggested_prompts = EXCLUDED.suggested_prompts,
        theme = EXCLUDED.theme;

    -- 5. Knowledge Spaces
    INSERT INTO knowledge_spaces (id, workspace_id, name, slug, description, status)
    VALUES
        (v_ks_sentinel, v_ws_id, 'Sentinel SOC Knowledge Base', 'sentinel-soc-kb', 'Security incident playbooks and threat intelligence telemetry.', 'active'),
        (v_ks_docs, v_ws_id, 'Nexus Developer Guides', 'nexus-dev-guides', 'API documentation, SDK specifications, and widget setup guides.', 'active'),
        (v_ks_cloud, v_ws_id, 'Cloud Operations SOPs', 'cloud-ops-sops', 'Standard operating procedures for Kubernetes and database clusters.', 'active')
    ON CONFLICT (id) DO NOTHING;

    -- 6. Associate Knowledge Spaces to Assistants
    INSERT INTO assistant_knowledge_spaces (assistant_id, knowledge_space_id)
    VALUES
        (v_asst_sentinel, v_ks_sentinel),
        (v_asst_docs, v_ks_docs),
        (v_asst_cloud, v_ks_cloud)
    ON CONFLICT (assistant_id, knowledge_space_id) DO NOTHING;

    -- 7. Document Sources
    INSERT INTO document_sources (id, workspace_id, knowledge_space_id, title, filename, mime_type, file_size_bytes, storage_path, sha256, status)
    VALUES
        (v_ds_sentinel, v_ws_id, v_ks_sentinel, 'Sentinel Incident Response Playbook v4.2', 'sentinel-ir-playbook.md', 'text/markdown', 1024, '/docs/sentinel-ir.md', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'ready'),
        (v_ds_docs, v_ws_id, v_ks_docs, 'Nexus AI Universal Widget Integration Manual', 'nexus-widget-manual.md', 'text/markdown', 2048, '/docs/nexus-widget.md', 'f4b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b866', 'ready'),
        (v_ds_cloud, v_ws_id, v_ks_cloud, 'Kubernetes Cloud Deployment & DR Checklist', 'cloud-ops-dr.md', 'text/markdown', 1536, '/docs/cloud-dr.md', 'a5b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b877', 'ready')
    ON CONFLICT (id) DO NOTHING;

    -- 7b. Document Versions
    INSERT INTO document_versions (id, source_id, version_number, sha256)
    VALUES
        (v_dv_sentinel, v_ds_sentinel, 1, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
        (v_dv_docs, v_ds_docs, 1, 'f4b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b866'),
        (v_dv_cloud, v_ds_cloud, 1, 'a5b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b877')
    ON CONFLICT (id) DO NOTHING;

    -- 8. Document Chunks (for Grounded Citations)
    INSERT INTO document_chunks (workspace_id, source_id, knowledge_space_id, version_id, chunk_index, content, token_count)
    VALUES
        (v_ws_id, v_ds_sentinel, v_ks_sentinel, v_dv_sentinel, 0, 'Sentinel SOC Playbook Section 4: Telemetry anomalies with severity level HIGH require immediate containment. Ingress filtering must be applied within 5 minutes of automated triage alert.', 36),
        (v_ws_id, v_ds_docs, v_ks_docs, v_dv_docs, 0, 'Nexus Widget Manual Section 2.1: The universal chat widget initializes an SSE stream via POST /api/v1/conversations/:id/messages with Accept: text/event-stream for sub-100ms real-time chunk delivery.', 38),
        (v_ws_id, v_ds_cloud, v_ks_cloud, v_dv_cloud, 0, 'Cloud Infrastructure Runbook Section 3: High-availability PostgreSQL requires minimum 3 replicas with active pgvector extensions. Connection pool saturation threshold is set to 80% before pod autoscaling.', 35)
    ON CONFLICT DO NOTHING;

END $$;
