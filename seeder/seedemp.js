import pool from "../db.js";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// Initialize AI
const ai = new GoogleGenAI({
  apiKey: "AIzaSyCd-38504I4o1sgbapCYyS62gu-IdnvTD8",
});

// Generate embedding from text
async function generateEmbedding(text) {
  try {
    const response = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: text,
    });

    if (response.embeddings && response.embeddings[0].values) {
      return response.embeddings[0].values;
    }
    return [];
  } catch (error) {
    console.error("Gemini API error:", error);
    return [];
  }
}

// Seed function
async function seedEmployees() {
  try {
    // Delete existing rows
    await pool.query(`DELETE FROM employees`);

    // const employees = [
    //   { name: "Alice", role: "Frontend Developer", department: "IT", skills: ["React", "JavaScript"] },
    //   { name: "Bob", role: "Backend Developer", department: "IT", skills: ["Node.js", "PostgreSQL"] },
    //   { name: "Charlie", role: "HR Manager", department: "HR", skills: ["Recruitment", "Payroll"] },
    //   { name: "Nisha", role: "HR Manager", department: "HR", skills: ["Recruitment", "Payroll"] }
    // ];
    const employees = [
      { name: "Alice Johnson", role: "Frontend Developer", department: "IT", skills: ["React", "JavaScript"], phone: "9876543210", aadhar: "1234-5678-9012", pan: "ABCDE1234F" },
      { name: "Bob Smith", role: "Backend Developer", department: "IT", skills: ["Node.js", "PostgreSQL"], phone: "9123456780", aadhar: "2345-6789-0123", pan: "PQRSX5678L" },
      { name: "Charlie Brown", role: "HR Manager", department: "HR", skills: ["Recruitment", "Payroll"], phone: "9988776655", aadhar: "3456-7890-1234", pan: "LMNOP9876Q" },
      { name: "Nisha Patel", role: "HR Executive", department: "HR", skills: ["Onboarding", "Employee Engagement"], phone: "9876501234", aadhar: "4567-8901-2345", pan: "XYZAB4321T" },
      { name: "Rahul Verma", role: "UI/UX Designer", department: "Design", skills: ["Figma", "Adobe XD"], phone: "9012345678", aadhar: "5678-9012-3456", pan: "QWERT1234Z" },
      { name: "Sneha Gupta", role: "Software Tester", department: "QA", skills: ["Selenium", "Jest"], phone: "9823456712", aadhar: "6789-0123-4567", pan: "TESTX9876M" },
      { name: "Arjun Reddy", role: "DevOps Engineer", department: "IT", skills: ["AWS", "Docker"], phone: "9123987654", aadhar: "7890-1234-5678", pan: "DEVOP1234K" },
      { name: "Meena Kumari", role: "Finance Manager", department: "Finance", skills: ["Tally", "Excel"], phone: "9234567810", aadhar: "8901-2345-6789", pan: "FINAC6789J" },
      { name: "Vikram Singh", role: "Data Analyst", department: "Analytics", skills: ["Python", "PowerBI"], phone: "9345678912", aadhar: "9012-3456-7890", pan: "ANLYS3456P" },
      { name: "Priya Sharma", role: "Content Writer", department: "Marketing", skills: ["SEO", "Copywriting"], phone: "9456789123", aadhar: "1234-9012-5678", pan: "CNTWR9876C" },

      { name: "Rohan Mehta", role: "Project Manager", department: "IT", skills: ["Agile", "Scrum"], phone: "9567891234", aadhar: "2345-0123-6789", pan: "PMGRS3456A" },
      { name: "Divya Iyer", role: "Graphic Designer", department: "Design", skills: ["Photoshop", "Illustrator"], phone: "9678912345", aadhar: "3456-1234-7890", pan: "GRDSN2345H" },
      { name: "Kunal Das", role: "Business Analyst", department: "Analytics", skills: ["Excel", "SQL"], phone: "9789123456", aadhar: "4567-2345-8901", pan: "BSANA6789N" },
      { name: "Ananya Rao", role: "Frontend Developer", department: "IT", skills: ["Angular", "TypeScript"], phone: "9891234567", aadhar: "5678-3456-9012", pan: "FRDEV4321M" },
      { name: "Mohit Jain", role: "Backend Developer", department: "IT", skills: ["Java", "Spring Boot"], phone: "9901234567", aadhar: "6789-4567-0123", pan: "BKDEV8765R" },
      { name: "Sakshi Nair", role: "HR Recruiter", department: "HR", skills: ["Talent Acquisition", "Screening"], phone: "9812345670", aadhar: "7890-5678-1234", pan: "HRREC5432L" },
      { name: "Aditya Sharma", role: "Cloud Engineer", department: "IT", skills: ["Azure", "Kubernetes"], phone: "9923456701", aadhar: "8901-6789-2345", pan: "CLDNG1234O" },
      { name: "Ritika Malhotra", role: "Accountant", department: "Finance", skills: ["GST", "Tally"], phone: "9834567012", aadhar: "9012-7890-3456", pan: "ACCTN6789I" },
      { name: "Suresh Raina", role: "Data Scientist", department: "Analytics", skills: ["Machine Learning", "TensorFlow"], phone: "9945670123", aadhar: "1234-8901-4567", pan: "DTSCI3456E" },
      { name: "Pooja Agarwal", role: "Digital Marketer", department: "Marketing", skills: ["Google Ads", "Facebook Ads"], phone: "9956701234", aadhar: "2345-9012-5678", pan: "DGMRK9876B" },

      { name: "Harsh Vardhan", role: "Full Stack Developer", department: "IT", skills: ["React", "Node.js"], phone: "9967812345", aadhar: "3456-0123-6789", pan: "FSTCK2345T" },
      { name: "Swati Kapoor", role: "HR Assistant", department: "HR", skills: ["Documentation", "Payroll"], phone: "9978912346", aadhar: "4567-1234-7890", pan: "HRASS8765G" },
      { name: "Yash Singh", role: "Network Engineer", department: "IT", skills: ["Cisco", "Firewall"], phone: "9989123456", aadhar: "5678-2345-8901", pan: "NETWR4567P" },
      { name: "Tanya Joshi", role: "Product Manager", department: "Operations", skills: ["Agile", "Roadmaps"], phone: "9991234567", aadhar: "6789-3456-9012", pan: "PDMNG2345W" },
      { name: "Aman Khan", role: "Cyber Security Analyst", department: "IT", skills: ["Penetration Testing", "SIEM"], phone: "9812345678", aadhar: "7890-4567-0123", pan: "CYSEC8765J" },
      { name: "Neha Yadav", role: "Legal Advisor", department: "Legal", skills: ["Contracts", "Compliance"], phone: "9823456789", aadhar: "8901-5678-1234", pan: "LEGAL5432F" },
      { name: "Ravi Kumar", role: "Database Admin", department: "IT", skills: ["MySQL", "MongoDB"], phone: "9834567890", aadhar: "9012-6789-2345", pan: "DBADM6789Y" },
      { name: "Simran Kaur", role: "Operations Manager", department: "Operations", skills: ["Logistics", "Team Management"], phone: "9845678901", aadhar: "1234-7890-3456", pan: "OPMNG3456H" },
      { name: "Manish Tiwari", role: "Mobile App Developer", department: "IT", skills: ["Flutter", "React Native"], phone: "9856789012", aadhar: "2345-8901-4567", pan: "MOBAP9876V" },
      { name: "Kavya Sen", role: "Event Coordinator", department: "Marketing", skills: ["Event Planning", "Negotiation"], phone: "9867890123", aadhar: "3456-9012-5678", pan: "EVNTC5432Q" },

      { name: "Deepak Malhotra", role: "Frontend Developer", department: "IT", skills: ["Vue.js", "JavaScript"], phone: "9878901234", aadhar: "4567-0123-6789", pan: "FRNTD8765X" },
      { name: "Shreya Ghosh", role: "Research Analyst", department: "Analytics", skills: ["R", "Statistics"], phone: "9889012345", aadhar: "5678-1234-7890", pan: "RSRCH2345N" },
      { name: "Karan Oberoi", role: "System Admin", department: "IT", skills: ["Linux", "Windows Server"], phone: "9890123456", aadhar: "6789-2345-8901", pan: "SYSAD6789K" },
      { name: "Pallavi Mishra", role: "Operations Executive", department: "Operations", skills: ["Inventory", "Scheduling"], phone: "9901234568", aadhar: "7890-3456-9012", pan: "OPEXE1234R" },
      { name: "Aditi Chauhan", role: "Finance Analyst", department: "Finance", skills: ["Budgeting", "Auditing"], phone: "9912345678", aadhar: "8901-4567-0123", pan: "FINAN6789B" },
      { name: "Varun Joshi", role: "AI Engineer", department: "IT", skills: ["NLP", "Deep Learning"], phone: "9923456789", aadhar: "9012-5678-1234", pan: "AIENG3456J" },
      { name: "Rupal Desai", role: "Recruitment Specialist", department: "HR", skills: ["Hiring", "Interviews"], phone: "9934567890", aadhar: "1234-6789-2345", pan: "RCRSP6789U" },
      { name: "Sandeep Roy", role: "IT Support", department: "IT", skills: ["Troubleshooting", "Hardware"], phone: "9945678901", aadhar: "2345-7890-3456", pan: "ITSUP1234S" },
      { name: "Monica Fernandes", role: "Content Strategist", department: "Marketing", skills: ["Content Planning", "Branding"], phone: "9956789012", aadhar: "3456-8901-4567", pan: "CNTST4321L" },
      { name: "Rajeev Saxena", role: "Senior Accountant", department: "Finance", skills: ["Taxation", "Auditing"], phone: "9967890123", aadhar: "4567-9012-5678", pan: "SNACC8765M" },

      { name: "Ishita Kapoor", role: "Frontend Developer", department: "IT", skills: ["React", "Redux"], phone: "9978901234", aadhar: "5678-0123-6789", pan: "FRDEV2345F" },
      { name: "Parth Sharma", role: "Backend Developer", department: "IT", skills: ["PHP", "Laravel"], phone: "9989012345", aadhar: "6789-1234-7890", pan: "BKDEV6789H" },
      { name: "Zoya Ansari", role: "HR Specialist", department: "HR", skills: ["Policy Making", "Employee Welfare"], phone: "9990123456", aadhar: "7890-2345-8901", pan: "HRSPL4321N" },
      { name: "Kabir Malhotra", role: "Cloud Architect", department: "IT", skills: ["AWS", "GCP"], phone: "9812345098", aadhar: "8901-3456-9012", pan: "CLDARCH5678O" },
      { name: "Ritika Sharma", role: "Finance Executive", department: "Finance", skills: ["Billing", "Accounts"], phone: "9823456199", aadhar: "9012-4567-0123", pan: "FINEX1234K" },
      { name: "Aryan Khanna", role: "Software Engineer", department: "IT", skills: ["C++", "Java"], phone: "9834567290", aadhar: "1234-5678-9013", pan: "SWENG5678R" },
      { name: "Mira D'Souza", role: "PR Manager", department: "Marketing", skills: ["Public Relations", "Media"], phone: "9845678391", aadhar: "2345-6789-0124", pan: "PRMNG2345E" },
      { name: "Sahil Bhatia", role: "Automation Engineer", department: "QA", skills: ["Cypress", "TestNG"], phone: "9856789492", aadhar: "3456-7890-1235", pan: "AUTOE6789C" },
      { name: "Gayatri Pillai", role: "Office Admin", department: "Operations", skills: ["Scheduling", "Coordination"], phone: "9867890593", aadhar: "4567-8901-2346", pan: "OADM1234D" },
      { name: "Rohit Kulkarni", role: "Research Scientist", department: "R&D", skills: ["AI", "Robotics"], phone: "9878901694", aadhar: "5678-9012-3458", pan: "RDSCI9876V" }
    ];


    for (const emp of employees) {
      const text = `${emp.name}, ${emp.role}, ${emp.department}, skills: ${emp.skills.join(", ")}`;
      const embedding = await generateEmbedding(text);


      const vectorLiteral = `[${embedding.join(",")}]`; // pgvector format

      await pool.query(
        `INSERT INTO employees (name, role, department, skills, phone_no, aadhaar_no, pan_no, embedding) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          emp.name,
          emp.role,
          emp.department,
          emp.skills,
          emp.phone,
          emp.aadhar.replace(/-/g, ""), 
          emp.pan,
          vectorLiteral
        ]
      );
      console.log(`Inserted ${emp.name}`);
    }

    console.log("Employees seeded with embeddings!");
    process.exit(0);
  } catch (err) {
    console.error("Error seeding employees:", err);
    process.exit(1);
  }
}

seedEmployees();
