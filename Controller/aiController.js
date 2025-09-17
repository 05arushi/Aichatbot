// chatController.js
import { getRagChain } from "../app.js";

export const askAI = async (req, res) => {
  try {
    const { question, sessionId } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    // Get the initialized RAG chain
    const ragChain = getRagChain();
    if (!ragChain) {
      return res.status(503).json({ 
        error: "Service not ready", 
        message: "RAG chain is still initializing" 
      });
    }

    console.log(`Processing question for session ${sessionId}: "${question}"`);

    // Invoke the RAG chain with question and sessionId
    // The BufferMemory is handled internally by the ragChain
    const answer = await ragChain.invoke({
      question,
      sessionId
    });

    console.log("Generated answer:", answer);
    
    res.json({ 
      answer,
      sessionId,
      message: "Response generated successfully"
    });

  } catch (err) {
    console.error("LangChain error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message
    });
  }
};