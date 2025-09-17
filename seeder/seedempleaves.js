import dotenv from "dotenv";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import pool from "../db.js"; 
import moment from "moment";

dotenv.config({ path: path.resolve('../.env') });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Generate embedding for a text
async function generateEmbedding(text) {
  try {
    const response = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: [{ text }],
    });

    if (response.embeddings && response.embeddings[0].values) {
      return response.embeddings[0].values;
    }
    return [];
  } catch (error) {
    console.error("Gemini API error:", error);
    return [];
  }
}
async function seedLeaves() {
  try {
    await pool.connect();
    console.log("Connected to PostgreSQL");

    // Clear old leave records
    await pool.query("DELETE FROM empleaves");
    console.log("Old leave records cleared");

    // Fetch employees
    const { rows: employees } = await pool.query("SELECT id, name FROM employees");
    if (employees.length === 0) {
      console.log("No employees found. Please seed employees first.");
      return;
    }

    const leaveTypes = ["Sick", "Casual", "Annual", "Maternity", "Paternity", "Unpaid"];
    const statuses = ["Pending", "Approved", "Rejected", "Cancelled"];

    for (const emp of employees) {
      for (let i = 0; i < 6; i++) {
        const leaveType = leaveTypes[Math.floor(Math.random() * leaveTypes.length)];
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        // Random start date in last 90 days
        const startDate = moment()
          .subtract(Math.floor(Math.random() * 90), "days")
          .toDate();

        const duration = Math.ceil(Math.random() * 5); // 1–5 days
        const endDate = moment(startDate).add(duration - 1, "days").toDate();

        const reason = `${leaveType} leave requested by ${emp.name}`;
        const embedding = await generateEmbedding(reason);

        // Convert embedding array to PostgreSQL vector literal
        const vectorLiteral = `[${embedding.join(",")}]`;

        await pool.query(
          `INSERT INTO empleaves (
             employee_id,
             leave_type,
             start_date,
             end_date,
             number_of_days,
             reason,
             status,
             approved_by,
             embedding
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            emp.id,
            leaveType,
            startDate,
            endDate,
            duration,
            reason,
            status,
            // If Approved/Rejected pick random approver, else null
            status === "Approved" || status === "Rejected"
              ? employees[Math.floor(Math.random() * employees.length)].id
              : null,
            vectorLiteral, // embedding as vector literal
          ]
        );

        console.log(` Created leave for ${emp.name}: ${leaveType} (${status})`);
        // await delay(3000);
      }
    }

    console.log("Leave data seeded successfully!");
    
  } catch (err) {
    console.error("Seeding error:", err);
  } finally {
    await pool.end();
    console.log(" PostgreSQL connection closed");
  }
}

seedLeaves();
