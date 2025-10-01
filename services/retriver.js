//retriver.js
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { embeddings } from "./llm.js";
import pool from "../db.js";
import { NlpManager } from "node-nlp";
import moment from 'moment';
import * as chrono from 'chrono-node';

let retrievers = {};
export const nlpManager = new NlpManager({ languages: ["en"], forceNER: true });

const getEmployeeNamesFromDB = async (client) => {
  const res = await client.query('SELECT name FROM employees');
  return res.rows.map(row => row.name);
};
const checkEmployeeExists = async (name) => {
  const client = await pool.connect();
  try {
    const names = await getEmployeeNamesFromDB(client);
    return names.some(n => n.toLowerCase() === name.toLowerCase());
  } finally {
    client.release();
  }
};

async function initNLP(employeeNames) {

  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (const letter of alphabet) {
    nlpManager.addNamedEntityText(
      "startLetter",
      letter,
      ["en"],
      [letter, letter.toUpperCase()]
    );
    nlpManager.addNamedEntityText(
      "endLetter",
      letter,
      ["en"],
      [letter, letter.toUpperCase()]
    );
  }

  // Dynamically load employee names from the database
  for (const name of employeeNames) {
    const variations = name.toLowerCase().split(' '); // simple variants
    nlpManager.addNamedEntityText(
      "employee",
      name,
      ["en"],
      [name.toLowerCase(), ...variations]
    );
  }

  const numberRegex = /\b\d+\b/;
  nlpManager.addRegexEntity("number", "en", numberRegex);

  // Add intent samples that involve the number entity
  nlpManager.addDocument("en", "give me {number} latest work reports of {employee}", "WorkReport");
  nlpManager.addDocument("en", "show the latest report of {employee}", "WorkReport");
  nlpManager.addDocument("en", "latest report of {employee}", "WorkReport");
  nlpManager.addDocument("en", "give me last {number} reports of {employee}", "WorkReport");
  nlpManager.addDocument("en", "get the last entered report for {employee}", "WorkReport");
  nlpManager.addDocument("en", "yesterday work", "WorkReport");
  nlpManager.addDocument("en", "work done yesterday", "WorkReport");
  nlpManager.addDocument("en", "{employee} do yesterday", "WorkReport");
  nlpManager.addDocument("en", "{employee} working on yesterday", "WorkReport");
  nlpManager.addDocument("en", "show me {employee}'s report for yesterday", "WorkReport");

  // Intent training samples
  nlpManager.addDocument("en", "list names starting with {startLetter}", "filterNamesByLetter");
  nlpManager.addDocument("en", "list names ending with {endLetter}", "filterNamesByLetter");
  nlpManager.addDocument("en", "names starting with {startLetter} and ending with {endLetter}", "filterNamesByLetter");
  nlpManager.addDocument("en", "show me employees whose names start with {startLetter} and end with {endLetter}", "filterNamesByLetter");
  nlpManager.addDocument("en", "list names that start with {startLetter} and end with {endLetter}", "filterNamesByLetter");

  nlpManager.addDocument("en", "total employees", "employeeCount");
  nlpManager.addDocument("en", "number of employees", "employeeCount");
  nlpManager.addDocument("en", "how many employees", "employeeCount");

  nlpManager.addDocument("en", "total leaves", "leavesCount");
  nlpManager.addDocument("en", "number of leaves", "leavesCount");
  nlpManager.addDocument("en", "how many leaves", "leavesCount");
  nlpManager.addDocument("en", "was {employee} absent yesterday", "leavesCount");
  nlpManager.addDocument("en", "was {employee} on leave yesterday", "leavesCount");
  nlpManager.addDocument("en", "did {employee} take leave yesterday", "leavesCount");
  nlpManager.addDocument("en", "was he absent yesterday", "leavesCount");
  nlpManager.addDocument("en", "was she on leave yesterday", "leavesCount");

  nlpManager.addDocument("en", "List all the users", "allusers");
  nlpManager.addDocument("en", "Show me all users", "allusers");
  nlpManager.addDocument("en", "Display all users", "allusers");
  nlpManager.addDocument("en", "list all the employees", "allusers");


  await nlpManager.train();
  console.log("✅ NLP Manager trained");
}

const getTableColumns = async (client, tableName) => {
  const query = `
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = $1 AND table_schema = 'public'
    ORDER BY ordinal_position;
  `;
  const result = await client.query(query, [tableName]);
  return result.rows.map(row => ({
    name: row.column_name,
    type: row.data_type,
  }));
};

const createCombinedContent = (row, columns) => {
  return columns
    .map(c => {
      const value = row[c.name];
      if (value === null || value === undefined || value === "") return "";
      if (c.type === "json" || c.type === "jsonb")
        return `${c.name}: ${JSON.stringify(value)}`;
      if (c.type.includes("date"))
        return `${c.name}: ${new Date(value).toISOString().split("T")[0]}`;
      return `${c.name}: ${value}`;
    })
    .filter(Boolean)
    .join(", ");
};

function getDateRangeFromQuery(query) {
  const parsed = chrono.parse(query);
  const normalized = query.toLowerCase();

  // Numeric N-match stays early exit
  if (/\b(last|recent)\s+(\d+)\s+(reports?|entries?|records?|tasks?|works?)?\b/.test(normalized))
    return { startDate: null, endDate: null, wantsAll: false };

  // Mapping of common period phrases to moment operations
  const periodMap = {
    "last week": () => [moment().subtract(1, "week").startOf("week"), moment().subtract(1, "week").endOf("week")],
    "this week": () => [moment().startOf("week"), moment().endOf("week")],
    "last month": () => [moment().subtract(1, "month").startOf("month"), moment().subtract(1, "month").endOf("month")],
    "this month": () => [moment().startOf("month"), moment().endOf("month")],
    "last year": () => [moment().subtract(1, "year").startOf("year"), moment().subtract(1, "year").endOf("year")],
    "this year": () => [moment().startOf("year"), moment().endOf("year")],
    "yesterday": () => [moment().subtract(1, "day"), moment().subtract(1, "day")],
    "today": () => [moment(), moment()],
  };

  if (parsed.length) {
    const comp = parsed[0].start;
    const text = parsed[0].text?.toLowerCase() || "";

    // Check mapped periods
    for (const key in periodMap) {
      if (text.includes(key)) {
        const [start, end] = periodMap[key]();
        return {
          startDate: start.format("YYYY-MM-DD"),
          endDate: end.format("YYYY-MM-DD"),
          wantsAll: false
        };
      }
    }

    // If chrono gives a range
    if (parsed[0].start && parsed[0].end) {
      return {
        startDate: moment(parsed[0].start.date()).format("YYYY-MM-DD"),
        endDate: moment(parsed[0].end.date()).format("YYYY-MM-DD"),
        wantsAll: false
      };
    }

    // Default single date if detected
    if (comp) {
      const dateStr = moment(comp.date()).format("YYYY-MM-DD");
      return { startDate: dateStr, endDate: dateStr, wantsAll: false };
    }
  }

  // Universal "all/complete/full" case
  if (/\ball\b|\bcomplete\b|\bfull\b/.test(normalized))
    return { startDate: null, endDate: null, wantsAll: true };

  // "latest/recent/last entered" as today
  if (/latest|recent|last entered/.test(normalized)) {
    const today = moment().format("YYYY-MM-DD");
    return { startDate: today, endDate: today, wantsAll: false };
  }

  // Fallback: no filtering
  return { startDate: null, endDate: null, wantsAll: false };
}

async function handleIntent(intent, userName, query, nlpRes) {

  if (intent === "employeeCount") {
    const countRes = await pool.query(`SELECT COUNT(*) FROM employees`);
    return [{
      pageContent: `Total employees: ${countRes.rows[0].count}`,
      metadata: { _table: "employees" }
    }];
  }

  if (intent === "filterNamesByLetter") {
    const startEntity = nlpRes.entities.find(e => e.entity === "startLetter");
    const endEntity = nlpRes.entities.find(e => e.entity === "endLetter");
    const numberEntity = nlpRes.entities.find(e => e.entity === "number");

    let pattern = "%"; // default: match all
    if (startEntity && endEntity) {
      const startLetter = (startEntity.option || startEntity.sourceText).toLowerCase();
      const endLetter = (endEntity.option || endEntity.sourceText).toLowerCase();
      pattern = `${startLetter}%${endLetter}`;
    } else if (startEntity) {
      const startLetter = (startEntity.option || startEntity.sourceText).toLowerCase();
      pattern = `${startLetter}%`;
    } else if (endEntity) {
      const endLetter = (endEntity.option || endEntity.sourceText).toLowerCase();
      pattern = `%${endLetter}`;
    }

    // Extract limit dynamically
    let limitCount = numberEntity ? parseInt(numberEntity.option || numberEntity.sourceText) : 5;
    if (isNaN(limitCount) || limitCount <= 0) limitCount = 5;

    console.log("Filtering names with pattern:", pattern, "Limit:", limitCount);

    // Query with pattern + limit
    const res = await pool.query(
      `SELECT name 
     FROM employees 
     WHERE LOWER(name) LIKE $1
     ORDER BY id DESC
     LIMIT $2`,
      [pattern, limitCount]
    );

    const names = res.rows.map(row => row.name);
    console.log("Names found:", names);

    return [{
      pageContent: names.length
        ? `Names matching your criteria: ${names.join(", ")}`
        : `No names found matching the criteria.`,
      metadata: { _table: "employees" }
    }];
  }

  if (intent === "WorkReport" && userName) {
    const numberEntity = nlpRes.entities.find(e => e.entity === "number");
    let limitCount = numberEntity ? parseInt(numberEntity.option || numberEntity.sourceText) : 5;

    const { startDate, endDate, wantsAll } = getDateRangeFromQuery(query);
    console.log("Extracted date range:", startDate, endDate, "Wants all:", wantsAll);

    let queryText, queryParams;
    if (wantsAll) {
      queryText = `
        SELECT edr.tasks, edr.date, emp.name
        FROM empdailyreports edr
        JOIN employees emp ON emp.id = edr.employee_id
        WHERE emp.name ILIKE $1
        ORDER BY edr.date DESC
      `;
      queryParams = [userName];
    } else if (startDate && endDate) {
      queryText = `
      SELECT edr.tasks, edr.date, emp.name
      FROM empdailyreports edr
      JOIN employees emp ON emp.id = edr.employee_id
      WHERE emp.name ILIKE $1
      AND edr.date BETWEEN $2 AND $3
      ORDER BY edr.date DESC
    `;
      queryParams = [userName, startDate, endDate];
    } else {
      // No date range means latest 'limitCount' reports
      queryText = `
      SELECT edr.tasks, edr.date, emp.name
      FROM empdailyreports edr
      JOIN employees emp ON emp.id = edr.employee_id
      WHERE emp.name ILIKE $1
      ORDER BY edr.date DESC
      LIMIT $2
    `;
      queryParams = [userName, limitCount];
    }

    const res = await pool.query(queryText, queryParams);
    console.log("WorkReport query results:", res.rows);

    if (res.rows.length === 0) {
      return [{
        pageContent: `No, work report of ${userName} was found matching the criteria.`,
        metadata: { _table: "empdailyreports" }
      }];
    }

    const groupedByDate = {};
    res.rows.forEach(row => {
      const date = moment(row.date).format("YYYY-MM-DD");
      groupedByDate[date] = groupedByDate[date] || [];
      let tasks = Array.isArray(row.tasks) ? row.tasks : [];
      tasks.forEach(task => {
        groupedByDate[date].push(`- ${task.title} (${task.hoursSpent} hours, ${task.status})`);
      });
    });

    let content = `${userName}'s Work Reports:\n`;
    for (const date in groupedByDate) {
      content += `* ${date}:\n` + groupedByDate[date].join("\n") + "\n";
    }

    return [{
      pageContent: content.trim(),
      metadata: { _table: "empdailyreports" }
    }];
  }

  if (intent === "allusers") {
    const res = await pool.query(`SELECT name,role,department,skills FROM employees`);
    if (res.rows.length === 0) {
      return [{
        pageContent: `No users found in the database.`,
        metadata: { _table: "employees" }
      }];
    }
    let table = `| Name | Role | Department | Skills |\n`;
    table += `|------|------|------------|--------|\n`;

    // Add rows
    res.rows.forEach(row => {
      const skills = Array.isArray(row.skills) ? row.skills.join(", ") : row.skills;
      table += `| ${row.name} | ${row.role} | ${row.department} | ${skills} |\n`;
    });

    return [{
      pageContent: table,
      metadata: { _table: "employees" }
    }];
  }

  if (intent === "leavesCount" && userName) {
    const { startDate, endDate, wantsAll } = getDateRangeFromQuery(query);
    console.log("Extracted date range for leavesCount:", startDate, endDate, "Wants all:", wantsAll);

    let queryText, queryParams;
    if (wantsAll) {
      queryText = `
      SELECT el.leave_type, el.start_date,el.end_date,el.reason, el.status,el.number_of_days, emp.name
      FROM empleaves el
      JOIN employees emp ON emp.id = el.employee_id
      WHERE emp.name ILIKE $1
      ORDER BY el.start_date DESC
    `;
      queryParams = [userName];
    } else if (startDate && endDate) {
      queryText = `
        SELECT el.leave_type, el.start_date,el.end_date, el.reason, el.status,el.number_of_days, emp.name
        FROM empleaves el
        JOIN employees emp ON emp.id = el.employee_id
        WHERE emp.name ILIKE $1
          AND el.start_date <= $3
          AND el.end_date >= $2
        ORDER BY el.start_date DESC
      `;
      queryParams = [userName, startDate, endDate];
    } else {
      queryText = `
      SELECT el.leave_type, el.start_date,el.end_date, el.reason, el.status,el.number_of_days, emp.name
      FROM empleaves el
      JOIN employees emp ON emp.id = el.employee_id
      WHERE emp.name ILIKE $1
      ORDER BY el.start_date DESC
      LIMIT 5
    `;
      queryParams = [userName];
    }

    const res = await pool.query(queryText, queryParams);
    console.log("LeavesCount query results:", res.rows.length);

    if (res.rows.length === 0) {
      return [{
        pageContent: `No leave records found for ${userName}.`,
        metadata: { _table: "empleaves" }
      }];
    }
    console.log("LeavesCount query results:", res.rows.number_of_days);

    let content = `${userName}'s Leave Details:\n`;
    res.rows.forEach(row => {
      content += `- ${moment(row.start_date).format("YYYY-MM-DD")}`;
      if (row.end_date && row.end_date !== row.start_date) {
        content += ` to ${moment(row.end_date).format("YYYY-MM-DD")}`;
        content += ` (${row.number_of_days} days)`;
      }
      content += `: ${row.reason} (${row.status})\n`;
    });

    if (!startDate && !endDate && !wantsAll) {
      content = "Showing latest 5 leave records. For a specific date range, please provide start and end dates.\n" + content;
    }

    return [{
      pageContent: content.trim(),
      metadata: { _table: "empleaves" }
    }];
  }

  return null;
}

// --- Add this helper near isPronoun ---
async function resolvePronounToLastEmployee(chatHistory = []) {
  if (!chatHistory.length) return null;

  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i]?.content || '';
    const nlpRes = await nlpManager.process("en", msg);
    const employeeEntity = nlpRes.entities?.find(e => e.entity === "employee");
    if (employeeEntity) return employeeEntity.option || employeeEntity.sourceText;
  }
  return null;
}
function isPronoun(text) {
  if (!text || typeof text !== "string") return false;
  const pronouns = ["he", "she", "him", "her", "they", "them", "his", "hers", "their", "theirs"];
  const words = text.toLowerCase().split(/\s+/);
  return words.some(word => pronouns.includes(word));
}

// Helper: Handle fallback similarity search
async function handleFallback(baseRetriever, query, table, columns, k = 3, chatHistory = []) {
  const nlpRes = await nlpManager.process("en", query);
  let employeeEntity = nlpRes.entities.find(e => e.entity === "employee");
  let userName = employeeEntity ? (employeeEntity.option || employeeEntity.sourceText) : null;

  // --- Step 1: Pronoun handling ---
  if (!userName) {
    if (isPronoun(query)) {
      console.log("Query contains pronoun → resolving to last mentioned employee...");
      userName = resolvePronounToLastEmployee(chatHistory);

      if (!userName) {
        return [{
          pageContent: `I couldn't resolve who "${query}" refers to. Please mention the employee name.`,
          metadata: { _table: "employees" }
        }];
      }
    } else {
      return [{
        pageContent: `I don’t know what "${query}" refers to. Please specify a name.`,
        metadata: { _table: "employees" }
      }];
    }
  }

  // --- Step 2: Check if employee exists in DB ---
  if (userName && !isPronoun(userName)) {
    const exists = await checkEmployeeExists(userName);
    if (!exists) {
      return [{
        pageContent: `User "${userName}" doesn’t exist.`,
        metadata: { _table: "employees" }
      }];
    }
  }

  // --- Step 3: Extract date range ---
  const { startDate, endDate, wantsAll } = getDateRangeFromQuery(query);
  console.log("Extracted date range:", startDate, endDate, "Wants all:", wantsAll);

  const enrichedDocs = [];

  // --- Step 4: If no date range, fetch latest 5 entries ---
  if ((!startDate || !endDate) && !wantsAll) {
    try {
      let latestQuery;
      let params = [];

      if (table === "employees") {
        latestQuery = `
            SELECT * FROM employees
            ${userName ? "WHERE LOWER(name) = LOWER($1)" : ""}
            ORDER BY date DESC
            LIMIT 5
        `;
        if (userName) params.push(userName);
      } else {
        latestQuery = `
          SELECT t.*, e.name
          FROM ${table} t
          JOIN employees e ON t.employee_id = e.id
          ${userName ? "WHERE LOWER(e.name) = LOWER($1)" : ""}
          ORDER BY t.date DESC
          LIMIT 5
        `;
        if (userName) params.push(userName);
      }

      const latestResult = await pool.query(latestQuery, params);

      if (latestResult.rows.length > 0) {
        for (const row of latestResult.rows) {
          const combinedContent = createCombinedContent(row, columns);
          enrichedDocs.push({
            pageContent: combinedContent,
            metadata: {
              ...row,
              _table: table,
              _columns: columns.map(c => c.name)
            }
          });
        }
        // Add message about specifying date range
        enrichedDocs.unshift({
          pageContent: "Showing latest 5 records. For a specific date range, please provide start and end dates.",
          metadata: { _table: table }
        });
      }
    } catch (err) {
      console.error("Error fetching latest records:", err);
    }
  }

  // --- Step 5: Fallback similarity search ---
  console.log("Performing fallback similarity search...");
  const docs = await baseRetriever.getRelevantDocuments(query, { k });

  for (const doc of docs) {
    try {
      const docId = doc.metadata?.id || doc.id;
      if (docId) {
        const fullRowQuery = `SELECT * FROM ${table} WHERE id = ANY($1::int[])`;
        const fullRowResult = await pool.query(fullRowQuery, [Array.isArray(docId) ? docId : [docId]]);

        if (fullRowResult.rows.length > 0) {
          for (const row of fullRowResult.rows) {
            // Filter by employee name if provided
            const nameMatch = !userName || (row.name && row.name.toLowerCase() === userName.toLowerCase());

            // Filter by date range if applicable and not wanting all
            let dateMatch = true;
            let rowDate = row.date || row.start_date || row.end_date;
            if (rowDate && startDate && endDate) {
              const start = new Date(startDate);
              const end = new Date(endDate);
              rowDate = new Date(rowDate);
              dateMatch = (rowDate >= start && rowDate <= end);
            }

            if (nameMatch && dateMatch) {
              const combinedContent = createCombinedContent(row, columns);
              enrichedDocs.push({
                ...doc,
                pageContent: combinedContent,
                metadata: {
                  ...doc.metadata,
                  ...row,
                  _table: table,
                  _columns: columns.map(c => c.name)
                }
              });
            }
          }
        }
      }
    } catch (rowError) {
      console.error(`Error fetching full row data for doc in ${table}:`, rowError);
      enrichedDocs.push({
        ...doc,
        metadata: { ...doc.metadata, _table: table }
      });
    }
  }

  if (enrichedDocs.length === 0 && startDate && endDate && !wantsAll) {
    return [{
      pageContent: `No records available for the date range ${startDate} to ${endDate}.`,
      metadata: { _table: table }
    }];
  }

  if (enrichedDocs.length === 0) {
    return [{
      pageContent: "That's beyond my scope. Please reframe your question.",
      metadata: { _table: "system" }
    }];
  }

  return enrichedDocs;
}

export const initRetriever = async () => {
  const client = await pool.connect();
  const employeeNames = await getEmployeeNamesFromDB(client);
  await initNLP(employeeNames);

  try {
    const res = await client.query(`
      SELECT tablename 
      FROM pg_catalog.pg_tables 
      WHERE schemaname = 'public' 
      AND tablename NOT LIKE '%_embedding%' 
      AND tablename NOT LIKE 'langchain_%';
    `);

    const tables = res.rows.map(r => r.tablename);

    for (const table of tables) {
      try {
        const columns = await getTableColumns(client, table);

        const hasId = columns.some(c => c.name === "id");
        const hasEmbedding = columns.some(c => c.name === "embedding");
        if (!hasId || !hasEmbedding) continue;

        let contentColumn = columns.find(c => c.name === "name")?.name;
        if (!contentColumn) {
          contentColumn = columns.find(
            c =>
              c.type === "text" ||
              c.type === "character varying" ||
              c.type === "varchar"
          )?.name;
        }
        if (!contentColumn) {
          continue;
        }

        const vectorStore = await PGVectorStore.initialize(embeddings, {
          pool,
          tableName: table,
          columns: {
            idColumnName: "id",
            vectorColumnName: "embedding",
            contentColumnName: contentColumn,
          },
        });

        const baseRetriever = vectorStore.asRetriever({
          searchType: "similarity",
          search_kwargs: { k: 5 },
        });

        // Retriever's invoke now only does fallback similarity search
        retrievers[table] = {
          invoke: async (query, chatHistory = []) => {
            try {
              const fallbackResponse = await handleFallback(
                baseRetriever,
                query,
                table,
                columns,
                5,
                chatHistory
              );
              return fallbackResponse;
            } catch (error) {
              console.error(`Error in fallback retriever for table ${table}:`, error);
              throw error;
            }
          }
        };

        console.log(`Custom fallback retriever initialized for table: ${table}`);
      } catch (tableError) {
        console.error(`Error initializing retriever for table ${table}:`, tableError);
        continue;
      }
    }

    if (Object.keys(retrievers).length === 0) {
      throw new Error("No retrievers were successfully initialized");
    }

    console.log(`Successfully initialized ${Object.keys(retrievers).length} retrievers`);
  } finally {
    client.release();
  }
};

// New global intent processing function
async function processIntentOnce(query) {
  console.log("Processing intent for query:", query);
  const nlpRes = await nlpManager.process("en", query);
  const intent = nlpRes.intent;
  const confidence = nlpRes.score || 0;
  const employeeEntity = nlpRes.entities.find(e => e.entity === "employee");
  const userName = employeeEntity ? employeeEntity.option || employeeEntity.sourceText : null;
  console.log("Extracted employee entity:", userName, "intent", intent, "confidence", confidence);

  if (confidence >= 0.9 && intent !== "None") {
    const intentResponse = await handleIntent(intent, userName, query, nlpRes);
    console.log("Intent response:", intentResponse);
    if (intentResponse) return intentResponse;
  }
  return null;
}

// Merged retriever invoke separate, controls intent vs fallback logic
export const getMergedRetriever = () => {
  if (!Object.keys(retrievers).length) {
    throw new Error("No retrievers initialized yet");
  }
  return {
    invoke: async (query) => {
      //Try intent-based response once per query globally
      const intentResult = await processIntentOnce(query);
      if (intentResult) {
        console.log("Returning intent response, skipping fallback search");
        return intentResult;
      }

      //loop fallback similarity search over all retrievers
      let results = [];
      for (const [tableName, retriever] of Object.entries(retrievers)) {
        try {
          console.log("query in handlefallback function:", query);
          const docs = await retriever.invoke(query); // fallback similarity only
          results = results.concat(docs.map(d => ({ ...d, _source: tableName })));
        } catch (error) {
          console.error(`Error during fallback search in table ${tableName}`, error);
        }
      }
      console.log(`Total fallback documents found: ${results.length}`);
      results.sort((a, b) => {
        // Sort descending by score: higher scores first
        return (b.score ?? -Infinity) - (a.score ?? -Infinity);
      });
      return results;
    }
  };
};


export { retrievers };
