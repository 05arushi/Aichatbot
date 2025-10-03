// retriever.js - Optimized with caching and batching
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { embeddings } from "./llm.js";
import pool from "../db.js";
import { NlpManager } from "node-nlp";
import moment from 'moment';
import * as chrono from 'chrono-node';
import { traceable } from "langsmith/traceable";
import { NodeCache } from '@cacheable/node-cache';

// ========== CACHING ==========
const employeeCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const nlpCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });
const dateCache = new NodeCache({ stdTTL: 600, checkperiod: 60 });

let retrievers = {};
export const nlpManager = new NlpManager({ languages: ["en"], forceNER: true });

// ========== CACHED HELPER FUNCTIONS ==========

const getEmployeeNamesFromDB = traceable(
  async (client) => {
    const cached = employeeCache.get('employeeNames');
    if (cached) return cached;

    const res = await client.query('SELECT name FROM employees');
    const names = res.rows.map(row => row.name);
    employeeCache.set('employeeNames', names);
    return names;
  },
  { name: "GetEmployeeNamesFromDB", tags: ["database", "employees", "cache"] }
);

const checkEmployeeExists = traceable(
  async (name) => {
    const cacheKey = `exists:${name.toLowerCase()}`;
    const cached = employeeCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const client = await pool.connect();
    try {
      const names = await getEmployeeNamesFromDB(client);
      const exists = names.some(n => n.toLowerCase() === name.toLowerCase());
      employeeCache.set(cacheKey, exists);
      return exists;
    } finally {
      client.release();
    }
  },
  { name: "CheckEmployeeExists", tags: ["validation", "cache"] }
);

const initNLP = traceable(
  async (employeeNames) => {
    // Add alphabet entities
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
    alphabet.forEach(letter => {
      nlpManager.addNamedEntityText("startLetter", letter, ["en"], [letter, letter.toUpperCase()]);
      nlpManager.addNamedEntityText("endLetter", letter, ["en"], [letter, letter.toUpperCase()]);
    });

    // Add employee entities
    employeeNames.forEach(name => {
      const variations = name.toLowerCase().split(' ');
      nlpManager.addNamedEntityText("employee", name, ["en"], [name.toLowerCase(), ...variations]);
    });

    // Add regex entity
    nlpManager.addRegexEntity("number", "en", /\b\d+\b/);

    // Add intent documents
    const intents = {
      WorkReport: [
        "give me {number} latest work reports of {employee}",
        "show the latest report of {employee}",
        "latest report of {employee}",
        "give me last {number} reports of {employee}",
        "get the last entered report for {employee}",
        "yesterday work",
        "work done yesterday",
        "{employee} do yesterday",
        "{employee} working on yesterday",
        "show me {employee}'s report for yesterday"
      ],
      filterNamesByLetter: [
        "list names starting with {startLetter}",
        "list names ending with {endLetter}",
        "names starting with {startLetter} and ending with {endLetter}",
        "show me employees whose names start with {startLetter} and end with {endLetter}",
        "list names that start with {startLetter} and end with {endLetter}"
      ],
      employeeCount: [
        "total employees",
        "number of employees",
        "how many employees"
      ],
      leavesCount: [
        "total leaves",
        "number of leaves",
        "how many leaves",
        "was {employee} absent yesterday",
        "was {employee} on leave yesterday",
        "did {employee} take leave yesterday",
        "was he absent yesterday",
        "was she on leave yesterday"
      ],
      allusers: [
        "List all the users",
        "Show me all users",
        "Display all users",
        "list all the employees"
      ]
    };

    Object.entries(intents).forEach(([intent, documents]) => {
      documents.forEach(doc => nlpManager.addDocument("en", doc, intent));
    });

    await nlpManager.train();
    console.log("✅ NLP Manager trained");
  },
  { name: "InitNLP", tags: ["nlp", "initialization"] }
);

const getTableColumns = traceable(
  async (client, tableName) => {
    const cacheKey = `columns:${tableName}`;
    const cached = employeeCache.get(cacheKey);
    if (cached) return cached;

    const query = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    const result = await client.query(query, [tableName]);
    const columns = result.rows.map(row => ({
      name: row.column_name,
      type: row.data_type,
    }));
    
    employeeCache.set(cacheKey, columns);
    return columns;
  },
  { name: "GetTableColumns", tags: ["database", "schema", "cache"] }
);

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

const getDateRangeFromQuery = traceable(
  (query) => {
    const cacheKey = `date:${query.toLowerCase()}`;
    const cached = dateCache.get(cacheKey);
    if (cached) return cached;

    const parsed = chrono.parse(query);
    const normalized = query.toLowerCase();

    if (/\b(last|recent)\s+(\d+)\s+(reports?|entries?|records?|tasks?|works?)?\b/.test(normalized)) {
      const result = { startDate: null, endDate: null, wantsAll: false };
      dateCache.set(cacheKey, result);
      return result;
    }

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

      for (const key in periodMap) {
        if (text.includes(key)) {
          const [start, end] = periodMap[key]();
          const result = {
            startDate: start.format("YYYY-MM-DD"),
            endDate: end.format("YYYY-MM-DD"),
            wantsAll: false
          };
          dateCache.set(cacheKey, result);
          return result;
        }
      }

      if (parsed[0].start && parsed[0].end) {
        const result = {
          startDate: moment(parsed[0].start.date()).format("YYYY-MM-DD"),
          endDate: moment(parsed[0].end.date()).format("YYYY-MM-DD"),
          wantsAll: false
        };
        dateCache.set(cacheKey, result);
        return result;
      }

      if (comp) {
        const dateStr = moment(comp.date()).format("YYYY-MM-DD");
        const result = { startDate: dateStr, endDate: dateStr, wantsAll: false };
        dateCache.set(cacheKey, result);
        return result;
      }
    }

    if (/\ball\b|\bcomplete\b|\bfull\b/.test(normalized)) {
      const result = { startDate: null, endDate: null, wantsAll: true };
      dateCache.set(cacheKey, result);
      return result;
    }

    if (/latest|recent|last entered/.test(normalized)) {
      const today = moment().format("YYYY-MM-DD");
      const result = { startDate: today, endDate: today, wantsAll: false };
      dateCache.set(cacheKey, result);
      return result;
    }

    const result = { startDate: null, endDate: null, wantsAll: false };
    dateCache.set(cacheKey, result);
    return result;
  },
  { name: "GetDateRangeFromQuery", tags: ["date-parsing", "nlp", "cache"] }
);

// ========== NLP PROCESSING WITH CACHE ==========

const getNLPResult = traceable(
  async (query) => {
    const cacheKey = `nlp:${query.toLowerCase()}`;
    const cached = nlpCache.get(cacheKey);
    if (cached) return cached;

    const result = await nlpManager.process("en", query);
    nlpCache.set(cacheKey, result);
    return result;
  },
  { name: "GetNLPResult", tags: ["nlp", "cache"] }
);

// ========== INTENT HANDLERS ==========

const truncateContent = (content, maxLength = 800) => {
  if (!content) return "";
  const str = String(content);
  return str.length <= maxLength ? str : str.slice(0, maxLength) + "...";
};

const handleIntent = traceable(
  async (intent, userName, query, nlpRes) => {
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

      let pattern = "%";
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

      let limitCount = numberEntity ? parseInt(numberEntity.option || numberEntity.sourceText) : 5;
      if (isNaN(limitCount) || limitCount <= 0) limitCount = 5;

      const res = await pool.query(
        `SELECT name FROM employees WHERE LOWER(name) LIKE $1 ORDER BY id DESC LIMIT $2`,
        [pattern, limitCount]
      );

      const names = res.rows.map(row => row.name);
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
          WHERE emp.name ILIKE $1 AND edr.date BETWEEN $2 AND $3
          ORDER BY edr.date DESC
        `;
        queryParams = [userName, startDate, endDate];
      } else {
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

      if (res.rows.length === 0) {
        return [{
          pageContent: `No work report of ${userName} was found matching the criteria.`,
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
      const res = await pool.query(`SELECT name, role, department, skills FROM employees`);
      if (res.rows.length === 0) {
        return [{
          pageContent: `No users found in the database.`,
          metadata: { _table: "employees" }
        }];
      }
      
      let table = `| Name | Role | Department | Skills |\n`;
      table += `|------|------|------------|--------|\n`;

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

      let queryText, queryParams;
      if (wantsAll) {
        queryText = `
          SELECT el.leave_type, el.start_date, el.end_date, el.reason, el.status, el.number_of_days, emp.name
          FROM empleaves el
          JOIN employees emp ON emp.id = el.employee_id
          WHERE emp.name ILIKE $1
          ORDER BY el.start_date DESC
        `;
        queryParams = [userName];
      } else if (startDate && endDate) {
        queryText = `
          SELECT el.leave_type, el.start_date, el.end_date, el.reason, el.status, el.number_of_days, emp.name
          FROM empleaves el
          JOIN employees emp ON emp.id = el.employee_id
          WHERE emp.name ILIKE $1 AND el.start_date <= $3 AND el.end_date >= $2
          ORDER BY el.start_date DESC
        `;
        queryParams = [userName, startDate, endDate];
      } else {
        queryText = `
          SELECT el.leave_type, el.start_date, el.end_date, el.reason, el.status, el.number_of_days, emp.name
          FROM empleaves el
          JOIN employees emp ON emp.id = el.employee_id
          WHERE emp.name ILIKE $1
          ORDER BY el.start_date DESC
          LIMIT 5
        `;
        queryParams = [userName];
      }

      const res = await pool.query(queryText, queryParams);

      if (res.rows.length === 0) {
        return [{
          pageContent: `No leave records found for ${userName}.`,
          metadata: { _table: "empleaves" }
        }];
      }

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
  },
  { name: "HandleIntent", tags: ["intent", "nlp", "database"] }
);

// ========== PRONOUN RESOLUTION ==========

const resolvePronounToLastEmployee = traceable(
  async (chatHistory = []) => {
    if (!chatHistory.length) return null;

    // Only check last 2 messages for performance
    const recentMessages = chatHistory.slice(-2);
    
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i]?.content || '';
      const nlpRes = await getNLPResult(msg);
      const employeeEntity = nlpRes.entities?.find(e => e.entity === "employee");
      if (employeeEntity) return employeeEntity.option || employeeEntity.sourceText;
    }
    return null;
  },
  { name: "ResolvePronounToLastEmployee", tags: ["pronoun-resolution", "context"] }
);

const isPronoun = (text) => {
  if (!text || typeof text !== "string") return false;
  const pronouns = ["he", "she", "him", "her", "they", "them", "his", "hers", "their", "theirs"];
  const words = text.toLowerCase().split(/\s+/);
  return words.some(word => pronouns.includes(word));
};

// ========== OPTIMIZED FALLBACK HANDLER ==========

const handleFallback = traceable(
  async (baseRetriever, query, table, columns, k = 3, chatHistory = []) => {
    const nlpRes = await getNLPResult(query);
    let employeeEntity = nlpRes.entities.find(e => e.entity === "employee");
    let userName = employeeEntity ? (employeeEntity.option || employeeEntity.sourceText) : null;

    // Step 1: Pronoun handling
    if (!userName && isPronoun(query)) {
      console.log("Query contains pronoun → resolving to last mentioned employee...");
      userName = await resolvePronounToLastEmployee(chatHistory);

      if (!userName) {
        return [{
          pageContent: `I couldn't resolve who "${query}" refers to. Please mention the employee name.`,
          metadata: { _table: "employees" }
        }];
      }
    }

    // Step 2: Validate employee exists
    if (userName && !isPronoun(userName)) {
      const exists = await checkEmployeeExists(userName);
      if (!exists) {
        return [{
          pageContent: `User "${userName}" doesn't exist.`,
          metadata: { _table: "employees" }
        }];
      }
    }

    // Step 3: Get date range
    const dateCol = columns.find(c => ["date", "start_date", "end_date"].includes(c.name))?.name;
    const { startDate, endDate, wantsAll } = getDateRangeFromQuery(query);

    const enrichedDocs = [];

    // Step 4: Fetch latest records if no date range
    if ((!startDate || !endDate) && !wantsAll && userName) {
      try {
        let latestQuery, params = [];

        if (table === "employees") {
          latestQuery = `SELECT * FROM employees WHERE LOWER(name) = LOWER($1) LIMIT 5`;
          params = [userName];
        } else if (dateCol) {
          latestQuery = `
            SELECT t.*, e.name
            FROM ${table} t
            JOIN employees e ON t.employee_id = e.id
            WHERE LOWER(e.name) = LOWER($1)
            ORDER BY t.${dateCol} DESC
            LIMIT 5
          `;
          params = [userName];
        } else {
          latestQuery = `
            SELECT t.*, e.name
            FROM ${table} t
            JOIN employees e ON t.employee_id = e.id
            WHERE LOWER(e.name) = LOWER($1)
            ORDER BY t.id DESC
            LIMIT 5
          `;
          params = [userName];
        }

        const latestResult = await pool.query(latestQuery, params);

        if (latestResult.rows.length > 0) {
          enrichedDocs.push({
            pageContent: "Showing latest 5 records. For a specific date range, please provide start and end dates.",
            metadata: { _table: table }
          });

          latestResult.rows.forEach(row => {
            const combinedContent = createCombinedContent(row, columns);
            enrichedDocs.push({
              pageContent: truncateContent(combinedContent),
              metadata: { ...row, _table: table, _columns: columns.map(c => c.name) }
            });
          });
        }
      } catch (err) {
        console.error("Error fetching latest records:", err);
      }
    }

    // Step 5: Similarity search with batch processing
    if (enrichedDocs.length === 0) {
      console.log("Performing fallback similarity search...");
      const docs = await baseRetriever.getRelevantDocuments(query, { k });

      // Batch fetch all document IDs at once
      const docIds = docs.map(doc => doc.metadata?.id || doc.id).filter(id => id).flat();

      if (docIds.length > 0) {
        const fullRowQuery = `SELECT * FROM ${table} WHERE id = ANY($1::int[])`;
        const fullRowResult = await pool.query(fullRowQuery, [docIds]);

        // Create lookup map for O(1) access
        const rowMap = new Map(fullRowResult.rows.map(row => [row.id, row]));

        docs.forEach(doc => {
          const docId = doc.metadata?.id || doc.id;
          const row = rowMap.get(docId);

          if (row) {
            const nameMatch = !userName || (row.name && row.name.toLowerCase() === userName.toLowerCase());

            let dateMatch = true;
            if (startDate && endDate) {
              const rowDate = new Date(row.date || row.start_date || row.end_date);
              const start = new Date(startDate);
              const end = new Date(endDate);
              dateMatch = (rowDate >= start && rowDate <= end);
            }

            if (nameMatch && dateMatch) {
              const combinedContent = createCombinedContent(row, columns);
              enrichedDocs.push({
                ...doc,
                pageContent: truncateContent(combinedContent),
                metadata: { ...doc.metadata, ...row, _table: table, _columns: columns.map(c => c.name) }
              });
            }
          }
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
  },
  { name: "HandleFallback", tags: ["fallback", "similarity-search", "retrieval"] }
);

// ========== RETRIEVER INITIALIZATION ==========

export const initRetriever = traceable(
  async () => {
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

          let contentColumn = columns.find(c => c.name === "name")?.name ||
                             columns.find(c => ["text", "character varying", "varchar"].includes(c.type))?.name;

          if (!contentColumn) continue;

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
            search_kwargs: { k: 3 },
          });

          retrievers[table] = {
            invoke: traceable(
              async (query, chatHistory = []) => {
                return await handleFallback(baseRetriever, query, table, columns, 5, chatHistory);
              },
              { name: `Retriever_${table}`, tags: ["retriever", table] }
            )
          };

          console.log(`Retriever initialized for table: ${table}`);
        } catch (tableError) {
          console.error(`Error initializing retriever for table ${table}:`, tableError);
        }
      }

      if (Object.keys(retrievers).length === 0) {
        throw new Error("No retrievers were successfully initialized");
      }

      console.log(`✅ Successfully initialized ${Object.keys(retrievers).length} retrievers`);
    } finally {
      client.release();
    }
  },
  { name: "InitRetriever", tags: ["initialization", "retriever"] }
);

// ========== INTENT PROCESSING ==========

const processIntentOnce = traceable(
  async (query) => {
    console.log("Processing intent for query:", query);
    const nlpRes = await getNLPResult(query);
    const intent = nlpRes.intent;
    const confidence = nlpRes.score || 0;
    const employeeEntity = nlpRes.entities.find(e => e.entity === "employee");
    const userName = employeeEntity ? employeeEntity.option || employeeEntity.sourceText : null;
    console.log("Intent:", intent, "Confidence:", confidence, "Employee:", userName);

    if (confidence >= 0.9 && intent !== "None") {
      const intentResponse = await handleIntent(intent, userName, query, nlpRes);
      if (intentResponse) return intentResponse;
    }
    return null;
  },
  { name: "ProcessIntent", tags: ["intent", "nlp"] }
);

// ========== MERGED RETRIEVER ==========

export const getMergedRetriever = () => {
  if (!Object.keys(retrievers).length) {
    throw new Error("No retrievers initialized yet");
  }
  
  return {
    invoke: traceable(
      async (query) => {
        // Check intent first
        const intentResult = await processIntentOnce(query);
        if (intentResult) {
          console.log("✅ Intent matched, returning direct response");
          return intentResult;
        }

        // Fallback to similarity search across all tables
        console.log("No intent match, performing similarity search...");
        let results = [];
        
        for (const [tableName, retriever] of Object.entries(retrievers)) {
          try {
            const docs = await retriever.invoke(query);
            results = results.concat(docs.map(d => ({ ...d, _source: tableName })));
          } catch (error) {
            console.error(`Error in table ${tableName}:`, error);
          }
        }
        
        console.log(`Found ${results.length} documents across all tables`);
        
        // Sort by relevance score
        results.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
        
        return results;
      },
      { name: "MergedRetrieverInvoke", tags: ["retriever", "merged"] }
    )
  };
};

export { retrievers };