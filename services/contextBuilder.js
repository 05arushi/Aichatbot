export const buildCustomContext = (docs, question) => {
  if (!docs || docs.length === 0) {
    return "No relevant information found.";
  }

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

  if (!isHRQuestion) {
    return "This question is not related to HR or employee information.";
  }

  const relevantDocs = docs.slice(0, 10);

  // Group documents by table/source
  const groupedDocs = {};
  relevantDocs.forEach(doc => {
    const source = doc._source || doc.metadata?._table || 'unknown';
    if (!groupedDocs[source]) groupedDocs[source] = [];
    groupedDocs[source].push(doc);
  });

  let contextParts = [];

  for (const [source, sourceDocs] of Object.entries(groupedDocs)) {
    const sourceContent = sourceDocs.map(d => {
      // Prefer pageContent if available
      if (d.pageContent && d.pageContent.trim()) return d.pageContent;

      // Otherwise, build Markdown from metadata
      const safeMetadata = { ...d.metadata };
      delete safeMetadata.id;
      delete safeMetadata._table;
      delete safeMetadata._columns;
      delete safeMetadata._source;

      let mdLines = [];
      for (const key of Object.keys(safeMetadata)) {
        const value = safeMetadata[key];
        if (value == null || value === '') continue;

        // For leave types or tasks arrays, format nicely
        if (Array.isArray(value)) {
          mdLines.push(`**${capitalize(key)}:**`);
          value.forEach(item => {
            if (typeof item === 'object' && item.title) {
              mdLines.push(`- ${item.title} (${item.hoursSpent || ''} hours, ${item.status || ''})`);
            } else {
              mdLines.push(`- ${item}`);
            }
          });
        } else {
          mdLines.push(`**${capitalize(key)}:** ${value}`);
        }
      }
      return mdLines.join("\n");
    }).join("\n\n"); // separate docs with empty line

    if (sourceContent.trim()) {
      contextParts.push(sourceContent);
    }
  }

  return contextParts.join("\n\n");
};

export const sanitizeResponse = (response) => {
  if (!response) return response;

  return response
    .replace(/employee\s*id\s*:\s*\w+/gi, '')
    .replace(/emp\s*id\s*:\s*\w+/gi, '')
    .replace(/id\s*:\s*\w+/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '') // remove trailing spaces
    .trim();
};

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
