const http = require('http');

const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET;
const dbUrl = process.env.DATABASE_URL;
const apiKey = process.env.API_KEY;

console.log({ port, jwtSecret, dbUrl, apiKey });
