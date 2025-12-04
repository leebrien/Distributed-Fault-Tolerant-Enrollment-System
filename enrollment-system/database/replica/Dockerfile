FROM postgres:15-alpine

# Copy configuration and setup script
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY setup-replica.sh /docker-entrypoint-initdb.d/

# Make script executable
RUN chmod +x /docker-entrypoint-initdb.d/setup-replica.sh

# Use custom config
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
