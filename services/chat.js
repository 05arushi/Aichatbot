// chat.js - Optimized version
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { llm } from "./llm.js";
import { retrievers, getMergedRetriever, nlpManager } from "./retriver.js";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { buildCustomContext, sanitizeResponse } from "./contextBuilder.js";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { HumanMessage } from "@langchain/core/messages";
import { loadSummarizationChain } from "langchain/chains";
import pool from "../db.js";
import { NodeCache } from '@cacheable/node-cache';
import { getMessagesBySession } from "./chatDatabase.js";

// ========== CACHE & STORAGE ==========
const employeeNameCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const contextCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });   // 5 min
const intentCache = new NodeCache({ stdTTL: 1800, checkperiod: 120 }); // 30 min
const MAX_HISTORY_LENGTH = 6;
const SUMMARIZE_THRESHOLD = 8;
const messageHistories = {};

export const getAllEmployeeNames = async () => {
  const cached = employeeNameCache.get('employeeNames');
  if (cached) return cached;

  const res = await pool.query("SELECT name FROM employees");
  const names = new Set(res.rows.map(r => r.name));
  employeeNameCache.set('employeeNames', names);
  return names;
};

// ========== MESSAGE HISTORY ==========
async function getMessageHistoryForSession(sessionId) {
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
}

async function summarizeChatHistory(messages) {
  if (!messages?.length) return "";

  const docs = messages.map(m => ({ pageContent: m.content, metadata: {} }));
  const summarizationChain = loadSummarizationChain(llm, { type: "map_reduce" });
  const summary = await summarizationChain.invoke({ input_documents: docs });

  return summary;
}

// ========== PROMPTS ==========
const PROMPTS = {
  base: `You are a concise HR assistant. Follow these core rules:
- Answer ONLY about the subject asked.
- Exclude unrelated names, dates, departments, or records.

FOR CONTEXTUAL QUESTIONS (like "give his daily report"):
- Use chat history to identify who "his/her/their" refers to
- Show requested information for that person
- Always include the person's name in response
- Example: "Bob's Work Reports:" followed by reports

NEVER include:
- Employee IDs or numbers
- Personal contact details
- Salary information
- Long explanations

CRITICAL RULES:
- For "who is [Name]": START with basic employee info (name, role, department, skills)
- Handle pronouns by referencing previously mentioned person
- If specific person asked: show ONLY that person's information
- If no info found: "No information found for [Name]"
- For greetings: "I'm doing well, ask me any office query!"
- If unclear question: "I didn't understand. Could you please check your query?"

FORMATTING:
- Keep all markdown formatting intact
- Return formatted data exactly as structured`,

  whoIs: `FOR "WHO IS" QUESTIONS:
- Give ONLY: Name is [Role] in [Department] with skills in [Skills].
- Example: "Bob is a Backend Developer in IT with skills in Node.js."`,

  allusers: `FOR "LIST ALL USERS" QUESTIONS:
- Show table of ALL employees with full details
- Do not exclude anyone unless filter mentioned`,

  summary: `FOR SUMMARY QUESTIONS:
- Provide concise 3-4 line summary without bullet points
- Plain paragraph format
- Example: "We have 12 employees across 3 departments..."`,

  workReport: `FOR WORK REPORT QUESTIONS:
- Focus ONLY on specific employee
- If no work found: "No work report of [Name] was found for [timeframe]."
- Always mention employee name before listing reports
- Group reports by date
Example:
  2025-09-03:
    - Setup project repo (3 hours, Completed)`,

  leaves: `FOR LEAVE QUESTIONS:
- If no leave found: "No, [Name] was not on leave [timeframe]."
- Always mention employee name before listing leaves
- Group by leave type
Example:
Sick Leave:
  - 2025-09-02: Fever (Approved)`,

  other: `FOR OTHER QUESTIONS:
- Be concise and specific
- Only answer what is asked
- For greetings, respond warmly`
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

async function buildPromptForInput(input) {
  const nlpRes = await nlpManager.process("en", input.question);
  const intent = nlpRes.intent || "default";

  const promptSections = INTENT_PROMPT_MAP[intent] || INTENT_PROMPT_MAP.default;
  const systemMessage = promptSections.join("\n");

  return ChatPromptTemplate.fromMessages([
    ["system", systemMessage],
    new MessagesPlaceholder("chat_history"),
    ["human", `Question: {question}\nContext: {context}\n\nProvide a concise answer based on the context.`]
  ]);
}

// ========== CONTEXT RESOLUTION ==========
async function resolveContextFromHistory(question, chatHistory) {
  const pluralPronouns = /\b(they|them|their)\b/i.test(question);
  const singularPronouns = /\b(he|his|him|she|her)\b/i.test(question);

  if (!(pluralPronouns || singularPronouns) || !chatHistory?.length) {
    return question;
  }

  console.log('Pronoun detected, analyzing chat history...');
  const recentMessages = chatHistory.slice(-4).reverse();
  const validEmployeeNames = await getAllEmployeeNames();
  const personMentioned = [];

  for (const message of recentMessages) {
    const content = message.content || '';
    let regex = /([A-Z][a-z]+ [A-Z][a-z]+)(?:\s+is\s+a|\s+is\s+an|'s\s+Work|'s\s+Leaves|'s\s+Skills)/g;
    let nameMatch = [...content.matchAll(regex)].map(m => m[1]);

    if (!nameMatch.length) {
      regex = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g;
      nameMatch = [...content.matchAll(regex)].map(m => m[1]);
    }

    if (nameMatch.length) {
      nameMatch = nameMatch.filter(name => validEmployeeNames.has(name));
      personMentioned.push(...nameMatch);
    }
  }

  if (personMentioned.length) {
    const uniquePersons = [...new Set(personMentioned)];
    if (pluralPronouns) {
      console.log(`Plural pronoun → refers to:`, uniquePersons);
      return `${question} ${uniquePersons.join(' ')}`;
    } else if (singularPronouns) {
      const latestPerson = uniquePersons[uniquePersons.length - 1];
      console.log(`Singular pronoun → refers to: ${latestPerson}`);
      return `${question} ${latestPerson}`;
    }
  }

  return question;
}

// ========== CHAT PIPELINE ==========
export const initChatPipeline = async () => {
  if (!retrievers || !Object.keys(retrievers).length) {
    throw new Error("No retrievers available. Call initRetriever() first.");
  }

  const ragChain = RunnableSequence.from([
    {
      question: (input) => input.question,
      context: async (input) => {
        console.log(`Processing: "${input.question}"`);

        if (input.handleIntentResult && input.handleIntentResult.length > 0) {
          console.log("Using handleIntentResult, skipping retriever search");
          return buildCustomContext(input.handleIntentResult, input.question);
        }

        const searchQuery = await resolveContextFromHistory(input.question, input.chat_history);
        let docs = [];


        try {
          const mergedRetriever = getMergedRetriever();
          const retrieverDocs = await mergedRetriever.invoke(searchQuery, { k: 5 });
          console.log(`Found ${retrieverDocs.length} documents across all tables`);
          docs.push(...retrieverDocs);
        } catch (error) {
          console.error(`Error searching PostgreSQL:`, error);

          // Fallback to individual retrievers
          for (const [name, retriever] of Object.entries(retrievers)) {
            try {
              const results = await retriever.invoke(searchQuery);
              docs.push(...results.map(d => ({ ...d, _source: name })));
            } catch (err) {
              console.error(`Error in ${name}:`, err);
            }
          }
        }

        const context = buildCustomContext(docs, input.question);
        return context.length > 0 ? context : "No relevant information found.";
      },
      chat_history: async (input) => {
        if (!input.chat_history?.length) return [];

        const history = input.chat_history;
        console.log(`Chat history length: ${history.length}`);

        if (history.length <= 4) {
          return history;
        } else if (history.length <= SUMMARIZE_THRESHOLD) {
          return history.slice(-MAX_HISTORY_LENGTH); // keep only last few
        } else {
          const messagesToSummarize = history.slice(0, -3);
          const recentMessages = history.slice(-3);

          const summaryKey = `summary:${input.sessionId}`;
          let summary = contextCache.get(summaryKey);

          if (!summary) {
            summary = await summarizeChatHistory(messagesToSummarize, input.sessionId);
            contextCache.set(summaryKey, summary);
          }

          return [
            new HumanMessage({ content: `Previous: ${summary}` }),
            ...recentMessages,
          ];
        }
      }
    },
    async (input) => await buildPromptForInput(input),
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
    invoke: async (input) => {
      const { question, sessionId } = input;

      if (!sessionId) throw new Error("Session ID is required");

      console.log(`Invoking chain for session: ${sessionId}`);

      const response = await chainWithHistory.invoke(
        { question },
        { configurable: { sessionId } }
      );

      console.log(`Raw response: ${response}`);

      const chatHistory = await getMessageHistoryForSession(sessionId);

      if (typeof response === "string") {
        await chatHistory.addAIChatMessage(response);
      } else if (response?.text) {
        await chatHistory.addAIChatMessage(response.text);
      } else {
        console.warn("Unexpected response format:", response);
      }

      return sanitizeResponse(response);
    }
  };
};