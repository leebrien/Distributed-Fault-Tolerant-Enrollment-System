#!/bin/bash
set -e

# Wait for primary to be ready
echo "Waiting for primary database to be ready..."
until pg_isready -h ${PRIMARY_HOST} -p ${PRIMARY_PORT} -U ${POSTGRES_USER}; do
  echo "Primary database is unavailable - sleeping"
  sleep 2
done

echo "Primary database is ready"

# Remove any existing data
rm -rf ${PGDATA}/*

# Base backup from primary
echo "Creating base backup from primary..."
PGPASSWORD=${REPLICATION_PASSWORD} pg_basebackup -h ${PRIMARY_HOST} -p ${PRIMARY_PORT} -U ${REPLICATION_USER} -D ${PGDATA} -Fp -Xs -R

echo "Base backup completed"

# Create standby.signal to enable standby mode
touch ${PGDATA}/standby.signal

# Update postgresql.auto.conf with primary connection info
cat >> ${PGDATA}/postgresql.auto.conf <<EOF
primary_conninfo = 'host=${PRIMARY_HOST} port=${PRIMARY_PORT} user=${REPLICATION_USER} password=${REPLICATION_PASSWORD}'
EOF

echo "Replica setup completed"
