// db.js
import { Pool } from "pg";

// Connection pool
const pool = new Pool({
  user: "postgres",       // same as POSTGRES_USER
  host: "localhost",      // because container port 5432 is mapped to localhost
  database: "Companydb",  // same as POSTGRES_DB
  password: "1234mypc",   // same as POSTGRES_PASSWORD
  port: 5432,             // exposed port
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Test connection
pool.connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch(err => console.error("Connection error", err.stack));

export default pool;
