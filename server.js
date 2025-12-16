const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const rootDir = path.resolve(__dirname);

app.use(express.static(rootDir));

app.use((req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
