/* eslint no-param-reassign: 0 */
import React, { Component } from 'react';
import Dropzone from 'react-dropzone';
import {
  Icon, Tabs, Pane, Alert,
} from 'watson-react-components';
import recognizeMicrophone from 'watson-speech/speech-to-text/recognize-microphone';
import recognizeFile from 'watson-speech/speech-to-text/recognize-file';

import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import ModelDropdown from './model-dropdown.jsx';
import Transcript from './transcript.jsx';
import { Keywords, getKeywordsSummary } from './keywords.jsx';
import SpeakersView from './speaker.jsx';
import TimingView from './timing.jsx';
import JSONView from './json-view.jsx';
import samples from '../src/data/samples.json';
import cachedModels from '../src/data/models.json';

// const ffmpeg = require('fluent-ffmpeg');

const ERR_MIC_NARROWBAND = 'Microphone transcription cannot accommodate narrowband voice models, please select a broadband one.';
const NEW_DEMO_NOTIFICATION = 'A new Speech to Text demo is available, check it out ';

export class Demo extends Component {
  constructor(props) {
    super();
    this.state = {
      model: 'en-US_BroadbandModel',
      rawMessages: [],
      formattedMessages: [],
      audioSource: null,
      speakerLabels: false,
      keywords: this.getKeywords('en-US_BroadbandModel'),
      // transcript model and keywords are the state that they were when the button was clicked.
      // Changing them during a transcription would cause a mismatch between the setting sent to the
      // service and what is displayed on the demo, and could cause bugs.
      settingsAtStreamStart: {
        model: '',
        keywords: [],
        speakerLabels: false,
      },
      error: null,
      compare_text: { ResultList: [] },
      sentiments: [],
      dataInput: [],
      sentimentSelect: '',
    };

    this.handleSampleClick = this.handleSampleClick.bind(this);
    this.handleSample1Click = this.handleSample1Click.bind(this);
    this.handleSample2Click = this.handleSample2Click.bind(this);
    this.reset = this.reset.bind(this);
    this.captureSettings = this.captureSettings.bind(this);
    this.stopTranscription = this.stopTranscription.bind(this);
    this.getRecognizeOptions = this.getRecognizeOptions.bind(this);
    this.isNarrowBand = this.isNarrowBand.bind(this);
    this.handleMicClick = this.handleMicClick.bind(this);
    this.handleUploadClick = this.handleUploadClick.bind(this);
    this.handleUserFile = this.handleUserFile.bind(this);
    this.handleUserFileRejection = this.handleUserFileRejection.bind(this);
    this.playFile = this.playFile.bind(this);
    this.handleStream = this.handleStream.bind(this);
    this.handleRawMessage = this.handleRawMessage.bind(this);
    this.handleFormattedMessage = this.handleFormattedMessage.bind(this);
    this.handleTranscriptEnd = this.handleTranscriptEnd.bind(this);
    this.getKeywords = this.getKeywords.bind(this);
    this.handleModelChange = this.handleModelChange.bind(this);
    this.supportsSpeakerLabels = this.supportsSpeakerLabels.bind(this);
    this.handleSpeakerLabelsChange = this.handleSpeakerLabelsChange.bind(this);
    this.handleKeywordsChange = this.handleKeywordsChange.bind(this);
    this.getKeywordsArr = this.getKeywordsArr.bind(this);
    this.getKeywordsArrUnique = this.getKeywordsArrUnique.bind(this);
    this.getFinalResults = this.getFinalResults.bind(this);
    this.getCurrentInterimResult = this.getCurrentInterimResult.bind(this);
    this.getFinalAndLatestInterimResult = this.getFinalAndLatestInterimResult.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleComprehend = this.handleComprehend.bind(this);
    this.onSentimentChange = this.onSentimentChange.bind(this);
  }

  // eslint-disable-next-line react/sort-comp
  reset() {
    if (this.state.audioSource) {
      this.stopTranscription();
    }
    this.setState({ rawMessages: [], formattedMessages: [], error: null });
  }

  /**
     * The behavior of several of the views depends on the settings when the
     * transcription was started. So, this stores those values in a settingsAtStreamStart object.
     */
  captureSettings() {
    const { model, speakerLabels } = this.state;
    this.setState({
      settingsAtStreamStart: {
        model,
        keywords: this.getKeywordsArrUnique(),
        speakerLabels,
      },
    });
  }

  stopTranscription() {
    if (this.stream) {
      this.stream.stop();
      // this.stream.removeAllListeners();
      // this.stream.recognizeStream.removeAllListeners();
    }
    this.setState({ audioSource: null });
  }

  getRecognizeOptions(extra) {
    const keywords = this.getKeywordsArrUnique();
    return { // formats phone numbers, currency, etc. (server-side)
      accessToken: this.state.accessToken,
      token: this.state.token,
      smartFormatting: true,
      format: true, // adds capitals, periods, and a few other things (client-side)
      model: this.state.model,
      objectMode: true,
      interimResults: true,
      // note: in normal usage, you'd probably set this a bit higher
      wordAlternativesThreshold: 0.01,
      keywords,
      keywordsThreshold: keywords.length
        ? 0.01
        : undefined, // note: in normal usage, you'd probably set this a bit higher
      timestamps: true, // set timestamps for each word - automatically turned on by speaker_labels
      // includes the speaker_labels in separate objects unless resultsBySpeaker is enabled
      speakerLabels: this.state.speakerLabels,
      // combines speaker_labels and results together into single objects,
      // making for easier transcript outputting
      resultsBySpeaker: this.state.speakerLabels,
      // allow interim results through before the speaker has been determined
      speakerlessInterim: this.state.speakerLabels,
      url: this.state.serviceUrl,
      ...extra,
    };
  }

  isNarrowBand(model) {
    model = model || this.state.model;
    return model.indexOf('Narrowband') !== -1;
  }

  // eslint-disable-next-line react/sort-comp
  handleMicClick() {
    if (this.state.audioSource === 'mic') {
      this.stopTranscription();
      return;
    }
    this.reset();
    this.setState({ audioSource: 'mic' });

    // The recognizeMicrophone() method is a helper method provided by the watson-speech package
    // It sets up the microphone, converts and downsamples the audio, and then transcribes it
    // over a WebSocket connection
    // It also provides a number of optional features, some of which are enabled by default:
    //  * enables object mode by default (options.objectMode)
    //  * formats results (Capitals, periods, etc.) (options.format)
    //  * outputs the text to a DOM element - not used in this demo because it doesn't play nice
    // with react (options.outputElement)
    //  * a few other things for backwards compatibility and sane defaults
    // In addition to this, it passes other service-level options along to the RecognizeStream that
    // manages the actual WebSocket connection.
    this.handleStream(recognizeMicrophone(this.getRecognizeOptions()));
  }

  handleUploadClick() {
    if (this.state.audioSource === 'upload') {
      this.stopTranscription();
    } else {
      this.dropzone.open();
    }
  }

  handleUserFile(files) {
    const file = files[0];
    const typeFile = file.type;
    if (typeFile === 'video/mp4') {
      // todo;
      // ffmpeg('/path/to/file.avi')
      //   .output('outputfile.mp3');
      this.setState({ audioSource: 'upload', compare_text: { ResultList: [] } });
      const form = new FormData();
      form.append('file', file);
      form.append('type', this.state.model);

      axios.post('upload-video', form).then((res) => {
        this.reset();
        this.handleFormattedMessage(res.data);
        this.setState({ audioSource: '' });
      });
      return;
    }

    if (!file) {
      return;
    }
    this.reset();
    this.setState({ audioSource: 'upload' });
    this.playFile(file);
  }

  handleUserFileRejection() {
    this.setState({ error: 'Sorry, that file does not appear to be compatible.' });
  }

  handleSample1Click() {
    this.handleSampleClick(1);
  }

  handleSample2Click() {
    this.handleSampleClick(2);
  }

  handleSampleClick(which) {
    if (this.state.audioSource === `sample-${which}`) {
      this.stopTranscription();
    } else {
      const filename = samples[this.state.model] && samples[this.state.model][which - 1].filename;
      if (!filename) {
        this.handleError(`No sample ${which} available for model ${this.state.model}`, samples[this.state.model]);
      }
      this.reset();
      this.setState({ audioSource: `sample-${which}` });
      this.playFile(`audio/${filename}`);
    }
  }

  /**
   * @param {File|Blob|String} file - url to an audio file or a File
   * instance fro user-provided files.
   */
  playFile(file) {
    // The recognizeFile() method is a helper method provided by the watson-speach package
    // It accepts a file input and transcribes the contents over a WebSocket connection
    // It also provides a number of optional features, some of which are enabled by default:
    //  * enables object mode by default (options.objectMode)
    //  * plays the file in the browser if possible (options.play)
    //  * formats results (Capitals, periods, etc.) (options.format)
    //  * slows results down to realtime speed if received faster than realtime -
    // this causes extra interim `data` events to be emitted (options.realtime)
    //  * combines speaker_labels with results (options.resultsBySpeaker)
    //  * outputs the text to a DOM element - not used in this demo because it doesn't play
    //  nice with react (options.outputElement)
    //  * a few other things for backwards compatibility and sane defaults
    // In addition to this, it passes other service-level options along to the RecognizeStream
    // that manages the actual WebSocket connection.
    this.handleStream(recognizeFile(this.getRecognizeOptions({
      file,
      play: false, // play the audio out loud
      // use a helper stream to slow down the transcript output to match the audio speed
      realtime: false,
    })));
  }

  handleStream(stream) {
    // cleanup old stream if appropriate
    if (this.stream) {
      this.stream.stop();
      this.stream.removeAllListeners();
      this.stream.recognizeStream.removeAllListeners();
    }
    this.stream = stream;
    // this.captureSettings();

    // grab the formatted messages and also handle errors and such
    stream.on('data', this.handleFormattedMessage)
      .on('end', this.handleTranscriptEnd)
      .on('error', this.handleError);

    // when errors occur, the end event may not propagate through the helper streams.
    // However, the recognizeStream should always fire a end and close events
    stream.recognizeStream.on('end', () => {
      if (this.state.error) {
        this.handleTranscriptEnd();
      }
    });

    // grab raw messages from the debugging events for display on the JSON tab
    stream.recognizeStream
      .on('message', (frame, json) => this.handleRawMessage({ sent: false, frame, json }))
      .on('send-json', (json) => this.handleRawMessage({ sent: true, json }))
      .once('send-data', () => this.handleRawMessage({
        sent: true, binary: true, data: true, // discard the binary data to avoid waisting memory
      }))
      .on('close', (code, message) => this.handleRawMessage({ close: true, code, message }));

    // ['open','close','finish','end','error', 'pipe'].forEach(e => {
    //     stream.recognizeStream.on(e, console.log.bind(console, 'rs event: ', e));
    //     stream.on(e, console.log.bind(console, 'stream event: ', e));
    // });
  }

  handleRawMessage(msg) {
    const { rawMessages } = this.state;
    this.setState({ rawMessages: rawMessages.concat(msg) });
  }

  handleFormattedMessage(msg) {
    const { formattedMessages } = this.state;
    this.setState({ formattedMessages: formattedMessages.concat(msg) });
  }

  handleTranscriptEnd() {
    // note: this function will be called twice on a clean end,
    // but may only be called once in the event of an error
    this.setState({ audioSource: null });
  }

  componentDidMount() {
    this.fetchToken();
    // tokens expire after 60 minutes, so automatcally fetch a new one ever 50 minutes
    // Not sure if this will work properly if a computer goes to sleep for > 50 minutes
    // and then wakes back up
    // react automatically binds the call to this
    // eslint-disable-next-line
    this.setState({ tokenInterval: setInterval(this.fetchToken, 50 * 60 * 1000) });
  }

  componentWillUnmount() {
    clearInterval(this.state.tokenInterval);
  }

  fetchToken() {
    return axios.get('/api/v1/credentials')
      .then((res) => {
        console.log(res);
        if (res.status !== 200) {
          throw new Error('Error retrieving auth token');
        }
        return res.data;
      })
      .then((creds) => this.setState({ ...creds })).catch(this.handleError);

    // return fetch('/api/v1/credentials').then((res) => {
    //   if (res.status !== 200) {
    //     throw new Error('Error retrieving auth token');
    //   }
    //   return res.json();
    // }) // todo: throw here if non-200 status
    //   .then((creds) => this.setState({ ...creds })).catch(this.handleError);
  }

  getKeywords(model) {
    // a few models have more than two sample files, but the demo can only handle
    // two samples at the moment
    // so this just takes the keywords from the first two samples
    const files = samples[model];
    return (files && files.length >= 2 && `${files[0].keywords}, ${files[1].keywords}`) || '';
  }

  handleModelChange(model) {
    this.reset();
    this.setState({
      model,
      keywords: this.getKeywords(model),
      // speakerLabels: this.supportsSpeakerLabels(model),
    });

    // clear the microphone narrowband error if it's visible and a broadband model was just selected
    if (this.state.error === ERR_MIC_NARROWBAND && !this.isNarrowBand(model)) {
      this.setState({ error: null });
    }

    // clear the speaker_lables is not supported error - e.g.
    // speaker_labels is not a supported feature for model en-US_BroadbandModel
    if (this.state.error && this.state.error.indexOf('speaker_labels is not a supported feature for model') === 0) {
      this.setState({ error: null });
    }
  }

  supportsSpeakerLabels(model) {
    model = model || this.state.model;
    // todo: read the upd-to-date models list instead of the cached one
    return cachedModels.some((m) => m.name === model && m.supported_features.speaker_labels);
  }

  handleSpeakerLabelsChange() {
    this.setState((prevState) => ({ speakerLabels: !prevState.speakerLabels }));
  }

  handleKeywordsChange(e) {
    this.setState({ keywords: e.target.value });
  }

  // cleans up the keywords string into an array of individual, trimmed, non-empty keywords/phrases
  getKeywordsArr() {
    return this.state.keywords.split(',').map((k) => k.trim()).filter((k) => k);
  }

  // cleans up the keywords string and produces a unique list of keywords
  getKeywordsArrUnique() {
    return this.state.keywords
      .split(',')
      .map((k) => k.trim())
      .filter((value, index, self) => self.indexOf(value) === index);
  }

  getFinalResults() {
    return this.state.formattedMessages.filter((r) => r.results
      && r.results.length && r.results[0].final);
  }

  getCurrentInterimResult() {
    const r = this.state.formattedMessages[this.state.formattedMessages.length - 1];

    // When resultsBySpeaker is enabled, each msg.results array may contain multiple results.
    // However, all results in a given message will be either final or interim, so just checking
    // the first one still works here.
    if (!r || !r.results || !r.results.length || r.results[0].final) {
      return null;
    }
    return r;
  }

  getFinalAndLatestInterimResult() {
    const final = this.getFinalResults();
    const interim = this.getCurrentInterimResult();
    if (interim) {
      final.push(interim);
    }
    return final;
  }

  handleError(err, extra) {
    console.error(err, extra);
    if (err.name === 'UNRECOGNIZED_FORMAT') {
      // ignore error
      err = '';// 'Unable to determine content type from file name or header; mp3, wav, flac, ogg, opus, and webm are supported. Please choose a different file.';
    } else if (err.name === 'NotSupportedError' && this.state.audioSource === 'mic') {
      err = 'This browser does not support microphone input.';
    } else if (err.message === '(\'UpsamplingNotAllowed\', 8000, 16000)') {
      err = 'Please select a narrowband voice model to transcribe 8KHz audio files.';
    } else if (err.message === 'Invalid constraint') {
      // iPod Touch does this on iOS 11 - there is a microphone, but Safari claims there isn't
      err = 'Unable to access microphone';
    }
    this.setState({ error: err.message || err });
  }

  getComprehendText() {
    console.log(this.state.compare_text);
    return this.state.compare_text;
  }

  handleComprehend() {
    const messages = this.getFinalAndLatestInterimResult();

    const text = messages.map((msg) => msg.results.map((result) => (
      result.alternatives[0].transcript
    ))).reduce((a, b) => a.concat(b), []);

    // const text = ['ウクライナ の 非常 事態 庁 など に より ます と 四日 未明 南東部 に ある ザポリージャ 原子力 発電所 が ロシア軍 から 攻撃 を 受け 火災 が 発生 した と いう こと です ', '現地 から の 映像 では 弾丸 の 奇跡 と みられる 閃光 が 走り 画面 中央 で 私 が 出て いる のが 確認 できます が 被害 の 詳しい 状況 は わかって いません ', 'ザポリージャ 原子力 発電所 は ヨーロッパ 最大 規模 で ロッキー の 原子炉 が あり 国内 で の 発電 供給量 の およそ 四分の 一 を 占めて います ', '原発 の 状況 に ついて ザポリージャ の 州知事 は ', '現時点 では 原発 の 安全 は 確保 されて いる と して いる ほか ウクライナ の 非常 事態 庁 は 火災 が 発生 した のは 原子炉 では ない 施設 で 現在 消火 活動 に あたって いる と して います ', 'また ＩＡＥＡ 国際 原子力 機関 は ウクライナ 当局 から 放射線 レベル に 変化 は ない と 報告 が あった と して います ', '原発 への 攻撃 を 受け 全然 好き 大統領 は ザポリージャ が 攻撃 を 受けて いる 助け に 来て 欲しい と 訴えた ほか ', 'れば 外相 は 自身 の ツイッター で 爆発 すれば チェルノブイリ 原発 事故 の 十倍 の 規模 に なる 即座 に 砲撃 を やめろ と ロシア 側 を 批判 しました '];

    this.setState({ audioSource: 'loading', sentimentSelect: '', sentiments: [] });

    axios({
      method: 'post',
      url: '/api/v1/comprehend',
      headers: { 'Content-Type': 'application/json' },
      data: {
        text,
        lang: this.state.model,
      },
    }).then((res) => {
      if (res.status !== 200) {
        throw new Error('Error retrieving auth token');
      }
      this.setState({
        // eslint-disable-next-line react/no-unused-state
        compare_text: res.data, audioSource: '', dataInput: text,
      });

      const sentiments = [];
      this.state.compare_text.ResultList.map((item) => {
        const sentiment = item.Sentiment;
        if (!sentiments.includes(sentiment)) {
          sentiments.push(sentiment);
        }

        return sentiment;
      });

      this.setState({
        sentiments,
      });

      return res.data;
    }).then((creds) => this.setState({ ...creds })).catch(this.handleError);
  }

  onSentimentChange(e) {
    console.log(e);
    this.setState({ sentimentSelect: e.target.value });
  }

  render() {
    const {
      token, accessToken, audioSource, error, model, speakerLabels, settingsAtStreamStart,
      formattedMessages, rawMessages,
    } = this.state;

    const buttonsEnabled = !!token || !!accessToken;

    const buttonClass = buttonsEnabled
      ? 'base--button'
      : 'base--button base--button_black';

    let micIconFill = '#000000';
    let micButtonClass = buttonClass;
    if (audioSource === 'mic') {
      micButtonClass += ' mic-active';
      micIconFill = '#FFFFFF';
    } else if (!recognizeMicrophone.isSupported) {
      micButtonClass += ' base--button_black';
    }

    const err = error
      ? (
        <Alert type="error" color="red">
          <p className="base--p">
            {error}
          </p>
        </Alert>
      )
      : null;

    const messages = this.getFinalAndLatestInterimResult();
    const index = 0;
    const data = this.getComprehendText();
    const { sentiments, dataInput, sentimentSelect } = this.state;
    const micBullet = (typeof window !== 'undefined' && recognizeMicrophone.isSupported)
      ? <li className="base--li">Use your microphone to record audio. For best results, use broadband models for microphone input.</li>
      : <li className="base--li base--p_light">Use your microphone to record audio. (Not supported in current browser)</li>;// eslint-disable-line

    return (
      <Dropzone
        onDropAccepted={this.handleUserFile}
        onDropRejected={this.handleUserFileRejection}
        maxSize={200 * 1024 * 1024}
        accept="audio/*, .mp3, .mpeg, .wav, .ogg, .opus, .flac, video/*" // eslint-disable-line
        disableClick
        className="dropzone _container _container_large"
        activeClassName="dropzone-active"
        rejectClassName="dropzone-reject"
        ref={(node) => {
          this.dropzone = node;
        }}
      >
        <div className="flex setup">
          <div className="column">

            <p>Select language:
              <ModelDropdown
                model={model}
                accessToken={token || accessToken}
                onChange={this.handleModelChange}
              />
            </p>

            {/* <p className={this.supportsSpeakerLabels() ? 'base--p' : 'base--p_light'}>
              <input
                className="base--checkbox"
                type="checkbox"
                checked={speakerLabels}
                onChange={this.handleSpeakerLabelsChange}
                disabled={!this.supportsSpeakerLabels()}
                id="speaker-labels"
              />
              <label className="base--inline-label" htmlFor="speaker-labels">
                Detect multiple speakers {this.supportsSpeakerLabels() ? '' : ' (Not supported on current model)'}
              </label>
            </p> */}

          </div>
          <div className="column">

            {/* <p>Keywords to spot: <input
              value={this.getKeywordsArrUnique().join()}
              onChange={this.handleKeywordsChange}
              type="text"
              id="keywords"
              placeholder="Type comma separated keywords here (optional)"
              className="base--input"
            />
            </p> */}

          </div>
        </div>

        <div className="flex buttons">

          <button type="button" className={micButtonClass} onClick={this.handleMicClick}>
            <Icon type={audioSource === 'mic' ? 'stop' : 'microphone'} fill={micIconFill} /> Record Audio
          </button>

          <button type="button" className={buttonClass} onClick={this.handleUploadClick}>
            <Icon type={audioSource === 'upload' ? 'stop' : 'upload'} /> Upload File
          </button>

          <button type="button" className={buttonClass} onClick={this.handleComprehend}>
            Analysis
          </button>

          {/* <button type="button" className={buttonClass} onClick={this.handleSample1Click}>
            <Icon type={audioSource === 'sample-1' ? 'stop' : 'play'} /> Play Sample 1
          </button>

          <button type="button" className={buttonClass} onClick={this.handleSample2Click}>
            <Icon type={audioSource === 'sample-2' ? 'stop' : 'play'} /> Play Sample 2
          </button> */}

        </div>

        {err}

        <div style={{
          height: '300px', border: '1px solid #777677', overflow: 'auto', color: audioSource === 'upload' ? '#fff' : '#000',
        }}
        >
          {settingsAtStreamStart.speakerLabels
            ? <SpeakersView messages={messages} />
            : <Transcript messages={messages} />}
        </div>

        <div className="card">
          <div className="card__section">
            {
            sentiments.map((sentiment, index) => (
              <div className="form-check" style={{ display: 'inline-block', paddingLeft: '20px' }} key={index}>
                <input
                  className="form-check-input"
                  checked={this.state.sentimentSelect === sentiment}
                  type="radio"
                  onChange={this.onSentimentChange}
                  value={sentiment}
                  name="sentiment_type"
                  id={index}
                />
                <label className="form-check-label" htmlFor={index}>{sentiment}</label>
              </div>
            ))
          }
          </div>

          <div className="card-body">
            {
              // eslint-disable-next-line no-shadow
              data.ResultList.map((item, index) => (
                <span key={index} className={sentimentSelect === item.Sentiment ? item.Sentiment : ''}>{dataInput[index]} </span>
              ))
            }
            <div className="card__section" />
          </div>
        </div>

        <div className={audioSource === 'upload' || audioSource === 'loading' ? 'loading' : ''} />
      </Dropzone>
    );
  }
}

export default Demo;
