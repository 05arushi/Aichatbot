import pool from "../db.js";

export const createEmployeesTable = async () => {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await pool.query(`DROP TABLE IF EXISTS empleaves`);
    await pool.query(`DROP TABLE IF EXISTS empdailyreports`);
    await pool.query(`DROP TABLE IF EXISTS employees`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(100),
        department VARCHAR(100),
        skills TEXT[],
        phone_no VARCHAR(20) UNIQUE,
        aadhaar_no VARCHAR(20) UNIQUE,
        pan_no VARCHAR(15) UNIQUE,
        embedding vector(768)
      )
    `);

    console.log(" Employees table ready");
  } catch (err) {
    console.error(" Error creating employees table:", err);
    throw err;
  }
};
