import dotenv from "dotenv";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import pool from "../db.js"; // your PostgreSQL pool

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
        await delay(1000);
        return [];
    } catch (error) {
        console.error("Gemini API error:", error);
        return Array(3072).fill(0);
    }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function seedDailyReports() {
    try {
        console.log("Connected to PostgreSQL");

        // Fetch all employees
        const { rows: employees } = await pool.query("SELECT id, name, department FROM employees");

        // Sample weekly tasks
        // const weeklySampleTasks = [
        //     [
        //         { title: "Setup project repo", description: "Initialized GitHub repo and CI/CD", hoursSpent: 3, status: "Completed" },
        //         { title: "Environment setup", description: "Configured Docker dev environment", hoursSpent: 2, status: "Completed" },
        //     ],
        //     [
        //         { title: "Implement login page", description: "Built login form with validation in React", hoursSpent: 4, status: "Completed" },
        //         { title: "Fix auth bug", description: "Resolved session expiration issue", hoursSpent: 3, status: "In Progress" },
        //     ],
        //     [
        //         { title: "Database optimization", description: "Added indexes to speed up queries", hoursSpent: 3, status: "Completed" },
        //         { title: "API testing", description: "Tested user API with Postman", hoursSpent: 2, status: "Completed" },
        //     ],
        //     [
        //         { title: "Team meeting", description: "Discussed sprint backlog and blockers", hoursSpent: 2, status: "Completed" },
        //         { title: "Write unit tests", description: "Added Jest tests for user module", hoursSpent: 3, status: "In Progress" },
        //     ],
        //     [
        //         { title: "Frontend integration", description: "Connected React components with backend APIs", hoursSpent: 4, status: "Completed" },
        //         { title: "Fix UI bugs", description: "Resolved responsive issues on mobile view", hoursSpent: 2, status: "Completed" },
        //     ],
        //     [
        //         { title: "Deploy to staging", description: "Deployed latest build to staging environment", hoursSpent: 3, status: "Completed" },
        //         { title: "Bug fixing", description: "Fixed errors reported by QA", hoursSpent: 4, status: "In Progress" },
        //     ],
        //     [
        //         { title: "Code review", description: "Reviewed PRs from teammates and suggested improvements", hoursSpent: 2, status: "Completed" },
        //         { title: "Knowledge sharing session", description: "Gave a talk on PostgreSQL best practices", hoursSpent: 2, status: "Completed" },
        //     ],
        // ];
        const weeklySampleTasks = [
            // Day 1
            [
                { title: "Setup project repo", description: "Initialized GitHub repo and CI/CD", hoursSpent: 3, status: "Completed" },
                { title: "Environment setup", description: "Configured Docker dev environment", hoursSpent: 2, status: "Completed" },
            ],
            // Day 2
            [
                { title: "Implement login page", description: "Built login form with validation in React", hoursSpent: 4, status: "Completed" },
                { title: "Fix auth bug", description: "Resolved session expiration issue", hoursSpent: 3, status: "In Progress" },
            ],
            // Day 3
            [
                { title: "Database optimization", description: "Added indexes to speed up queries", hoursSpent: 3, status: "Completed" },
                { title: "API testing", description: "Tested user API with Postman", hoursSpent: 2, status: "Completed" },
            ],
            // Day 4
            [
                { title: "Team meeting", description: "Discussed sprint backlog and blockers", hoursSpent: 2, status: "Completed" },
                { title: "Write unit tests", description: "Added Jest tests for user module", hoursSpent: 3, status: "In Progress" },
            ],
            // Day 5
            [
                { title: "Frontend integration", description: "Connected React components with backend APIs", hoursSpent: 4, status: "Completed" },
                { title: "Fix UI bugs", description: "Resolved responsive issues on mobile view", hoursSpent: 2, status: "Completed" },
            ],
            // Day 6
            [
                { title: "Deploy to staging", description: "Deployed latest build to staging environment", hoursSpent: 3, status: "Completed" },
                { title: "Bug fixing", description: "Fixed errors reported by QA", hoursSpent: 4, status: "In Progress" },
            ],
            // Day 7
            [
                { title: "Code review", description: "Reviewed PRs from teammates and suggested improvements", hoursSpent: 2, status: "Completed" },
                { title: "Knowledge sharing session", description: "Gave a talk on PostgreSQL best practices", hoursSpent: 2, status: "Completed" },
            ],

            // Extra Week (to extend dataset)
            // Day 8
            [
                { title: "Design dashboard UI", description: "Created wireframes in Figma for analytics dashboard", hoursSpent: 5, status: "Completed" },
                { title: "Research libraries", description: "Compared charting libraries for better visualization", hoursSpent: 2, status: "Completed" },
            ],
            // Day 9
            [
                { title: "Implement search feature", description: "Added search API and integrated in frontend", hoursSpent: 4, status: "In Progress" },
                { title: "Optimize queries", description: "Reduced slow SQL joins with indexing", hoursSpent: 3, status: "Completed" },
            ],
            // Day 10
            [
                { title: "Conduct interviews", description: "Interviewed 2 frontend developer candidates", hoursSpent: 3, status: "Completed" },
                { title: "Prepare HR report", description: "Summarized hiring pipeline for management", hoursSpent: 2, status: "Completed" },
            ],
            // Day 11
            [
                { title: "Marketing campaign", description: "Drafted email campaign for product launch", hoursSpent: 3, status: "Completed" },
                { title: "SEO optimization", description: "Improved blog articles for ranking", hoursSpent: 2, status: "In Progress" },
            ],
            // Day 12
            [
                { title: "Server patch update", description: "Applied latest OS security patches", hoursSpent: 2, status: "Completed" },
                { title: "Monitor logs", description: "Checked error logs after deployment", hoursSpent: 2, status: "Completed" },
            ],
            // Day 13
            [
                { title: "Customer demo", description: "Presented product demo to client", hoursSpent: 3, status: "Completed" },
                { title: "Feedback collection", description: "Collected feature requests from customer", hoursSpent: 1, status: "Completed" },
            ],
            // Day 14
            [
                { title: "Refactor codebase", description: "Cleaned up old modules and improved readability", hoursSpent: 4, status: "In Progress" },
                { title: "Pair programming", description: "Worked with teammate on API integration", hoursSpent: 2, status: "Completed" },
            ]
        ];


        // Clear previous reports
        await pool.query("DELETE FROM empdailyreports");

        // Seed reports
        for (const emp of employees) {
            for (let i = 0; i < 7; i++) {
                const reportDate = new Date();
                reportDate.setDate(reportDate.getDate() - i);

                const dayTasks = weeklySampleTasks[i] || [];

                const reportText = `
                                    Employee: ${emp.name}
                                    Department: ${emp.department || "N/A"}
                                    Date: ${reportDate.toDateString()}
                                    Tasks: 
                                    ${dayTasks.map(t => `- ${t.title}: ${t.description} [${t.status}, ${t.hoursSpent}h]`).join("\n")}
                                    Notes: Daily work progress logged.
                                    `;

                const embedding = await generateEmbedding(reportText);

                const vectorLiteral = `[${embedding.join(",")}]`;

                await pool.query(
                    `INSERT INTO empdailyreports (employee_id, date, tasks, notes, embedding)
                        VALUES ($1, $2, $3, $4, $5)`,
                    [emp.id, reportDate, JSON.stringify(dayTasks), "Daily work progress logged.", vectorLiteral]
                );


                console.log(`Created report for ${emp.name} (${reportDate.toDateString()})`);
            }
        }

        console.log("Daily work reports seeded successfully!");
    } catch (err) {
        console.error(" Seeding error:", err);
    } finally {
        pool.end();
        console.log(" PostgreSQL connection closed");
    }
    await sleep(2000);
}

seedDailyReports();
