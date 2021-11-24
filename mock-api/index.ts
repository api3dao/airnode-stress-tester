import express from 'express';
import { outboundPayload } from './payload';
const app = express();
const port = 80; // default port to listen

const getENVorDefault = (envKey: any, fallback: any) => {
  if (process.env[envKey]) {
    return process.env[envKey];
  }

  return fallback;
};

const timeoutMin = getENVorDefault('TIMEOUT_MIN', '0');
const timeoutMax = getENVorDefault('TIMEOUT_MAX', '0');
const outboundObject = JSON.parse(outboundPayload);

app.get('/*', async (req, res) => {
  const doResponse = async () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    res.json(outboundObject);
  };
  if (timeoutMin > 0 || timeoutMax > 0) {
    const waitTime = getRandomIntInclusive(parseInt(timeoutMin, 10), parseInt(timeoutMax, 10));
    setTimeout(doResponse, waitTime);
    return;
  }

  await doResponse();
});

// start the Express server
app.listen(port, () => {
  console.log(`server started at http://localhost:${port}`);
});

const getRandomIntInclusive = (min: number, max: number) => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1) + min); // The maximum is inclusive and the minimum is inclusive
};
