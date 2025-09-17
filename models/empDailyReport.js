import pool from "../db.js";

export const createEmpDailyReportTable = async () => {
  try {
    // Ensure pgvector extension exists
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    // Create table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS empdailyreports (
        id SERIAL PRIMARY KEY,
        employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        tasks JSONB,
        notes TEXT,
        embedding vector(768),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("EmpDailyReports table ready");
  } catch (err) {
    console.error("Error creating EmpDailyReports table:", err);
    throw err;
  }
};
