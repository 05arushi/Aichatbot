import pool from "../db.js";

export const addMessagePair = async (sessionId, userMessage, assistantMessage) => {
  try {
    const query = `
    INSERT INTO chat_history (session_id, messages, created_at, updated_at)
      VALUES (
        $1,
        jsonb_build_array($2::jsonb, $3::jsonb),
        NOW(),
        NOW()
      )
      ON CONFLICT (session_id) DO UPDATE SET
        messages = (
          CASE
            WHEN jsonb_array_length(chat_history.messages) >= 15 THEN
              chat_history.messages - 0 - 1 || $2::jsonb || $3::jsonb
            ELSE
              chat_history.messages || $2::jsonb || $3::jsonb
          END
        ),
        updated_at = NOW()
  `;

    const userMsgObj = JSON.stringify({ user: userMessage });
    const assistantMsgObj = JSON.stringify({ assistant: assistantMessage });

    await pool.query(query, [sessionId, userMsgObj, assistantMsgObj]);
  } catch (error) {
    console.error("Error saving chat message:", error);
    throw error;
  }
};

export const getAllHistory = async () => {
  try {
    const query = `
    SELECT 
      session_id,
      (messages[0]->>'user') AS first_user_message,
      COUNT(session_id) AS chat_count
    FROM chat_history
    GROUP BY session_id
    ORDER BY MAX(created_at) DESC;
    `;
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error("Error fetching chat history:", error);
    throw error;
  }
}

export const getMessagesBySession = async (sessionId) => {
  try {
    const query = ` 
    SELECT messages
    FROM chat_history
    WHERE session_id = $1;
    `;
    const result = await pool.query(query, [sessionId]);
    if (result.rows.length === 0) {
      return [];
    }   
    return result.rows[0];
  }
  catch (error) {
    console.error("Error fetching messages for session:", error);
    throw error;
  } 
}

export const deletesession = async(sessionId) => {
  try{
    const query = `
    DELETE FROM chat_history
    WHERE session_id = $1;
    `;
    await pool.query(query,[sessionId]);
  }
  catch(err){
    console.error("Error deleting session messages:", err);
    throw err;
  }
}