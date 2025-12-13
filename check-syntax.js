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

let foundErrors = false;
files.forEach(file => {
  try {
    const code = fs.readFileSync(file, 'utf8');
    new Function(code);
  } catch (e) {
    foundErrors = true;
    const lineMatch = e.message.match(/line (\d+)/);
    console.log(`${file}:`);
    console.log(`  Error: ${e.message}`);
  }
});

if (!foundErrors) {
  console.log('✓ No syntax errors found in any of the checked files.');
}
