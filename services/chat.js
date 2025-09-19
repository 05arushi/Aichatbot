//chat.js
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { llm } from "./llm.js";
import { retrievers, getMergedRetriever } from "./retriver.js";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { buildCustomContext, sanitizeResponse } from "./contextBuilder.js";
import { MessagesPlaceholder } from "@langchain/core/prompts";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";

// Store message histories by session
const messageHistories = {};

function getMessageHistoryForSession(sessionId) {
  if (!messageHistories[sessionId]) {
    messageHistories[sessionId] = new ChatMessageHistory();
  }
  return messageHistories[sessionId];
}

// Build simplified RAG pipeline that returns an object with invoke method
export const initChatPipeline = async () => {
  if (!retrievers || Object.keys(retrievers).length === 0) {
    throw new Error("No retrievers available. Make sure initRetriever() was called successfully.");
  }

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a concise HR assistant. Follow these rules:
      - You must answer ONLY about the subject asked. Exclude any other names, dates, departments, or records not directly mentioned in the user question. Do not add summaries or extra information.
        + Answer ONLY about the subject asked. 
        + If the user asks about a **specific person**, show ONLY that person's information.  
        + If the user asks to **list all users / employees**, show ALL employees with their full details (name, role, department, skills).  
        + If the user asks for a **summary**, provide a concise 1–2 line summary in addition to the details if relevant.  

      FOR "WHO IS" QUESTIONS:
      - Give ONLY: Name is [Role] in [Department] with skills in [Skills]. 
      - Example: "Bob is a Backend Developer in the IT department with skills in Node.js and MongoDB."

      FOR "LIST ALL USERS" QUESTIONS:
      - Show a table of ALL employees with their full details (name, role, department, skills).
      - Do not exclude anyone unless a filter (like department) is mentioned.

      FOR SUMMARY QUESTIONS:
      - Provide a concise 1–2 line summary of the relevant employee(s) or data.
      - Example: "We have 12 employees across 3 departments, mainly skilled in development and management."
      
      FOR CONTEXTUAL QUESTIONS (like "give his daily report" after asking about someone):
      - Use the chat history to identify who "his/her/their" refers to
      - Show the requested information for that person
      - Always include the person's name in the response
      - Example: "Bob's Work Reports:" followed by the reports

      FOR WORK REPORT QUESTIONS:
      - Focus ONLY on the specific employee (from question or context)
      - If asking about specific date and no leave found: "No, work report of [Name] was found of date [timeframe]."
      - Always mention the employee name before listing their reports.
      - Group leaves by leave type.
      - Group reports by date.
      - Use the date as the main bullet point.
      - Show each task for that date as a sub-bullet.
      Example:
      * 2025-09-03:
        - Setup project repo (3 hours, Completed)
        - Environment setup (2 hours, Completed)

      FOR LEAVE QUESTIONS:
      - If asking about specific date and no leave found: "No, [Name] was not on leave [timeframe]."
      - Always mention the employee name before listing their leaves.
      - Group leaves by leave type.
      - Use the leave type as the main bullet point.
      - Show each leave entry (date, reason, status, etc.) as sub-bullets.
      Example:
      * Sick Leave:
        - 2025-09-02: Fever (Approved)
        - 2025-09-03: Rest (Pending)

      FOR OTHER QUESTIONS:
      - Be concise and specific
      - Only answer what is asked
      - If the question is a greeting or not about HR, respond warmly and conversationally.
      - Example: "How are you?" → "I'm here and happy to help!"

      NEVER include:
      - Employee IDs or numbers
      - Personal contact details
      - Salary information
      - Long explanations

      CRITICAL RULES:
      - When someone asks "who is [Name]", START with basic employee info (name, role, department, skills)
      - Handle pronouns (his/her/their) by referencing the previously mentioned person
      - If question asks about specific person, show ONLY that person's information
      - Do not include other employees' data
      - If no info found for specific person: "No information found for [Name]"
      - For greetings: "I’m doing well,ask me any office query I'm here and happy to help!"
      
      IF the question is unclear, incomplete, or does not mention any employee or subject I can identify:
      - Do NOT assume or invent a name
      - Respond: "I didn’t understand your question. Could you please check your query and ask again?"


      FORMATTING RULES:
      - Keep all markdown formatting intact (**bold**, bullet points, etc.)
      - Return formatted data exactly as structured in the context`
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", `Question: {question}\nContext: {context}\n\nProvide a concise answer based on the context.`],
  ]);

  const ragChain = RunnableSequence.from([
    {
      question: (input) => input.question,
      context: async (input) => {
        console.log(`Processing question: "${input.question}"`);
        console.log(`Chat history available:`, input.chat_history?.length || 0, 'messages');

        let docs = [];
        let searchQuery = input.question;

        // Enhanced context resolution: check if question has pronouns and needs context
        const pluralPronouns = /\b(they|them|their)\b/i.test(input.question);
        const singularPronouns = /\b(he|his|him|she|her)\b/i.test(input.question);
        console.log(`Pronoun check - Plural: ${pluralPronouns}, Singular: ${singularPronouns}`);
        if ((pluralPronouns || singularPronouns) && input.chat_history?.length > 0) {
          console.log('Pronoun detected, analyzing chat history for context...');

          const recentMessages = input.chat_history.slice(-4);
          let personMentioned = [];

          for (const message of recentMessages.reverse()) {
            const content = message.content || '';
            console.log(`Analyzing message: "${content}"`);
            let regex = /([A-Z][a-z]+ [A-Z][a-z]+)(?:\s+is\s+a|\s+is\s+an|'s\s+Work|'s\s+Leaves|'s\s+Skills)/g;
            // const regex = /([A-Z][a-z]+ [A-Z][a-z]+)(?:\s+is\s+a|\s+is\s+an|'s\s+Work|'s\s+Leaves)/g;
            let nameMatch = [...content.matchAll(regex)].map(m => m[1]);

            if (nameMatch.length === 0) {
              regex = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g;
              nameMatch = [...content.matchAll(regex)].map(m => m[1]);
            }

            if (nameMatch.length > 0) {
              console.log(`Names matched:`, nameMatch);
              personMentioned.push(...nameMatch);
            }
          }

          if (personMentioned.length > 0) {
            const uniquePersons = [...new Set(personMentioned)];
            if (pluralPronouns) {
              console.log(`Plural pronoun context -> refers to:`, uniquePersons);
              searchQuery = `${input.question} ${uniquePersons.join(' ')}`;
            } else if (singularPronouns) {
              const latestPerson = uniquePersons[uniquePersons.length - 1];
              console.log(`Singular pronoun context -> refers to: ${latestPerson}`);
              searchQuery = `${input.question} ${latestPerson}`;
            }
          }
        }

        try {
          // Search across all PostgreSQL tables with enhanced query
          const mergedRetriever = getMergedRetriever();
          docs = await mergedRetriever.invoke(searchQuery);
          console.log(`Found ${docs.length} total documents across all tables`);
        } catch (error) {
          console.error(`Error searching PostgreSQL tables:`, error);

          // Fallback: search individual retrievers if merged fails
          for (const [name, retriever] of Object.entries(retrievers)) {
            try {
              const results = await retriever.invoke(searchQuery);
              console.log(`Found ${results.length} results in ${name}`);

              docs = docs.concat(
                results.map((d) => ({
                  ...d,
                  _source: name,
                }))
              );
            } catch (error) {
              console.error(`Error searching ${name}:`, error);
            }
          }
        }

        // Build filtered context
        const context = buildCustomContext(docs, input.question);
        console.log(`Context built, length: ${context.length}`);

        return context.length > 0 ? context : "No relevant information found.";
      },
      chat_history: (input) => input.chat_history || [],
    },
    prompt,
    llm,
    new StringOutputParser(),
  ]);

  // Create chain with message history
  const chainWithHistory = new RunnableWithMessageHistory({
    runnable: ragChain,
    getMessageHistory: getMessageHistoryForSession,
    inputMessagesKey: "question",
    historyMessagesKey: "chat_history",
  });

  // Return an object with invoke method that handles memory per session
  return {
    invoke: async (input) => {
      const { question, sessionId } = input;

      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      console.log(`Invoking chain for session: ${sessionId}`);

      // Invoke the chain with proper config
      const response = await chainWithHistory.invoke(
        { question },
        { configurable: { sessionId } }
      );

      console.log(`Raw response: ${response}`);

      const chatHistory = getMessageHistoryForSession(sessionId);

      if (typeof response === "string") {
        await chatHistory.addAIChatMessage(response);
      } else if (response?.text) {
        await chatHistory.addAIChatMessage(response.text);
      } else {
        console.warn("Unexpected response format:", response);
      }
      // Return sanitized response
      return sanitizeResponse(response);
    }
  };
};