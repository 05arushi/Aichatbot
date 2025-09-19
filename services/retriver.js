import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { embeddings } from "./llm.js";
import pool from "../db.js";
import { NlpManager } from "node-nlp";
import moment from 'moment';
import * as chrono from 'chrono-node';

let retrievers = {};
const nlpManager = new NlpManager({ languages: ["en"], forceNER: true });

const getEmployeeNamesFromDB = async (client) => {
  const res = await client.query('SELECT name FROM employees');
  return res.rows.map(row => row.name);
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

  // Detect if query asks for numeric-limited last N reports (e.g., "last 3 reports")
  const lastNMatch = normalized.match(/\b(last|recent)\s+(\d+)\s+(reports|entries|records|tasks|works)?\b/);
  if (lastNMatch) {
    // Number detected → no date filtering for limited last N reports
    return { startDate: null, endDate: null, wantsAll: false };
  }

  // Handle natural date ranges or single date (e.g., "last week", "yesterday", "today")
  if (parsed.length) {
    if (parsed[0].start && parsed[0].end) {
      return {
        startDate: moment(parsed[0].start.date()).format("YYYY-MM-DD"),
        endDate: moment(parsed[0].end.date()).format("YYYY-MM-DD"),
        wantsAll: false,
      };
    } else if (parsed[0].start) {
      const dateStr = moment(parsed[0].start.date()).format("YYYY-MM-DD");
      return { startDate: dateStr, endDate: dateStr, wantsAll: false };
    }
  }

  // Handle explicit "all" or "complete" requests
  if (/\ball\b/.test(normalized) || /\bcomplete\b/.test(normalized) || /\bfull\b/.test(normalized)) {
    return { startDate: null, endDate: null, wantsAll: true };
  }

  // Handle "latest" or "recent" keywords - interpret as today's date
  if (/latest|recent|last entered/.test(normalized)) {
    const today = moment().format("YYYY-MM-DD");
    return { startDate: today, endDate: today, wantsAll: false };
  }

  // Default fallback: no filtering (null dates)
  return { startDate: null, endDate: null, wantsAll: false };
}

async function handleIntent(intent, confidence, userName, query, nlpRes) {

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
    if(wantsAll){
      queryText = `
        SELECT edr.tasks, edr.date, emp.name
        FROM empdailyreports edr
        JOIN employees emp ON emp.id = edr.employee_id
        WHERE emp.name ILIKE $1
        ORDER BY edr.date DESC
      `;
      queryParams = [userName];
    }else if (startDate && endDate) {
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
  const countRes = await pool.query(
    `SELECT COUNT(*) AS leave_count
     FROM empleaves el
     JOIN employees emp ON emp.id = el.employee_id
     WHERE emp.name ILIKE $1`,
    [userName]
  );

  return [{
    pageContent: `Total leaves for ${userName}: ${countRes.rows[0].leave_count}`,
    metadata: { _table: "empleaves" }
  }];
}


  return null;
}

// Helper: Handle fallback similarity search
async function handleFallback(baseRetriever, query, table, columns, k, employeeName = null) {
  // Extract date range and all-flag from query inside fallback
  const { startDate, endDate, wantsAll } = getDateRangeFromQuery(query);
  console.log("Extracted date range:", startDate, endDate, "Wants all:", wantsAll);

  console.log("Performing fallback similarity search...");
  const docs = await baseRetriever.getRelevantDocuments(query, { k });

  const enrichedDocs = [];
  for (const doc of docs) {
    try {
      const docId = doc.metadata?.id || doc.id;
      if (docId) {
        const fullRowQuery = `SELECT * FROM ${table} WHERE id = ANY($1::int[])`;
        const fullRowResult = await pool.query(fullRowQuery, [Array.isArray(docId) ? docId : [docId]]);

        if (fullRowResult.rows.length > 0) {
          for (const row of fullRowResult.rows) {
            // Filter by employee name if provided
            const nameMatch = !employeeName || (row.name && row.name.toLowerCase() === employeeName.toLowerCase());

            // Filter by date range if applicable and not wanting all
            let dateMatch = true;
            if (!wantsAll && startDate && endDate && row.date) {
              const rowDate = new Date(row.date);
              const start = new Date(startDate);
              const end = new Date(endDate);
              dateMatch = (rowDate >= start) && (rowDate <= end);
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
      pageContent: `No reports available for the date range ${startDate} to ${endDate}.`,
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

// Map intent -> relevant tables
const intentTableMap = {
  WorkReport: ["empdailyreports"],
  leaveDetails: ["empleaves"],
  employeeInfo: ["employees"],
};

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
    // console.log("Available tables:", tables);

    for (const table of tables) {
      try {
        const columns = await getTableColumns(client, table);
        // console.log(`Table ${table} columns:`, columns.map(c => c.name));

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
          // console.log(`Skipping table ${table}: no suitable content column found`);
          continue;
        }
        // console.log(`Using content column '${contentColumn}' for table ${table}`);

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

        retrievers[table] = {
          invoke: async (query) => {
            try {
              // Process with NLP.js
              const nlpRes = await nlpManager.process("en", query);
              const intent = nlpRes.intent;
              const confidence = nlpRes.score || 0;
              console.log("the search intent is:", intent, "and confidence is:", confidence);
              const employeeEntity = nlpRes.entities.find(
                e => e.entity === "employee"
              );
              const userName = employeeEntity
                ? employeeEntity.option || employeeEntity.sourceText
                : null;

              const numberEntity = nlpRes.entities.find(e => e.entity === "number");
              let limitCount = numberEntity ? parseInt(numberEntity.option || numberEntity.sourceText) : 5;
              if (isNaN(limitCount) || limitCount <= 0) limitCount = 5;
              console.log("the employee name is:", userName, "from the query:", query, "from table:", table);


              if (confidence >= 0.9 && intent !== "None") {
                const intentResponse = await handleIntent(intent, confidence, userName, query, nlpRes);
                console.log("intenetResponse is:", intentResponse);
                if (intentResponse) {
                  return intentResponse;
                }
              }


              // Fallback similarity search
              const allowedTables = intentTableMap[intent] || [table];
              if (!allowedTables.includes(table)) {
                return []; // skip irrelevant tables
              }

              const fallbackResponse = await handleFallback(
                baseRetriever,
                query,
                table,
                columns,
                limitCount
              );
              return fallbackResponse;

            } catch (error) {
              console.error(`Error in custom retriever for ${table}:`, error);
              throw error;
            }
          }
        };

        console.log(`Custom retriever initialized for table: ${table}`);
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

export const getRetriever = (tableName) => {
  if (!retrievers[tableName]) {
    throw new Error(`Retriever not initialized for ${tableName}`);
  }
  return retrievers[tableName];
};

export const getMergedRetriever = () => {
  if (!Object.keys(retrievers).length) {
    throw new Error("No retrievers initialized yet");
  }
  return {
    invoke: async (query) => {
      let results = [];
      for (const [name, retriever] of Object.entries(retrievers)) {
        try {
          const docs = await retriever.invoke(query);
          console.log(`Found ${docs.length} documents in table: ${name}`);

          results = results.concat(
            docs.map(d => ({
              ...d,
              _source: name,
            }))
          );
        } catch (error) {
          console.error(`Error searching table ${name}:`, error);
        }
      }
      console.log(`Total documents found: ${results.length}`);
      return results;
    }
  };
};

export { retrievers };
