#!/bin/bash
set -e

# Run SQL as nexus_dev (the volume owner) to ensure the target configured user exists with the matching password
psql -U nexus_dev -d "$POSTGRES_DB" << EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$POSTGRES_USER') THEN
    EXECUTE format('CREATE ROLE %I WITH LOGIN SUPERUSER PASSWORD %L', '$POSTGRES_USER', '$POSTGRES_PASSWORD');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN SUPERUSER PASSWORD %L', '$POSTGRES_USER', '$POSTGRES_PASSWORD');
  END IF;
  EXECUTE format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', '$POSTGRES_DB', '$POSTGRES_USER');
  EXECUTE format('GRANT nexus_dev TO %I', '$POSTGRES_USER');
END
\$\$;
EOSQL

