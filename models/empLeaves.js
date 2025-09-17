import pool from "../db.js";

export const createEmpLeavesTable = async () => {
  try {
    // Ensure pgvector extension exists
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Create table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS empleaves (
        id SERIAL PRIMARY KEY,
        employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        leave_type VARCHAR(50) NOT NULL CHECK (leave_type IN ('Sick', 'Casual', 'Annual', 'Maternity', 'Paternity', 'Unpaid')),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        number_of_days INT NOT NULL,
        reason TEXT,
        status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
        approved_by INT REFERENCES employees(id),
        embedding vector(768),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("EmpLeaves table ready");
  } catch (err) {
    console.error("Error creating EmpLeaves table:", err);
    throw err;
  }
};
