NOVATECH SOLUTIONS
COMPANY OPERATIONS, PRODUCTS, CUSTOMER SUPPORT, AND TECHNICAL DOCUMENTATION

Document ID: NTS-KB-2026-001
Version: 1.0
Last Updated: 15 October 2026
Document Classification: General Internal Knowledge
Department: Operations and Technology

==================================================
1. COMPANY OVERVIEW
==================================================

NovaTech Solutions is a fictional software company founded in 2021. The company provides cloud-based business management software for small businesses, startups, educational institutions, and medium-sized organizations.

Its headquarters are located in Pune, Maharashtra, India.

The company focuses on simplifying business operations through automation, centralized data management, and artificial intelligence.

NovaTech Solutions currently offers three primary products:

1. NovaDesk
2. NovaFlow
3. NovaAI

NovaDesk is a customer relationship management platform designed to help businesses manage customer information, leads, sales activities, and support requests.

NovaFlow is a workflow automation platform that allows organizations to automate repetitive tasks, assign responsibilities, monitor task progress, and create approval workflows.

NovaAI is an AI-powered knowledge assistant that allows organizations to upload documents, create knowledge bases, configure AI assistants, and retrieve information using natural language questions.

The company's official working hours are Monday to Friday, 9:30 AM to 6:30 PM IST. Customer support operates Monday to Saturday, 9:00 AM to 8:00 PM IST.

==================================================
2. PRODUCT DETAILS
==================================================

2.1 NOVADESK

NovaDesk helps organizations manage their customer relationships.

Main features include:

- Customer profile management.
- Lead tracking.
- Sales pipeline management.
- Customer activity history.
- Follow-up reminders.
- Support ticket management.
- Sales performance reports.

NovaDesk supports three user roles:

Administrator: Can configure the workspace, manage users, and access all permitted CRM information.

Manager: Can manage assigned teams, review sales activities, and access team reports.

Sales Representative: Can manage assigned leads, update customer information, and record sales activities.

The standard customer profile contains the following fields:

Customer ID, Full Name, Email Address, Phone Number, Company Name, Lead Source, Assigned Representative, Customer Status, Creation Date, and Last Updated Date.

Lead statuses are:

- New
- Contacted
- Qualified
- Proposal Sent
- Negotiation
- Converted
- Lost

A lead should be marked as Converted only after the customer has confirmed the purchase.

2.2 NOVAFLOW

NovaFlow provides workflow automation for business operations.

Its primary features include:

- Automated task creation.
- Task assignment.
- Approval workflows.
- Scheduled operations.
- Email notifications.
- Workflow execution history.
- Failure notifications.
- Workflow performance reports.

Every workflow contains a name, description, trigger, execution steps, assigned users, and status.

Workflow statuses include:

Draft, Active, Paused, Completed, and Failed.

Only workspace administrators can permanently delete workflows.

Managers can create, edit, activate, and pause workflows within their permissions.

If a workflow fails, the system records the failed execution step and displays an error message in the execution history.

Users should review the error details before manually restarting a failed workflow.

2.3 NOVAAI

NovaAI is an AI-powered knowledge management and retrieval platform.

Organizations can create separate knowledge bases for different departments, projects, or business units.

Supported knowledge sources include:

- PDF documents.
- Plain text files.
- Markdown documents.
- HTML documents.
- Approved JSON files.
- OpenAPI specifications.

The system extracts text from uploaded documents, divides the content into smaller chunks, generates embeddings, and stores searchable information in a vector database.

When a user asks a question, NovaAI searches the relevant knowledge base and retrieves information related to the question.

The language model uses the retrieved information to generate an answer.

Where source information is available, the assistant should provide relevant citations or source references.

NovaAI must not retrieve private documents from another organization's knowledge base.

==================================================
3. NOVADESK SUBSCRIPTION PRICING
==================================================

NovaDesk offers three subscription plans.

STARTER PLAN

Price: INR 499 per month.

Includes:
- Up to 3 users.
- Up to 500 customer records.
- Basic lead management.
- Basic reporting.
- Email support.

PROFESSIONAL PLAN

Price: INR 1,499 per month.

Includes:
- Up to 15 users.
- Up to 5,000 customer records.
- Advanced sales pipeline.
- Automated follow-up reminders.
- Advanced reporting.
- Priority email support.

BUSINESS PLAN

Price: INR 3,999 per month.

Includes:
- Up to 50 users.
- Up to 25,000 customer records.
- All Professional features.
- Custom user permissions.
- Advanced analytics.
- Workflow integrations.
- Priority technical support.

All subscription prices are exclusive of applicable taxes.

Annual subscriptions receive a 15% discount compared with paying monthly for twelve months.

A customer can upgrade their subscription at any time.

Downgrades take effect at the beginning of the next billing cycle.

Refund requests must be submitted within seven calendar days of the initial purchase.

Subscription cancellations stop future renewals but do not automatically refund previous payments.

==================================================
4. CUSTOMER SUPPORT POLICY
==================================================

NovaTech Solutions classifies support requests into four priority levels.

P1 — CRITICAL

Examples:
- Complete service outage.
- Multiple organizations unable to access the platform.
- Confirmed security incident.
- Major data loss.

Initial response target: 30 minutes.

P2 — HIGH

Examples:
- Major feature unavailable.
- Critical business workflow blocked.
- Significant performance degradation affecting multiple users.

Initial response target: 2 business hours.

P3 — NORMAL

Examples:
- Individual user unable to use a non-critical feature.
- Incorrect report output.
- Minor integration issue.
- General application malfunction.

Initial response target: 8 business hours.

P4 — LOW

Examples:
- General questions.
- Feature suggestions.
- Documentation requests.
- Minor cosmetic issues.

Initial response target: 2 business days.

These response targets represent initial response goals, not guaranteed resolution times.

Every support request should include:

- Customer organization.
- Requester's name.
- Registered email address.
- Product name.
- Description of the issue.
- Steps to reproduce the issue.
- Screenshot or relevant error message.
- Business impact.
- Priority level.

Customers should never include passwords, API secrets, or authentication tokens in support tickets.

==================================================
5. SECURITY AND DATA PROTECTION POLICY
==================================================

NovaTech Solutions follows a tenant-isolation model.

Each organization has an independent data boundary.

An organization can access only the information belonging to its authorized workspace and projects.

The following rules apply:

1. Users must authenticate before accessing private workspace information.
2. Authorization must be checked on the server.
3. API requests must not trust organization IDs supplied by the browser without validating access.
4. Private documents must remain restricted to authorized users.
5. AI retrieval must enforce document-level and tenant-level access restrictions.
6. Passwords must never be stored as plain text.
7. API credentials must be stored securely.
8. Sensitive information must not appear in application logs.
9. Uploaded files must be validated before processing.
10. Security incidents must be reported to the security team immediately.

The company recommends enabling multi-factor authentication for all administrator accounts.

Access permissions should follow the principle of least privilege.

Employees who leave the organization should have their access revoked immediately.

Security incidents must be documented with the date, time, affected system, incident description, impact, and corrective actions.

==================================================
6. DOCUMENT UPLOAD AND KNOWLEDGE BASE PROCEDURE
==================================================

To create a knowledge base in NovaAI, an administrator should follow these steps:

Step 1: Open the NovaAI dashboard.

Step 2: Navigate to Knowledge Bases.

Step 3: Select Create Knowledge Base.

Step 4: Enter a meaningful name and description.

Step 5: Select the appropriate project or workspace.

Step 6: Upload supported documents.

Step 7: Confirm the upload.

Step 8: Wait for document processing to complete.

Step 9: Review the document processing status.

Step 10: Associate the knowledge base with an authorized AI assistant.

A document may have one of the following processing statuses:

Uploaded: The file has been received successfully.

Queued: The file is waiting for processing.

Processing: Text extraction and document preparation are in progress.

Indexed: The document has been processed and indexed successfully.

Failed: Processing could not be completed.

If processing fails, the administrator should inspect the error message, verify that the file is supported, confirm that the document is not corrupted, and retry the upload if appropriate.

Duplicate documents may be identified using content hashing.

When a document is updated, the system should preserve version information so that the latest approved content can be distinguished from older versions.

Deleting a document should also remove or deactivate its associated searchable content according to the system's deletion policy.

==================================================
7. AI ASSISTANT AND RAG BEHAVIOR
==================================================

An AI assistant is configured using:

- Assistant name.
- Description.
- Selected knowledge base.
- Model configuration.
- System instructions.
- Retrieval settings.
- Response generation settings.
- Widget configuration, where applicable.

The assistant should answer questions using relevant information retrieved from its assigned knowledge base.

Example:

Question:
What is the monthly price of the NovaDesk Professional plan?

Expected answer:
The NovaDesk Professional plan costs INR 1,499 per month, excluding applicable taxes.

Question:
How many users are included in the Business plan?

Expected answer:
The NovaDesk Business plan supports up to 50 users.

Question:
What is the initial response target for a P1 critical support request?

Expected answer:
The initial response target for a P1 critical support request is 30 minutes.

Question:
Where is NovaTech Solutions headquartered?

Expected answer:
NovaTech Solutions is headquartered in Pune, Maharashtra, India.

If the answer is not available in the assigned knowledge base, the assistant should clearly communicate that the available documentation does not contain sufficient information.

The assistant must not invent company policies, product features, prices, or technical specifications.

If two documents contain conflicting information, the assistant should identify the conflict rather than silently presenting an unsupported answer.

The assistant should provide source references when the retrieval system supports citations.

==================================================
8. DATA RETENTION AND BACKUP POLICY
==================================================

NovaTech Solutions recommends the following operational retention schedule:

- Daily database backups.
- Weekly backup restoration verification.
- Thirty-day retention for standard database backups.
- Ninety-day retention for security audit records.
- One-year retention for financial transaction records, subject to applicable legal requirements.

Backup files must be encrypted and access must be restricted to authorized personnel.

A backup is not considered reliable until a restoration test has been successfully completed.

Before a major database migration, the operations team must verify that a recent backup is available.

Data deletion requests must be reviewed for authorization and applicable retention requirements.

==================================================
9. INTERNAL OPERATIONAL PROCEDURES
==================================================

SOFTWARE RELEASE PROCEDURE

Before releasing a new application version:

1. Review the planned changes.
2. Run automated tests.
3. Verify frontend and backend builds.
4. Review security-sensitive changes.
5. Test database migrations.
6. Verify staging deployment.
7. Confirm backup availability.
8. Approve the release.
9. Deploy the release.
10. Monitor application health and error rates.

A production release must not proceed when a critical security issue or data integrity problem remains unresolved.

INCIDENT MANAGEMENT

When an incident occurs:

1. Record the incident.
2. Identify affected services.
3. Determine business impact.
4. Assign an incident owner.
5. Apply immediate containment measures.
6. Investigate the root cause.
7. Restore normal service.
8. Verify system integrity.
9. Document corrective actions.
10. Review the incident to prevent recurrence.

==================================================
10. IMPORTANT COMPANY FACTS
==================================================

Company: NovaTech Solutions

Founded: 2021

Headquarters: Pune, Maharashtra, India

Products:
NovaDesk, NovaFlow, NovaAI

Working days:
Monday to Friday.

Office working hours:
9:30 AM to 6:30 PM IST.

Customer support days:
Monday to Saturday.

Customer support hours:
9:00 AM to 8:00 PM IST.

NovaDesk Starter:
INR 499 per month.

NovaDesk Professional:
INR 1,499 per month.

NovaDesk Business:
INR 3,999 per month.

Annual subscription discount:
15%.

Initial purchase refund request period:
Seven calendar days.

P1 initial response target:
30 minutes.

P2 initial response target:
2 business hours.

P3 initial response target:
8 business hours.

P4 initial response target:
2 business days.

Standard database backup retention:
30 days.

Security audit record retention:
90 days.

Financial transaction record retention:
One year, subject to applicable legal requirements.

END OF DOCUMENT