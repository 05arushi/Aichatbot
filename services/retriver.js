import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { embeddings } from "./llm.js";
import pool from "../db.js";
import { NlpManager } from "node-nlp";
import moment from 'moment';

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
  nlpManager.addDocument("en", "show me the last {number} work reports for {employee}", "latestWorkReport");
  nlpManager.addDocument("en", "give me {number} latest work reports of {employee}", "latestWorkReport");
  nlpManager.addDocument("en", "show the latest report of {employee}", "latestWorkReport");
  nlpManager.addDocument("en", "get the last report for {employee}", "latestWorkReport");

  // Intent training samples
  nlpManager.addDocument("en", "names starting with {startLetter}", "filterNamesByLetter");
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

  nlpManager.addDocument("en", "yesterday work", "yesterdayWorkReport");
  nlpManager.addDocument("en", "work done yesterday", "yesterdayWorkReport");
  nlpManager.addDocument("en", "{employee} do yesterday", "yesterdayWorkReport");
  nlpManager.addDocument("en", "{employee} working on yesterday", "yesterdayWorkReport");
  nlpManager.addDocument("en", "show me {employee}'s report for yesterday", "yesterdayWorkReport");

  nlpManager.addDocument("en", "hello", "greeting");
  nlpManager.addDocument("en", "hi", "greeting");
  nlpManager.addDocument("en", "good morning", "greeting");
  nlpManager.addDocument("en", "how are you", "greeting");
  nlpManager.addDocument("en", "how you doing", "greeting");

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

  if (intent === "latestWorkReport" && userName) {
    // Extract limit dynamically from question text
    const numberEntity = nlpRes.entities.find(e => e.entity === "number");
    let limitCount = numberEntity ? parseInt(numberEntity.option || numberEntity.sourceText) : 1;
    console.log("Extracted limit count:", limitCount);

    const res = await pool.query(
      `SELECT edr.tasks, edr.date, emp.name
        FROM empdailyreports edr
        JOIN employees emp ON emp.id = edr.employee_id
        WHERE emp.name ILIKE $1
        ORDER BY edr.date DESC
        LIMIT $2
        `,
      [userName, limitCount]
    );

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

      // Use tasks directly; JSONB comes as JS array
      let tasks = Array.isArray(row.tasks) ? row.tasks : [];

      tasks.forEach(task => {
        groupedByDate[date].push(
          `- ${task.title} (${task.hoursSpent} hours, ${task.status})`
        );
      });
    });

    // Build output content
    let content = `${userName}'s Latest Work Reports:\n`;
    for (const date in groupedByDate) {
      content += `* ${date}:\n` + groupedByDate[date].join("\n") + "\n";
    }

    return [{
      pageContent: content.trim(),
      metadata: { _table: "empdailyreports" }
    }];
  }

  if (intent === "leavesCount" && userName) {
    const countRes = await pool.query(
      `SELECT COUNT(*) AS leave_count
       FROM empleaves el
       JOIN employees emp ON emp.id = el.employee_id
       WHERE emp.name ILIKE $1;`,
      [userName]
    );
    return [{
      pageContent: `Total leaves for ${userName}: ${countRes.rows[0].leave_count}`,
      metadata: { _table: "empleaves" }
    }];
  }

  if (intent === "greeting") {
    return [{
      pageContent: `I'm here and happy to help!`,
      metadata: { _table: "none" }
    }];
  }

  if (intent === "yesterdayWorkReport" && userName) {
    const formattedDate = moment().subtract(1, 'days').format('YYYY-MM-DD');
    const reportRes = await pool.query(
      `SELECT * FROM empdailyreports edr
       JOIN employees emp ON emp.id = edr.employee_id
       WHERE emp.name ILIKE $1 AND edr.date = $2`,
      [userName, formattedDate]
    );

    if (reportRes.rows.length === 0) {
      return [{
        pageContent: `No, work report of ${userName} was found of date ${formattedDate}.`,
        metadata: { _table: "empdailyreports" }
      }];
    }

    const groupedByDate = {};
    reportRes.rows.forEach(row => {
      groupedByDate[formattedDate] = groupedByDate[formattedDate] || [];
      groupedByDate[formattedDate].push(`- ${row.task} (${row.hours} hours, ${row.status})`);
    });

    let content = `${userName}'s Work Reports:\n`;
    for (const date in groupedByDate) {
      content += `* ${date}:\n` + groupedByDate[date].join('\n') + '\n';
    }

    return [{
      pageContent: content.trim(),
      metadata: { _table: "empdailyreports" }
    }];
  }

  return null;
}

// Helper: Handle fallback similarity search
async function handleFallback(baseRetriever, query, table, columns, k) {
  const docs = await baseRetriever.getRelevantDocuments(query, { k });

  const enrichedDocs = [];
  for (const doc of docs) {
    try {
      const docId = doc.metadata?.id || doc.id;
      if (docId) {
        const fullRowQuery = `SELECT * FROM ${table} WHERE id = $1`;
        const fullRowResult = await pool.query(fullRowQuery, [docId]);

        if (fullRowResult.rows.length > 0) {
          const fullRow = fullRowResult.rows[0];
          const combinedContent = createCombinedContent(fullRow, columns);

          enrichedDocs.push({
            ...doc,
            pageContent: combinedContent,
            metadata: {
              ...doc.metadata,
              ...fullRow,
              _table: table,
              _columns: columns.map(c => c.name)
            }
          });
        }
      }
    } catch (rowError) {
      console.error(`Error fetching full row data for doc in ${table}:`, rowError);
      enrichedDocs.push({
        ...doc,
        metadata: {
          ...doc.metadata,
          _table: table
        }
      });
    }
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
    console.log("Available tables:", tables);

    for (const table of tables) {
      try {
        const columns = await getTableColumns(client, table);
        console.log(`Table ${table} columns:`, columns.map(c => c.name));

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
          console.log(`Skipping table ${table}: no suitable content column found`);
          continue;
        }
        console.log(`Using content column '${contentColumn}' for table ${table}`);

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
                if (intentResponse) {
                  return intentResponse;
                }
              }


              // Fallback similarity search
              const fallbackResponse = await handleFallback(baseRetriever, query, table, columns, limitCount);
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
