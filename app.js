/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
require('dotenv').config({ silent: true });

const express = require('express');

const https = require('https');
const fs = require('fs');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const SpeechToText = require('watson-speech/speech-to-text');
const SpeechToTextV1 = require('ibm-watson/speech-to-text/v1');
const { IamAuthenticator } = require('ibm-watson/auth');
const AWS = require('aws-sdk');
const Comprehend = require('aws-sdk/clients/comprehend');
const bodyParser = require('body-parser');

const options = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem'),
};

const app = express();
// parse application/json
app.use(bodyParser.json());

const { IamTokenManager } = require('ibm-watson/auth');
const { text } = require('body-parser');

// Bootstrap application settings
require('./config/express')(app);

const serviceUrl = process.env.SPEECH_TO_TEXT_URL;

const tokenManager = new IamTokenManager({
  apikey: process.env.SPEECH_TO_TEXT_IAM_APIKEY || '<iam_apikey>',
});

// SET STORAGE
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'uploads');
  },
  filename(req, file, cb) {
    const extArray = file.mimetype.split('/');
    const extension = extArray[extArray.length - 1];
    cb(null, `${file.fieldname}-${Date.now()}.${extension}`);
  },
});

const upload = multer({ storage });

app.post('/api/v1/comprehend', async (req, res) => {
  const comprehend = new Comprehend({
    region: 'ap-northeast-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  let lang = 'en';
  if (req.body.lang !== 'en-US_BroadbandModel') {
    lang = 'ja';
  }

  const xxx = comprehend.batchDetectSentiment({
    TextList: req.body.text,
    LanguageCode: lang,
  }).promise();

  xxx.then((data) => {
    console.log(data);
    res.json(data);
  });

  // const xxx = comprehend.batchDetectEntities({
  //   TextList: req.body.text || [],
  //   LanguageCode: lang,
  // }).promise();

  // xxx.then((data) => {
  //   console.log(data);
  //   res.json(data);
  // });
});

app.get('/', (req, res) => res.render('index'));

app.post('/upload-video', upload.single('file'), async (req, res) => {
  const { path } = req.file;
  const saveLocation = './uploads/output.mp3';
  const proc = new ffmpeg({ source: path });
  let results = '';
  await proc.withAudioCodec('libmp3lame')
    .toFormat('mp3')
    .saveToFile(saveLocation, () => {
    })
    .on('error', () => {
      fs.unlinkSync(`./${path}`);
    })
    .on('end', async () => {
      fs.unlinkSync(`./${path}`);

      const speechToText = new SpeechToTextV1({
        authenticator: new IamAuthenticator({
          apikey: process.env.SPEECH_TO_TEXT_IAM_APIKEY,
        }),
        serviceUrl: process.env.SPEECH_TO_TEXT_URL,
      });

      const params = {
        objectMode: true,
        contentType: 'audio/mp3',
        model: req.body.type,
      };

      // Create the stream.
      const recognizeStream = speechToText.recognizeUsingWebSocket(params);

      // Pipe in the audio.
      fs.createReadStream(saveLocation).pipe(recognizeStream);

      // eslint-disable-next-line no-use-before-define
      recognizeStream.on('data', (event) => { onEvent('Data:', event); });
      // eslint-disable-next-line no-use-before-define
      recognizeStream.on('error', (event) => { onEvent('Error:', event); });
      // eslint-disable-next-line no-use-before-define
      recognizeStream.on('close', (event) => { onEvent('Close:', event); });

      // eslint-disable-next-line consistent-return
      function onEvent(name, event) {
        if (name === 'Data:') {
          results = event;
        }

        if (name === 'Close:') {
          return res.json(results);
        }

        if (name === 'Error:') {
          return res.json({ event });
        }
      }
    });
});

// Display events on the console.

// Get credentials using your credentials
app.get('/api/v1/credentials', async (req, res, next) => {
  try {
    const accessToken = await tokenManager.getToken();
    res.json({
      accessToken,
      serviceUrl,
    });
  } catch (err) {
    next(err);
  }
});

const server = https.createServer(options, app);

const port = process.env.PORT || 8000;
server.listen(port, () => {
  console.log(port);
});

module.exports = app;
