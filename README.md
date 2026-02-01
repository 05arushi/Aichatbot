# AI Assistant - PostgreSQL RAG System

An intelligent HR AI chatbot that uses Retrieval-Augmented Generation (RAG) with natural language processing to answer employee and HR-related queries. The system combines LangChain, PostgreSQL, Google Generative AI, and NLP capabilities to provide accurate, context-aware responses.

## 🎯 Features

- **RAG Pipeline**: Retrieval-Augmented Generation for accurate, context-based responses
- **Natural Language Understanding**: NLP-powered intent detection and entity extraction
- **HR Knowledge Base**: Specialized support for employee queries including:
  - Employee information and details
  - Work reports and daily tasks
  - Leave management and tracking
  - Department and role information
  - Skill-based filtering
- **Smart Filtering**: Filter employees by name patterns, date ranges, and various criteria
- **Session Management**: Support for multi-turn conversations with session tracking
- **Google Gemini Integration**: Powered by Gemini 2.0 Flash LLM with text-embedding-004
- **PostgreSQL Backend**: Persistent data storage with efficient querying

## 📋 Project Structure

```
├── app.js                          # Express server and app initialization
├── db.js                          # PostgreSQL connection pool
├── initDb.js                      # Database initialization script
├── package.json                   # Project dependencies
├── model.nlp                      # NLP model file
├── Controller/
│   └── aiController.js            # Request handler for AI queries
├── models/
│   ├── employeemodel.js           # Employee data model
│   ├── empLeaves.js               # Employee leaves model
│   └── empDailyReport.js          # Daily work reports model
├── routes/
│   └── aiRoutes.js                # API route definitions
├── services/
│   ├── chat.js                    # Chat pipeline and RAG chain setup
│   ├── contextBuilder.js          # Context building and response formatting
│   ├── llm.js                     # LLM and embeddings configuration
│   └── retriver.js                # Document retrieval and intent handling
└── seeder/
    ├── seedemp.js                 # Employee data seeder
    ├── seedempleaves.js           # Leave data seeder
    └── seedempdailyreport.js      # Daily report data seeder
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v16 or higher)
- PostgreSQL (v12 or higher)
- Google Generative AI API key
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd psqldatabase
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the root directory:
   ```
   PORT=5000
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=your_password
   DB_NAME=your_database_name
   GEMINI_API_KEY=your_gemini_api_key
   ```

4. **Initialize the database**
   ```bash
   npm run init-db
   ```

5. **Seed sample data (optional)**
   ```bash
   npm run seed
   ```

6. **Start the server**
   ```bash
   npm start
   ```

The server will start on `http://localhost:5000` (or the port specified in `.env`)

## 📚 API Reference

### Health Check
- **Endpoint**: `GET /`
- **Response**:
  ```json
  {
    "message": "PostgreSQL RAG Server is running!",
    "status": "ready|initializing"
  }
  ```

### Ask AI
- **Endpoint**: `POST /api/askai`
- **Request Body**:
  ```json
  {
    "question": "What are John's latest work reports?",
    "sessionId": "session_12345"
  }
  ```
- **Response**:
  ```json
  {
    "answer": "John's Work Reports:\n* 2024-11-30:\n- Task 1 (8 hours, completed)\n...",
    "sessionId": "session_12345",
    "message": "Response generated successfully"
  }
  ```

## 🤖 Supported Query Types

### Employee Information
- "List all employees"
- "Show me all users"
- "Display employee details"

### Work Reports
- "Show me John's latest work report"
- "What did John do yesterday?"
- "Give me the last 3 reports of John"
- "Latest work of John"

### Name Filtering
- "List names starting with A"
- "List names ending with N"
- "Show employees whose names start with A and end with N"

### Statistics
- "Total employees"
- "How many employees are there?"
- "Total leaves"
- "Number of leaves"

### Leave Management
- "How many leaves does John have?"
- "Show leave details for John"

## 🔧 Key Services

### Chat Service (`services/chat.js`)
Initializes and manages the RAG chain pipeline, combining retrieval with LLM-based answer generation.

### Context Builder (`services/contextBuilder.js`)
- Validates if questions are HR-related
- Filters and organizes retrieved documents
- Removes Personally Identifiable Information (PII)
- Formats context for LLM consumption

### Retriever (`services/retriver.js`)
- Initializes NLP manager with trained intents
- Handles various query types through intent detection
- Provides fallback similarity-based search
- Manages date range extraction from natural language

### LLM Service (`services/llm.js`)
- Configures Google Generative AI (Gemini 2.0 Flash)
- Sets up text embeddings (text-embedding-004)
- Handles API key management

## 📊 Database Schema

### Tables
- **employees**: Core employee information
  - id, name, email, role, department, skills, phone, etc.

- **empdailyreports**: Daily work reports
  - id, employee_id, tasks (JSON), date, status

- **empleaves**: Leave records
  - id, employee_id, leave_type, start_date, end_date, status

## 🔐 Security Features

- **PII Protection**: Automatically removes sensitive data (phone, Aadhaar, PAN, IDs) from responses
- **Session Validation**: Requires session ID for all requests
- **Input Validation**: Validates required fields before processing
- **Service Status Check**: Ensures RAG chain is ready before processing queries

## 🧠 NLP & Intent Recognition

The system uses `node-nlp` with named entity recognition (NER) for:
- **Entity Extraction**: Employee names, dates, letters, numbers
- **Intent Classification**: 
  - `WorkReport`: Daily work reports and tasks
  - `filterNamesByLetter`: Name-based filtering
  - `employeeCount`: Employee statistics
  - `leavesCount`: Leave statistics
  - `allusers`: List all employees

## 📝 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 5000) |
| `DB_HOST` | PostgreSQL host | Yes |
| `DB_PORT` | PostgreSQL port | Yes |
| `DB_USER` | PostgreSQL username | Yes |
| `DB_PASSWORD` | PostgreSQL password | Yes |
| `DB_NAME` | PostgreSQL database name | Yes |
| `GEMINI_API_KEY` | Google Generative AI API key | Yes |

## 🛠️ Development

### Running Tests
```bash
npm test
```

### Code Structure Guidelines
- Controllers handle HTTP requests
- Services contain business logic
- Models define data structures
- Routes define API endpoints
- Seeders populate test data

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## 📄 License

ISC

## 👥 Author

Created as part of the AI Virtual Assistant project

## 🐛 Troubleshooting

### RAG Chain Not Initializing
- Ensure PostgreSQL is running and accessible
- Verify GEMINI_API_KEY is set correctly
- Check database connection parameters in `.env`

### No Results Found
- Verify sample data has been seeded
- Check that database tables exist with correct schema
- Review console logs for intent detection details

### Service Not Ready Error
- Wait for initial server startup to complete
- Check that retrievers are initialized successfully
- Verify database connectivity

## 📚 Dependencies

Key packages used:
- **Express.js**: Web framework
- **LangChain**: RAG pipeline framework
- **PostgreSQL (pg)**: Database driver
- **Google Generative AI**: LLM provider
- **node-nlp**: Natural Language Processing
- **dotenv**: Environment configuration
- **CORS**: Cross-origin resource sharing
- **moment**: Date/time handling
- **chrono-node**: Natural language date parsing

---

For more information or issues, please contact the development team.
