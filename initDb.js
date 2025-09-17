//this file is too create all the tables in the postgre if not exits
import { createEmployeesTable } from "./models/employeemodel.js";
import { createEmpDailyReportTable } from "./models/empDailyReport.js";
import { createEmpLeavesTable } from "./models/empLeaves.js";

const initDb = async () => {
  try {
    await createEmployeesTable();
    await createEmpDailyReportTable();
    await createEmpLeavesTable();

    console.log("All tables created successfully!");
    process.exit(0);
  } catch (err) {
    console.error(" Error initializing DB:", err);
    process.exit(1);
  }
};

initDb();
