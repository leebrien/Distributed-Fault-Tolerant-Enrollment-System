FROM postgres:15-alpine

# Copy configuration files
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY setup-replication.sh /docker-entrypoint-initdb.d/

# Make script executable
RUN chmod +x /docker-entrypoint-initdb.d/setup-replication.sh

# Use custom config
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
