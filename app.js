// app.js
import 'dotenv/config';
import express from "express";
import cors from "cors";
import pool from "./db.js";
import { initRetriever } from "./services/retriver.js";
import { initChatPipeline } from "./services/chat.js";
import aiRoutes from "./routes/aiRoutes.js";

const app = express();
app.use(cors());
app.use(express.json());

// Store the initialized RAG chain globally
let ragChain = null;

// Export function to get the RAG chain 
export const getRagChain = () => ragChain;

const testDBConnection = async () => {
  try {
    const client = await pool.connect();
    console.log("PostgreSQL connected successfully");
    client.release();
    return true;
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
    throw error;
  }
};

app.use("/api", aiRoutes);
app.get("/", (req, res) => {
  res.json({ 
    message: "PostgreSQL RAG Server is running!",
    status: ragChain ? "ready" : "initializing"
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    console.log("Starting PostgreSQL RAG Server...");
    
    await testDBConnection();
    //to stabilize the connection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    //Initialize retrievers 
     initRetriever()
      .then(() => initChatPipeline())
      .then(chain => {
        ragChain = chain;
        console.log("RAG chain initialized");
      })
      .catch(err => console.error("Failed to initialize RAG chain:", err));;
    
    app.listen(PORT, () => {
      console.log(` Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();