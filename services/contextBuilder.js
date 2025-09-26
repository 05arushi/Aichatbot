export const buildCustomContext = (docs, question) => {
  if (!docs || docs.length === 0) {
    return "No relevant information found.";
  }

  // Check if question is HR-related
  const hrKeywords = [
    'employee', 'staff', 'work', 'report', 'leave', 'vacation', 'sick', 'holiday',
    'department', 'role', 'position', 'job', 'salary', 'manager', 'team',
    'who is', 'working', 'absent', 'present', 'reports', 'leaves', 'skills',
    'hr', 'human resources', 'personnel', 'workforce', 'about', 'know', 'details', 'report',
    'daily', 'name', 'names', 'list', 'show', 'give me', 'starting', 'ending', 'user', 'users'
  ];

  const isHRQuestion = hrKeywords.some(keyword =>
    question.toLowerCase().includes(keyword.toLowerCase())
  );

  const namePatterns = [
    /names?\s+(starting|ending|begin|start|end)/i,
    /give\s+me.*name/i,
    /show.*name/i,
    /list.*name/i,
    /employees?\s+(whose|with|that)/i,
    /users?/i
  ];

  const isNameQuery = namePatterns.some(pattern => pattern.test(question));

  if (!isHRQuestion && !isNameQuery) {
    console.log(`Non-HR question detected: "${question}"`);
    return "This question is not related to HR or employee information.";
  }

  // if (!isHRQuestion) {
  //   console.log(`Non-HR question detected: "${question}"`);
  //   return "This question is not related to HR or employee information.";
  // }

  // Since employee filtering is already handled in retriever, skip filtering here

  const relevantDocs = docs.slice(0, 10);

  // Group documents by table
  const groupedDocs = {};
  relevantDocs.forEach(doc => {
    const source = doc._source || doc.metadata?._table || 'unknown';
    if (!groupedDocs[source]) {
      groupedDocs[source] = [];
    }
    groupedDocs[source].push(doc);
  });

  console.log(`Grouped documents by source:`, Object.keys(groupedDocs));

  // Build context with better organization
  let contextParts = [];

  for (const [source, sourceDocs] of Object.entries(groupedDocs)) {
    if (sourceDocs.length && sourceDocs.every(d => d.pageContent === undefined && typeof d.metadata === "object"))
      {
        // Dynamically build rows using all metadata keys except 'id'
        const rows = sourceDocs.map(d => {
          const row = {};
          Object.keys(d.metadata).forEach(k => {
            if (k.toLowerCase() !== 'id') {
              row[k] = d.metadata[k];
            }
          });
          return row;
        });
        contextParts.push(toMarkdownTable(rows)); // Now generic for all sources
        continue;
      }

      const sourceContext = sourceDocs.map(d => {
        // Exclude PII and system keys
        const safeMetadata = { ...d.metadata };
        delete safeMetadata.phone;
        delete safeMetadata.aadhaar;
        delete safeMetadata.pancard;
        delete safeMetadata.id;
        delete safeMetadata._table;
        delete safeMetadata._columns;
        delete safeMetadata._source;

        // Prioritize important keys
        const keysPriority = ["name", "employee_name", "role", "title", "department", "skills", "position"];
        const prioritized = keysPriority
          .filter(key => safeMetadata[key])
          .map(key => `${capitalize(key)}: ${safeMetadata[key]}`);

        const otherKeys = Object.keys(safeMetadata)
          .filter(key => !keysPriority.includes(key) && safeMetadata[key] != null)
          .map(key => `${capitalize(key)}: ${safeMetadata[key]}`);

        const metadataContent = [...prioritized, ...otherKeys].join(", ");

        // Use page content if available, otherwise use metadata
        if (d.pageContent && d.pageContent.trim()) {
          return d.pageContent;
        }

        return metadataContent;
      }).join("\n");

      if (sourceContext.trim()) {
        contextParts.push(`From ${source}:\n${sourceContext}`);
      }
    }

    console.log(`=== Final context length: ${contextParts.join("\n\n").length} ===`);
    return contextParts.join("\n\n");
  };

  function toMarkdownTable(rows) {
    if (!rows.length) return '';
    const keysRaw = Object.keys(rows[0]).filter(k => k.toLowerCase() !== 'id');
    const keys = keysRaw.map(capitalize);
    let header = `| ${keys.join(' | ')} |\n|${keys.map(() => '---').join('|')}|\n`;
    let body = rows
      .map(r => `| ${keysRaw.map(k => r[k] ?? '').join(' | ')} |`)
      .join('\n');
    return header + body;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  export const sanitizeResponse = (response) => {
    if (!response) return response;

    return response
      .replace(/employee\s*id\s*:\s*\w+/gi, '')
      .replace(/emp\s*id\s*:\s*\w+/gi, '')
      .replace(/id\s*:\s*\w+/gi, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  };
