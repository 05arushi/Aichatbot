// chatController.js
import { getRagChain } from "../app.js";
import { addMessagePair,getAllHistory,getMessagesBySession,deletesession } from "../services/chatDatabase.js";

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
    try {
      await addMessagePair(sessionId, question, answer);
      console.log("Message pair saved successfully");
    } catch (dbError) {
      console.error("Failed to save message pair:", dbError);
    }
    
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

export const getHistory = async (req, res) => {
  try {
    const history = await getAllHistory();  
    res.json({ history });
  } catch (err) {
    console.error("Error fetching chat history:", err);
    res.status(500).json({      
      error: "Internal Server Error",
      message: err.message
    });
  } 
};

export const getSessionMessages = async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    } 
    const messages = await getMessagesBySession(sessionId);
    res.json({ sessionId, messages });
  } catch (err) {
    console.error("Error fetching session messages:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message
    });
  }
};

export const deleteSessionMessages = async (req, res) => {
  try{
    const {sessionId} = req.query;
    if(!sessionId){
      return res.status(400).json({error:"Session ID is required"});
    }
    await deletesession(sessionId);
    res.json({
      state:true,
      message:`Session ${sessionId} messages deleted successfully`
    });
  }catch(err){
    console.error("Error deleting session messages:", err);
    res.status(500).json({
      state: false,
      message: err.message
    });
  }
};