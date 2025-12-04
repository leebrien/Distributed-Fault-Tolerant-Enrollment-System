#!/bin/bash
set -e

# Setup replication user and permissions
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create replication user
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = '${POSTGRES_REPLICATION_USER}') THEN
            CREATE USER ${POSTGRES_REPLICATION_USER} WITH REPLICATION ENCRYPTED PASSWORD '${POSTGRES_REPLICATION_PASSWORD}';
        END IF;
    END
    \$\$;

    -- Grant necessary permissions
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_REPLICATION_USER};
EOSQL

# Update pg_hba.conf to allow replication connections
echo "host replication ${POSTGRES_REPLICATION_USER} 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
echo "host all all 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"

echo "Replication user created and pg_hba.conf updated"
