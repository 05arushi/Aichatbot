import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

const apiKey = process.env.GEMINI_API_KEY;
export const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  apiKey,
});

export const embeddings = new GoogleGenerativeAIEmbeddings({
  // model: "models/gemini-embedding-001",
  model: "text-embedding-004",
  apiKey,
});

// import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";

// const geminiApiKey = process.env.GEMINI_API_KEY;
// const voyageApiKey = process.env.VOYAGE_API_KEY;
// console.log("gemini api key ",geminiApiKey,"and voyage api key:",voyageApiKey);

// // Keep Gemini LLM for chat
// export const llm = new ChatGoogleGenerativeAI({
//   model: "gemini-2.0-flash",
//   apiKey: geminiApiKey,
// });

// // Replace Gemini embeddings with Voyage
// export const embeddings = new VoyageEmbeddings({
//   apiKey: voyageApiKey,
//   modelName: "voyage-2",
// });
