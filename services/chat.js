// chat.js - Optimized with simplified history and reduced redundancy
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { llm } from "./llm.js";
import { retrievers, getMergedRetriever, nlpManager } from "./retriver.js";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { buildCustomContext, sanitizeResponse } from "./contextBuilder.js";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import pool from "../db.js";
import { NodeCache } from '@cacheable/node-cache';
import { getMessagesBySession } from "./chatDatabase.js";
import { traceable } from "langsmith/traceable";
import { truncateContent } from "./retriver.js";

//CACHE & STORAGE
const employeeNameCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const nlpCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });
const HISTORY_WINDOW_SIZE = 4;
const messageHistories = {};

//CACHED NLP PROCESSING

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

// EMPLOYEE NAMES 

export const getAllEmployeeNames = traceable(
  async () => {
    const cached = employeeNameCache.get('employeeNames');
    if (cached) return cached;

    const res = await pool.query("SELECT name FROM employees");
    const names = new Set(res.rows.map(r => r.name));
    employeeNameCache.set('employeeNames', names);
    return names;
  },
  { name: "GetAllEmployeeNames", tags: ["cache", "database"] }
);

// MESSAGE HISTORY 

const getMessageHistoryForSession = traceable(
  async (sessionId) => {
    try {
      const res = await getMessagesBySession(sessionId);

      if (!messageHistories[sessionId]) {
        messageHistories[sessionId] = new ChatMessageHistory();
      }

      const historyObj = messageHistories[sessionId];
      if (!res?.messages) return historyObj;

      const parsedHistory = typeof res.messages === "string" ? JSON.parse(res.messages) : res.messages;

      for (const msg of parsedHistory) {
        if (msg.user) await historyObj.addUserMessage(msg.user);
        else if (msg.assistant) await historyObj.addAIChatMessage(msg.assistant);
      }

      return historyObj;
    } catch (error) {
      console.error("Error retrieving messages:", error);
      messageHistories[sessionId] = new ChatMessageHistory();
      return messageHistories[sessionId];
    }
  },
  { name: "GetMessageHistory", tags: ["history", "database"] }
);


const PROMPTS = {
  base: `You are a concise HR assistant. Respond only about what’s asked. Ignore unrelated names, dates, or departments.

      For contextual questions ("give his report"), use chat history for pronoun resolution and include the employee’s name (e.g., "Bob's Work Reports: ...").

      Never reveal employee IDs, contacts, salaries, or lengthy explanations.

      Critical rules:
      - For "who is [Name]?": Share only name, role, department, skills.
      - Resolve and mention pronouns.
      - Show only requested individual's info.
      - If info missing: "No information found for [Name]."
      - Greetings: "I'm doing well, ask me any office query!"
      - If unclear: "I didn't understand. Please check your query."

      Keep all markdown formatting and structure.`,

    whoIs: `For "Who is" questions: Only state "Name is [Role] in [Department] with skills in [Skills]." Example: "Bob is a Backend Developer in IT with skills in Node.js."`,

    allusers: `For "List all users": Show everyone in a table, full details. Do not exclude unless filtered.`,

    summary: `For summaries: Give a 3-4 line plain paragraph (no bullets). 
    Example: "We have 12 employees across 3 departments..."`,

    workReport: `For work reports: Show only the named employee. 
    If none found: "No work report of [Name] was found for [timeframe]." List name before reports and group by date. Example:
  2025-09-03:
    - Setup project repo (3 hr, Completed)`,

    leaves: `For leave records: If none: "No, [Name] was not on leave [timeframe]." 
    Always mention name before leaves, group by type. Example:
    Sick Leave:
      - 2025-09-02: Fever (Approved)`,

    other: `For all else: Be concise and specific. Respond to greetings warmly.`
};


const INTENT_PROMPT_MAP = {
  employeeInfo: [PROMPTS.base, PROMPTS.whoIs],
  whoIs: [PROMPTS.base, PROMPTS.whoIs],
  allusers: [PROMPTS.base, PROMPTS.allusers],
  summary: [PROMPTS.base, PROMPTS.summary],
  WorkReport: [PROMPTS.base, PROMPTS.workReport],
  leavesCount: [PROMPTS.base, PROMPTS.leaves],
  greeting: [PROMPTS.base, PROMPTS.other],
  default: [PROMPTS.base]
};

const buildPromptForInput = traceable(
  async (input) => {
    const nlpRes = await getNLPResult(input.question);
    const intent = nlpRes.intent || "default";

    const promptSections = INTENT_PROMPT_MAP[intent] || INTENT_PROMPT_MAP.default;
    const systemMessage = promptSections.join("\n");

    return ChatPromptTemplate.fromMessages([
      ["system", systemMessage],
      new MessagesPlaceholder("chat_history"),
      ["human", `Question: {question}\nContext: {context}\n\nProvide a concise answer based on the context.`]
    ]);
  },
  { name: "BuildPrompt", tags: ["prompt", "nlp"] }
);

// CONTEXT 
const resolveContextFromHistory = traceable(
  async (question, chatHistory) => {
    if (!chatHistory?.length) return question;

    // Detect pronouns and type
    const singularPronouns = ["he", "him", "his", "she", "her", "hers"];
    const pluralPronouns   = ["they", "them", "their", "theirs"];

    const words = question.toLowerCase().split(/\s+/);
    const pronounType = words.some(w => singularPronouns.includes(w))
      ? "singular"
      : words.some(w => pluralPronouns.includes(w))
      ? "plural"
      : null;

    if (!pronounType) return question;
    console.log('Pronoun detected, analyzing recent history...');

    // Only check last 2 messages for performance
    const recentMessages = chatHistory.slice(-2);
    const validEmployeeNames = await getAllEmployeeNames();
    const foundNames = [];

    for (const message of recentMessages) {
      const content = message.content || '';

      // Try structured patterns first
      let regex = /([A-Z][a-z]+ [A-Z][a-z]+)(?:\s+is\s+a|\s+is\s+an|'s\s+Work|'s\s+Leaves|'s\s+Skills)/g;
      let matches = [...content.matchAll(regex)].map(m => m[1]);

      // Fallback to any capitalized names
      if (!matches.length) {
        regex = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g;
        matches = [...content.matchAll(regex)].map(m => m[1]);
      }

      // Filter to valid employees
      const validMatches = matches.filter(name => validEmployeeNames.has(name));
      foundNames.push(...validMatches);

      // Early exit if we found a name
      if (validMatches.length > 0) break;
    }

    if (foundNames.length > 0) {
      const uniqueNames = [...new Set(foundNames)];
       if (pronounType === "singular") {
        const latestName = uniqueNames[uniqueNames.length - 1];
        console.log(`Resolved singular pronoun to: ${latestName}`);
        return `${question} ${latestName}`;
      } else if (pronounType === "plural") {
        console.log(`Resolved plural pronoun to: ${uniqueNames.join(", ")}`);
        return `${question} ${uniqueNames.join(", ")}`;
      }
    }

    return question;
  },
  { name: "ResolveContextFromHistory", tags: ["context", "pronoun-resolution"] }
);

// CONTEXT BUILDER 

const buildContextStep = traceable(
  async (input) => {
    console.log(`Processing query: "${input.question}"`);

    const searchQuery = await resolveContextFromHistory(input.question, input.chat_history);

    try {
      const mergedRetriever = getMergedRetriever();
      const docs = await mergedRetriever.invoke(searchQuery);

      console.log(`Retrieved ${docs.length} documents`);

      const context = buildCustomContext(docs, input.question);
      return context.length > 0 ? context : "No relevant information found.";
    } catch (error) {
      console.error(`Error in context retrieval:`, error);

      // Fallback to individual retrievers
      let docs = [];
      for (const [name, retriever] of Object.entries(retrievers)) {
        try {
          const results = await retriever.invoke(searchQuery);
          const taggedDocs = results.map(d => ({
            ...d,
            _source: name,
            pageContent: truncateContent(d.pageContent, 300), 
          }));
          docs.push(...taggedDocs);
        } catch (err) {
          console.error(`Error in ${name}:`, err);
        }
      }

      const context = buildCustomContext(docs, input.question);
      return context.length > 0 ? context : "No relevant information found.";
    }
  },
  { name: "ContextStep", tags: ["context", "retrieval"] }
);

// SIMPLIFIED HISTORY PROCESSING 
const processHistoryStep = traceable(
  async (input) => {
    if (!input.chat_history?.length) return [];

    const history = input.chat_history;
    console.log(`Chat history length: ${history.length}`);

    // Use fixed window - simple and performant
    return history.slice(-HISTORY_WINDOW_SIZE);
  },
  { name: "HistoryProcessingStep", tags: ["history"] }
);

// CHAT PIPELINE 

export const initChatPipeline = traceable(
  async () => {
    if (!retrievers || !Object.keys(retrievers).length) {
      throw new Error("No retrievers available. Call initRetriever() first.");
    }

    const ragChain = RunnableSequence.from([
      {
        question: (input) => input.question,
        context: buildContextStep,
        chat_history: processHistoryStep
      },
      async (input) => {
        const prompt = await buildPromptForInput(input);
        return prompt.invoke(input);
      },
      llm,
      new StringOutputParser()
    ]);

    const chainWithHistory = new RunnableWithMessageHistory({
      runnable: ragChain,
      getMessageHistory: getMessageHistoryForSession,
      inputMessagesKey: "question",
      historyMessagesKey: "chat_history"
    });

    return {
      invoke: traceable(
        async (input) => {
          const { question, sessionId } = input;

          if (!sessionId) throw new Error("Session ID is required");

          console.log(`\n=== Invoking chain for session: ${sessionId} ===`);
          console.log(`Question: ${question}`);

          const response = await chainWithHistory.invoke(
            { question },
            { configurable: { sessionId } }
          );

          console.log(`Response generated successfully`);

          // Save to history
          const chatHistory = await getMessageHistoryForSession(sessionId);

          if (typeof response === "string") {
            await chatHistory.addAIChatMessage(response);
          } else if (response?.text) {
            await chatHistory.addAIChatMessage(response.text);
          } else {
            console.warn("Unexpected response format:", response);
          }

          return sanitizeResponse(response);
        },
        { name: "ChatPipelineInvoke", tags: ["main", "pipeline"] }
      )
    };
  },
  { name: "InitChatPipeline", tags: ["initialization", "pipeline"] }
);