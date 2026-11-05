# Nexus Security Protocols
## Authentication Guidelines
Nexus AI requires session tokens to be SHA-256 hashed before persistence in PostgreSQL.
Never store raw tokens in the database.
Bearer authorization headers must be properly parsed and verified.

## Vector Search Policies
Local vector embeddings use sentence-transformers with 384 dimensions and cosine metric.
All search queries must strictly enforce workspace and knowledge space tenant isolation.