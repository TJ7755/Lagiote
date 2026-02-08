const fs = require('fs');
const path = require('path');

const files = [
  'js/core/cortex.js',
  'js/core/db.js',
  'js/core/fsrs.js',
  'js/core/keyboard.js',
  'js/core/utils.js',
  'js/pages/bridge.js',
  'js/pages/dashboard.js',
  'js/pages/study.js',
  'netlify/functions/gemini-autocomplete.js',
  'netlify/functions/gemini-generate-deck.js',
  'netlify/functions/generateDistractors.js',
  'netlify/functions/sync.js',
  'services/auth-service.js'
];

let foundIssues = false;

files.forEach(file => {
  try {
    const code = fs.readFileSync(file, 'utf8');
    const lines = code.split('\n');
    
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      
      // Pattern 1: Invalid object literal { .foo } (without spread operator)
      // Match { . but NOT { ...
      if (line.match(/\{\s*\.(?!\.)/) && !line.match(/\/\//)) {
        foundIssues = true;
        console.log(`${file}:${lineNum}: Invalid object literal syntax`);
        console.log(`  ${line.trim()}`);
      }
      
      // Pattern 2: Invalid array syntax [.foo]
      if (line.match(/\[\s*\.(?!\.)/) && !line.match(/\/\//)) {
        foundIssues = true;
        console.log(`${file}:${lineNum}: Invalid array syntax`);
        console.log(`  ${line.trim()}`);
      }
      
      // Pattern 3: Trailing commas in objects/arrays (optional warning)
      if (line.match(/,\s*[\]\}]/) && !line.match(/\/\//)) {
        // This is allowed in modern JS but can be flagged for review
        // Only show if it looks suspicious
        if (line.match(/,[^,]*[\]\}]/)) {
          foundIssues = true;
          console.log(`${file}:${lineNum}: Trailing comma detected`);
          console.log(`  ${line.trim()}`);
        }
      }
    });
  } catch (e) {
    console.log(`Error reading ${file}: ${e.message}`);
  }
});

if (!foundIssues) {
  console.log('PASS No invalid syntax patterns found in any of the checked files.');
  console.log('  - No { .foo } patterns (without spread operator)');
  console.log('  - No [.foo] patterns');
  console.log('  - No suspicious trailing commas');
}
